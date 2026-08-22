import { PRIVACY_PURPOSES } from '../data/privacyPolicy.js';
import { PrivacyError, requirePurpose } from '../services/privacyService.js';

export function requireConsent(purpose = PRIVACY_PURPOSES.SERVICE_PROCESSING) {
  return async function consentMiddleware(req, res, next) {
    try {
      await requirePurpose(req.identity, purpose);
      next();
    } catch (err) {
      if (err instanceof PrivacyError) {
        return res.status(err.status).json({ error: err.message, code: err.code });
      }
      next(err);
    }
  };
}

export const requireServiceConsent = requireConsent(PRIVACY_PURPOSES.SERVICE_PROCESSING);

export default requireConsent;
