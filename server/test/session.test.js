import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  assertSessionSecretConfigured,
  buildClearSessionCookie,
  buildSessionCookie,
  createSessionToken,
  readSession,
  verifySessionToken,
} from '../src/services/sessionService.js';
import { requireIdentity } from '../src/middleware/requireIdentity.js';

const SECRET = 'test-session-secret-with-enough-entropy';

describe('I3 簽名 session cookie', () => {
  test('有效 token 可還原 canonical studentId', () => {
    const token = createSessionToken('D1249697', { secret: SECRET, issuedAt: 1000 });
    const session = verifySessionToken(token, { secret: SECRET, now: 2000 });
    assert.equal(session.studentId, 'D1249697');
  });

  test('竄改或過期 token 被拒絕', () => {
    const token = createSessionToken('D1249697', { secret: SECRET, issuedAt: 1000 });
    assert.equal(verifySessionToken(`${token}x`, { secret: SECRET, now: 2000 }), null);
    assert.equal(verifySessionToken(token, { secret: SECRET, now: 5000, maxAgeSeconds: 1 }), null);
  });

  test('cookie 使用 HttpOnly、SameSite=Lax 且可清除', () => {
    const cookie = buildSessionCookie('D1249697', { secret: SECRET, secure: false, issuedAt: 1000 });
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /SameSite=Lax/);
    assert.equal(readSession(cookie, { secret: SECRET, now: 2000 }).studentId, 'D1249697');
    assert.match(buildClearSessionCookie({ secure: false }), /Max-Age=0/);
  });
});

describe('I5 assertSessionSecretConfigured（adversarial review 修復：生產環境拒絕暫時密鑰）', () => {
  test('非 production 時，不論有沒有設定都不拋錯', () => {
    assert.doesNotThrow(() => assertSessionSecretConfigured({ nodeEnv: 'development', secret: undefined }));
    assert.doesNotThrow(() => assertSessionSecretConfigured({ nodeEnv: 'test', secret: undefined }));
  });

  test('production 且完全沒設定 SESSION_SECRET 時拋錯', () => {
    assert.throws(
      () => assertSessionSecretConfigured({ nodeEnv: 'production', secret: undefined }),
      /SESSION_SECRET/
    );
  });

  test('production 且 SESSION_SECRET 過短時拋錯', () => {
    assert.throws(
      () => assertSessionSecretConfigured({ nodeEnv: 'production', secret: '太短了' }),
      /SESSION_SECRET/
    );
  });

  test('production 且 SESSION_SECRET 長度足夠時不拋錯', () => {
    assert.doesNotThrow(() => assertSessionSecretConfigured({
      nodeEnv: 'production',
      secret: 'a'.repeat(32),
    }));
  });
});

describe('I4 requireIdentity', () => {
  function responseRecorder() {
    return {
      statusCode: 200,
      body: null,
      status(code) { this.statusCode = code; return this; },
      json(body) { this.body = body; return this; },
    };
  }

  test('沒有 session 回 401', async () => {
    const res = responseRecorder();
    await requireIdentity({ headers: {}, body: {}, query: {}, params: {} }, res, () => {});
    assert.equal(res.statusCode, 401);
  });

  test('session 與 request 使用者不一致時回 403', async () => {
    process.env.SESSION_SECRET = SECRET;
    const cookie = buildSessionCookie('D1249697', { secret: SECRET, secure: false });
    const res = responseRecorder();
    await requireIdentity({
      headers: { cookie },
      body: { userId: 'D0000000' },
      query: {},
      params: {},
    }, res, () => {});
    assert.equal(res.statusCode, 403);
  });
});
