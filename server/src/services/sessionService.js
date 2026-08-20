import crypto from 'node:crypto';
import { logger } from '../utils/logger.js';

export const SESSION_COOKIE_NAME = 'fcu_session';
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7;
// 部署平台提供的固定密鑰至少要有這麼多字元，避免用一個過短、猜得到的值
// 就滿足「有設定」的檢查，形同沒有保護。
const MIN_PRODUCTION_SECRET_LENGTH = 32;

let ephemeralSecret;

// 開發／demo 環境沒設定 SESSION_SECRET 時，退回本次程序的暫時密鑰——
// 僅限非 production；production 的檢查見 assertSessionSecretConfigured()。
function getSecret() {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  if (!ephemeralSecret) {
    ephemeralSecret = crypto.randomBytes(32).toString('hex');
    logger.warn(
      '未設定 SESSION_SECRET，已使用本次程序的暫時密鑰；後端重啟後所有登入 session 會失效。',
      { label: 'Auth' }
    );
  }
  return ephemeralSecret;
}

// 生產環境不得使用「每次程序啟動自己生一把」的暫時密鑰：那會讓伺服器重啟
// 後所有人被登出，多台 replica 之間也會互相拒絕彼此簽的 cookie（因為各自
// 用不同的暫時密鑰簽章）——而且症狀是隨機、難以重現的認證失敗，不是一個
// 清楚的啟動錯誤。部署平台必須提供固定、所有 replica 共用的高強度亂碼；
// 缺少或明顯太短時直接讓伺服器啟動失敗，而不是安靜地退回不安全的預設值。
// 呼叫端負責在啟動流程裡呼叫（見 `app.js` 的 `startServer()`），這裡本身
// 不含任何啟動邏輯，維持這個模組只管簽章／驗證的單一職責。
export function assertSessionSecretConfigured({
  nodeEnv = process.env.NODE_ENV,
  secret = process.env.SESSION_SECRET,
} = {}) {
  if (nodeEnv !== 'production') return;
  if (secret && secret.trim().length >= MIN_PRODUCTION_SECRET_LENGTH) return;

  throw new Error(
    `生產環境（NODE_ENV=production）必須設定 SESSION_SECRET，且長度至少 `
    + `${MIN_PRODUCTION_SECRET_LENGTH} 字元。部署平台需提供固定、所有 replica `
    + '共用的高強度亂碼（例如 `openssl rand -hex 32` 的輸出），不能讓伺服器每次'
    + '啟動自行產生——否則重啟會讓所有登入 session 失效，多台 replica 之間也會'
    + '互相拒絕彼此簽發的 cookie。'
  );
}

function sign(payload, secret = getSecret()) {
  return crypto.createHmac('sha256', secret).update(payload).digest('base64url');
}

export function createSessionToken(studentId, options = {}) {
  const payload = Buffer.from(JSON.stringify({
    studentId: String(studentId),
    issuedAt: options.issuedAt ?? Date.now(),
  })).toString('base64url');
  return `${payload}.${sign(payload, options.secret)}`;
}

export function verifySessionToken(token, options = {}) {
  if (!token || typeof token !== 'string') return null;
  const [payload, signature, ...rest] = token.split('.');
  if (!payload || !signature || rest.length > 0) return null;

  const expected = sign(payload, options.secret);
  const left = Buffer.from(signature);
  const right = Buffer.from(expected);
  if (left.length !== right.length || !crypto.timingSafeEqual(left, right)) return null;

  try {
    const session = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    const now = options.now ?? Date.now();
    const maxAgeMs = (options.maxAgeSeconds ?? SESSION_MAX_AGE_SECONDS) * 1000;
    if (!session.studentId || !Number.isFinite(session.issuedAt)) return null;
    if (session.issuedAt > now || now - session.issuedAt > maxAgeMs) return null;
    return session;
  } catch {
    return null;
  }
}

export function parseCookies(cookieHeader = '') {
  return String(cookieHeader)
    .split(';')
    .map(part => part.trim())
    .filter(Boolean)
    .reduce((cookies, part) => {
      const separator = part.indexOf('=');
      if (separator === -1) return cookies;
      const key = part.slice(0, separator);
      const value = part.slice(separator + 1);
      cookies[key] = decodeURIComponent(value);
      return cookies;
    }, {});
}

export function readSession(cookieHeader, options = {}) {
  const token = parseCookies(cookieHeader)[SESSION_COOKIE_NAME];
  return verifySessionToken(token, options);
}

export function buildSessionCookie(studentId, options = {}) {
  const token = createSessionToken(studentId, options);
  const secure = options.secure ?? process.env.NODE_ENV === 'production';
  return [
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`,
    'HttpOnly',
    'SameSite=Lax',
    'Path=/',
    `Max-Age=${SESSION_MAX_AGE_SECONDS}`,
    secure ? 'Secure' : null,
  ].filter(Boolean).join('; ');
}

export function buildClearSessionCookie(options = {}) {
  const secure = options.secure ?? process.env.NODE_ENV === 'production';
  return [
    `${SESSION_COOKIE_NAME}=`,
    'HttpOnly',
    'SameSite=Lax',
    'Path=/',
    'Max-Age=0',
    secure ? 'Secure' : null,
  ].filter(Boolean).join('; ');
}

export default {
  SESSION_COOKIE_NAME,
  SESSION_MAX_AGE_SECONDS,
  assertSessionSecretConfigured,
  createSessionToken,
  verifySessionToken,
  parseCookies,
  readSession,
  buildSessionCookie,
  buildClearSessionCookie,
};
