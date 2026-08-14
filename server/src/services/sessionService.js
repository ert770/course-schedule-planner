import crypto from 'node:crypto';
import { logger } from '../utils/logger.js';

export const SESSION_COOKIE_NAME = 'fcu_session';
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7;

let ephemeralSecret;

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
  createSessionToken,
  verifySessionToken,
  parseCookies,
  readSession,
  buildSessionCookie,
  buildClearSessionCookie,
};
