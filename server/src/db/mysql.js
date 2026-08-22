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
