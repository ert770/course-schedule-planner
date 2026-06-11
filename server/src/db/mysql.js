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

export async function closePool() {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
