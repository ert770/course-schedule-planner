import { Router } from 'express';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { requireIdentity } from '../middleware/requireIdentity.js';
import { requireServiceConsent } from '../middleware/requireConsent.js';
import { controlledBrowser } from '../services/controlledBrowserService.js';
import { localMyFcuPreview } from '../services/localMyFcuPreview.js';
import { isMysqlConfigured } from '../db/mysql.js';
import { isIsolatedHistoryMysqlE2E, isLocalSelfAttestedHistory, isSessionHistoryImport } from '../services/isolatedHistoryE2E.js';
import { readSession, SESSION_MAX_AGE_SECONDS } from '../services/sessionService.js';

// Keep malformed or oversized input bodies out of Express default error logs.
export function controlledBrowserBodyError(err, _req, res, _next) {
  if (!err) return _next();
  const status = err.status === 413 ? 413 : 400;
  return res.status(status).json({ error: status === 413 ? '請求內容過大' : '請求格式錯誤' });
}

const router = Router();
export function localOnly(req, res, next) {
  if (process.env.CONTROLLED_BROWSER_PERSONAL_TEST === 'true') return res.sendStatus(404);
  const mock = process.env.CONTROLLED_BROWSER_MOCK === 'true', real = process.env.CONTROLLED_BROWSER_REAL_TEST === 'true', local = process.env.LOCAL_MYFCU_PREVIEW === 'true';
  if (process.env.NODE_ENV === 'production' || (local ? ((mock && !(isIsolatedHistoryMysqlE2E() && process.env.LOCAL_MYFCU_SYNTHETIC_E2E === 'true')) || real || process.platform !== 'win32' || (process.env.ISOLATED_HISTORY_MYSQL_E2E === 'true' && !(isIsolatedHistoryMysqlE2E() && process.env.LOCAL_MYFCU_SYNTHETIC_E2E === 'true'))) : mock === real)) return res.sendStatus(404);
  if (!local && isMysqlConfigured() && !isIsolatedHistoryMysqlE2E()) return res.sendStatus(503);
  if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress)) return res.sendStatus(403);
  const host = (req.get('host') || '').split(':')[0];
  if (!['localhost', '127.0.0.1'].includes(host)) return res.sendStatus(403);
  const origin = req.get('origin');
  if (origin && !/^https?:\/\/(localhost|127\.0\.0\.1):(3001|5173)$/.test(origin)) return res.sendStatus(403);
  if (local && !['GET','HEAD'].includes(req.method) && (!origin || origin !== (process.env.CLIENT_ORIGIN || 'http://localhost:5173'))) return res.sendStatus(403);
  if (req.get('sec-fetch-site') === 'cross-site') return res.sendStatus(403);
  res.set('Cache-Control', 'no-store');
  res.set('Cross-Origin-Resource-Policy', 'same-origin');
  next();
}
router.use(localOnly);
// Synthetic fixture only; no actual school domain, credentials, or persisted data.
router.get('/mock', (_req, res) => {
  if (process.env.CONTROLLED_BROWSER_MOCK !== 'true') return res.sendStatus(404);
  try {
    let html = readFileSync(fileURLToPath(new URL('../../test/fixtures/controlled-browser-mock.html', import.meta.url)), 'utf8');
    if (isIsolatedHistoryMysqlE2E()) html=html.replace('<th>成績</th>','<th>取得學分記錄</th>');
    res.set('Content-Security-Policy', "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'");
    res.type('html').send(html);
  } catch { res.sendStatus(503); }
});
router.use(requireIdentity, requireServiceConsent);
export const sendControlledBrowserError = (res, e) => {
  const safe = e?.safeControlledBrowserError === true;
  return res.status(safe ? e.status : 500).json({ error: safe ? e.message : '受控瀏覽器暫時無法使用', ...(safe && e.code ? { code:e.code } : {}) });
};
const sendError = (res,e) => e?.safeLocalPreviewError ? res.status(e.status).json({error:e.message}) : sendControlledBrowserError(res,e);
const localMode=()=>process.env.LOCAL_MYFCU_PREVIEW==='true';
router.get('/config', (_req,res) => res.json({ mode:localMode() ? 'local' : process.env.CONTROLLED_BROWSER_REAL_TEST === 'true' ? 'real' : 'mock', ...(isIsolatedHistoryMysqlE2E()?{isolatedMysqlE2E:true}:{}), localSelfAttested:isLocalSelfAttestedHistory(), sessionImport:isSessionHistoryImport() }));
router.post('/sessions', async (req,res) => { try { res.status(201).json(localMode()?{...await localMyFcuPreview.start(req.identity,req.headers.cookie,req.body?.consent),mode:'local'}:await controlledBrowser.start(req.identity, req.headers.cookie, req.body?.consent, req.socket.localPort, process.env.CONTROLLED_BROWSER_REAL_TEST === 'true' ? 'real' : 'mock', readSession(req.headers.cookie).issuedAt + SESSION_MAX_AGE_SECONDS * 1000)); } catch(e) { sendError(res,e); } });
router.get('/sessions/:id', async (req,res) => { try { res.json(localMode()?localMyFcuPreview.state(req.params.id,req.identity,req.headers.cookie,req.get('x-controlled-grant')):await controlledBrowser.state(req.params.id,req.identity,req.headers.cookie,req.get('x-controlled-grant'))); } catch(e) { sendError(res,e); } });
router.get('/sessions/:id/frame', async (req,res) => { try { if(localMode())return res.sendStatus(403); res.type('jpeg').send(await controlledBrowser.frame(req.params.id,req.identity,req.headers.cookie,req.get('x-controlled-grant'))); } catch(e) { sendError(res,e); } });
router.post('/sessions/:id/input', async (req,res) => { try { if(localMode())return res.sendStatus(403); res.json(await controlledBrowser.input(req.params.id,req.identity,req.headers.cookie,req.body,req.get('x-controlled-grant'))); } catch(e) { sendError(res,e); } });
router.delete('/sessions/:id', async (req,res) => { try { if(localMode())localMyFcuPreview.cancel(req.params.id,req.identity,req.headers.cookie,req.get('x-controlled-grant'));else await controlledBrowser.cancel(req.params.id,req.identity,req.headers.cookie,req.get('x-controlled-grant'));  res.json({success:true}); } catch(e) { sendError(res,e); } });
export default router;
