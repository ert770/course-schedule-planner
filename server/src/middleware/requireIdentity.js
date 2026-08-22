import { resolveIdentity } from '../services/identityService.js';
import { readSession } from '../services/sessionService.js';

function requestIdentityValue(req) {
  return req.body?.userId
    ?? req.body?.studentId
    ?? req.query?.userId
    ?? req.query?.studentId
    ?? req.params?.studentId
    ?? null;
}

export async function requireIdentity(req, res, next) {
  try {
    const session = readSession(req.headers.cookie);
    if (!session) {
      return res.status(401).json({ error: '登入狀態已失效，請重新登入' });
    }

    const identity = await resolveIdentity(session.studentId);
    if (!identity.found) {
      return res.status(401).json({ error: '登入使用者不存在，請重新登入' });
    }

    const requested = requestIdentityValue(req);
    if (requested !== null && String(requested) !== String(identity.canonicalId)) {
      const requestedIdentity = await resolveIdentity(requested);
      if (!requestedIdentity.found
        || String(requestedIdentity.canonicalId) !== String(identity.canonicalId)) {
        return res.status(403).json({ error: '不可操作其他使用者的資料' });
      }
    }

    req.identity = identity;
    next();
  } catch (err) {
    next(err);
  }
}

export default requireIdentity;
