import fs from 'fs';
import path from 'path';
import mysql from 'mysql2/promise';

let pool = null;

export function isMysqlConfigured() {
  return Boolean(
    process.env.DB_HOST
      && process.env.DB_USER
      && process.env.DB_NAME
  );
}

function getSslConfig() {
  if (!process.env.DB_SSL_CA_PATH) {
    return undefined;
  }

  const caPath = process.env.DB_SSL_CA_PATH;
  const candidates = [
    caPath,
    path.resolve(process.cwd(), caPath),
    path.resolve(process.cwd(), '..', caPath),
  ];
  const resolvedPath = candidates.find(candidate => fs.existsSync(candidate));
  if (!resolvedPath) {
    throw new Error(`DB_SSL_CA_PATH file not found: ${caPath}`);
  }

  return {
    ca: fs.readFileSync(resolvedPath, 'utf-8'),
  };
}

export function getPool() {
  if (!isMysqlConfigured()) {
    throw new Error('MySQL is not configured. Please set DB_HOST, DB_USER, and DB_NAME.');
  }

  if (!pool) {
    pool = mysql.createPool({
      host: process.env.DB_HOST,
      port: Number(process.env.DB_PORT || 3306),
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD || '',
      database: process.env.DB_NAME,
      // 找出的過程：roadmap #28 清理測試帳號時，`DELETE /api/privacy/data`
      // 對真實 MySQL 一律回「刪除確認已失效或不正確」——deletion intent
      // 剛建立就被判定已過期。`privacyService.js` 全程用 UTC 寫入
      // `DATETIME(3)` 欄位（`toMysqlDate()` 是 `toISOString()` 去掉時區字尾），
      // 但 mysql2 讀回 DATETIME 時，沒有明講時區就會**用執行環境的本地時區**
      // 建構 JS Date——伺服器在 UTC+8，讀回的值因此比寫入時晚了 8 小時，
      // `new Date(expires_at) <= now` 於是永遠成立。加 `timezone: 'Z'`
      // 讓驅動把讀到的每個 DATETIME／TIMESTAMP 都當成 UTC 解析，
      // 才會跟寫入時的語意一致；這是驅動層設定，一次修正全部受影響的欄位
      // （deletion intent 過期判定、consent／subject state 的顯示時間等），
      // 不必逐一修改各處的比較邏輯。既有的 SQL 端比較（例如
      // `Chat_Messages` 用 `WHERE expires_at > UTC_TIMESTAMP(3)`）本來就不
      // 經過這個轉換，不受影響。
      timezone: 'Z',
      waitForConnections: true,
      connectionLimit: Number(process.env.DB_CONNECTION_LIMIT || 10),
      ssl: getSslConfig(),
    });
  }

  return pool;
}

export async function queryRows(sql, params = []) {
  const [rows] = await getPool().execute(sql, params);
  return rows;
}

// 供需要原子性的多陳述式操作使用（例如 profileSchemaMigration.js 的
// student_id 回填）：`fn` 收到一個已開啟交易的 connection，內部所有
// `connection.execute(...)` 呼叫要嘛全部成功才 commit，`fn` 拋出例外時
// 整批 rollback，不會留下半套資料。呼叫端不得繼續用共用的 `queryRows()`
// 執行同一批操作——那是各自向連線池借用不同連線、各自 autocommit，
// 無法組成單一交易。
export async function withTransaction(fn) {
  const connection = await getPool().getConnection();
  try {
    await connection.beginTransaction();
    const result = await fn(connection);
    await connection.commit();
    return result;
  } catch (err) {
    await connection.rollback();
    throw err;
  } finally {
    connection.release();
  }
}

export async function closePool() {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
