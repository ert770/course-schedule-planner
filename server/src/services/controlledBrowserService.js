import crypto from 'node:crypto';
import { MYFCU_START_URL, validateMyFcuHistoryPage, allowedPersonalRequest, isKnownLoginQuery, isDeclaredMyFcuAsset, createHistoryPostRetryGuard } from './myfcuCompatibility.js';
import { collectRealMyFcuHistory, waitForMyFcuHistoryReady } from './myfcuRealHistory.js';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCookies, SESSION_COOKIE_NAME } from './sessionService.js';
import { isIsolatedHistoryMysqlE2E, isSyntheticHistoryIdentity } from './isolatedHistoryE2E.js';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const pocPath = path.resolve(here, '../myfcu/console-poc.js');
const sessions = new Map();
const TTL = 5 * 60 * 1000;
const limit = 3;
const mockHashes = new Set(['', '#/history', '#/courseXd', '#/courseKind1', '#/courseXc', '#/courseKind23', '#/courseSelP', '#/courseSelPno']);
export function isAllowedMockNavigation(candidate, target) {
  try {
    const url = new URL(candidate), expected = new URL(target);
    return url.origin === expected.origin && url.pathname === expected.pathname && !url.search && mockHashes.has(url.hash);
  } catch { return false; }
}
const apiError = (message, status = 400, code) => Object.assign(new Error(message), { status, code, safeControlledBrowserError: true });
export function classifyStartFailure(stage, error, blockedNavigation = false) {
  if (blockedNavigation) return apiError('網站導向不在允許清單內，已停止工作階段。', 503, 'NAVIGATION_BLOCKED');
  if (error?.safeControlledBrowserError === true) return error;
  const message = String(error?.message || '');
  if (/ERR_NAME_NOT_RESOLVED|ENOTFOUND|EAI_AGAIN/i.test(message)) return apiError('無法解析 MyFCU 網域，請檢查 DNS。', 503, 'DNS_ERROR');
  if (/ERR_CERT_|CERTIFICATE|SSL|TLS/i.test(message)) return apiError('安全連線或憑證驗證失敗。', 503, 'TLS_ERROR');
  if (/timeout/i.test(message)) return apiError('載入逾時，請檢查網路連線。', 503, 'TIMEOUT');
  if (/MODULE_NOT_FOUND|Cannot find module/i.test(message)) return apiError('找不到 Playwright，請檢查本機執行環境。', 503, 'PLAYWRIGHT_MISSING');
  if (stage === 'launch') return apiError('無法啟動 Chrome，請確認本機瀏覽器可用。', 503, 'BROWSER_LAUNCH_FAILED');
  if (stage === 'navigation') return apiError('無法載入公開登入頁，請檢查網路及官方網站狀態。', 503, 'NAVIGATION_FAILED');
  return apiError('無法建立瀏覽器工作階段，請重試。', 503, 'BROWSER_SETUP_FAILED');
}
function ownerKey(identity, cookie) {
  const token = parseCookies(cookie)[SESSION_COOKIE_NAME];
  if (!identity?.canonicalId || !token) throw apiError('缺少登入狀態', 401);
  return crypto.createHash('sha256').update(String(identity.canonicalId)).update('\0').update(token).digest('hex');
}
export async function closeOwned(identity, cookie) {
  const owner = ownerKey(identity, cookie);
  await Promise.all([...sessions.entries()].filter(([, s]) => s.owner === owner).map(([id]) => destroy(id)));
}
export async function destroy(id) {
  const s = sessions.get(id); if (!s) return;
  sessions.delete(id); clearTimeout(s.timer);
  await s.context?.close().catch(() => {}); await s.browser?.close().catch(() => {});
  s.context = null; s.browser = null; s.page = null; s.result = null; s.grantHash = null;
}
function sessionFor(id, identity, cookie, grant) {
  const s = sessions.get(id);
  if (!s || s.owner !== ownerKey(identity, cookie)) throw apiError('找不到工作階段', 404);
  if (s.mode === 'real') {
    if (typeof grant !== 'string' || !/^[a-f0-9]{64}$/.test(grant)) throw apiError('找不到工作階段', 404);
    const actual = crypto.createHash('sha256').update(grant).digest();
    if (!s.grantHash || !crypto.timingSafeEqual(actual, s.grantHash)) throw apiError('找不到工作階段', 404);
  }
  if (Date.now() >= s.expires) { void destroy(id); throw apiError('工作階段已逾時', 410); }
  return s;
}
// Fixture-only navigation: real MyFCU needs its own validated readiness signals.
// Parsing, deduplication and conflict handling remain in the shared PoC collector.
export function createMockHistoryDriver(page) {
  return { load: async hash => {
    if (!mockHashes.has(hash) || !hash.startsWith('#/course')) throw apiError('不支援的分類');
    await page.locator(`a[href="${hash}"]`).click();
    await page.waitForFunction(h => location.hash === h && document.body.dataset.loaded === h.slice(2), hash, {timeout:5000});
    return { category:hash, tables:await page.locator('table').evaluateAll(tables => tables.map(table => ({
      headers:[...table.querySelectorAll('thead th')].map(x=>x.textContent.trim()),
      rows:[...table.querySelectorAll('tbody tr')].map(row=>[...row.querySelectorAll('td')].map(x=>x.textContent.trim())),
      rowMeta:[...table.querySelectorAll('tbody tr')].map(row=>({
        colspan:[...row.cells].some(cell=>cell.colSpan > 1),
        rowspan:[...row.cells].some(cell=>cell.rowSpan > 1),
      })),
    }))) };
  } };
}
export function allowedRealPublicRequest(raw, method, navigation) {
  try {
    const u = new URL(raw), start = new URL(MYFCU_START_URL);
    if (u.origin !== start.origin || u.username || u.password || method !== 'GET') return false;
    if (navigation) return u.pathname === start.pathname && Boolean(u.search) && isKnownLoginQuery(u) && !u.hash;
    if (u.pathname === '/main/WebResource.axd' || u.pathname === '/main/ScriptResource.axd') return true;
    return false; // Unconfirmed paths remain blocked, regardless of extension.
  } catch { return false; }
}
// The real driver is deliberately unreachable while protected-page access is disabled.
async function extractHistory(s, mockCollect, syntheticReal) {
  if (s.mode === 'real') {
    if (!syntheticReal) throw apiError('真實修課紀錄擷取尚未開放', 403);
    return collectRealMyFcuHistory(s.page);
  }
  return (mockCollect ?? require(pocPath).collect)(createMockHistoryDriver(s.page));
}
function isHistoryPage(url) {
  try { return validateMyFcuHistoryPage(url).ok; } catch { return false; }
}
export function createLocalBrowserManager({ launch = null, collect = null, ttl = TTL, syntheticRealTest = false } = {}) {
  // Only dependency-injected test browsers may exercise the locked path.
  if (syntheticRealTest && (!launch || !process.env.NODE_TEST_CONTEXT)) throw new Error('僅限隔離測試');
  return {
    async start(identity, cookie, consent, port, mode = 'mock', sessionDeadline = Infinity) {
      if (!['mock', 'real'].includes(mode)) throw apiError('模式無效');
      if (consent !== true) throw apiError('請先同意個資告知');
      if (!identity?.canonicalId || !cookie) throw apiError('缺少登入狀態', 401);
      if (!Number.isInteger(port) || port < 1 || port > 65535) throw apiError('本機服務埠無效');
      const owner = ownerKey(identity, cookie);
      if ([...sessions.values()].some(s => s.owner === owner)) throw apiError('已有進行中的工作階段', 409);
      if (sessions.size >= limit) throw apiError('目前工作階段已滿', 503);
      const grant = mode === 'real' ? crypto.randomBytes(32).toString('hex') : null;
      const id = crypto.randomUUID(), s = { owner, grantHash: grant ? crypto.createHash('sha256').update(grant).digest() : null, expires: Math.min(Date.now() + ttl, sessionDeadline), status:'starting', mode, browser:null, context:null, page:null };
      sessions.set(id, s);
      if (!Number.isFinite(s.expires) || s.expires <= Date.now()) { sessions.delete(id); throw apiError('登入狀態已逾時', 401); }
      s.timer = setTimeout(() => void destroy(id), Math.max(1, s.expires - Date.now())); s.timer.unref?.();
      let stage = 'launch', blockedNavigation = false;
      const beginExtraction = async () => {
        if (!sessions.has(id) || s.status !== 'login') return;
        s.status = 'extracting';
        try {
          if (s.mode === 'real') await waitForMyFcuHistoryReady(s.page);
          if (!sessions.has(id)) return;
          if (isIsolatedHistoryMysqlE2E()) {
            if (!isSyntheticHistoryIdentity(identity)) throw apiError('測試身分不符',403);
            const subject=await s.page.locator('[aria-label="模擬帳號"]').inputValue();
            if(subject!==identity.canonicalId) throw apiError('測試身分不符',403);
          }
          s.result = await extractHistory(s, collect, syntheticRealTest);
          if (sessions.has(id)) s.status = s.result.allCategoriesComplete ? 'ready' : 'incomplete';
        } catch { if (s.mode === 'real') await destroy(id); else if (sessions.has(id)) s.status = 'error'; }
        finally { await s.context?.close().catch(() => {}); await s.browser?.close().catch(() => {}); s.context = null; s.browser = null; s.page = null; }
      };
      s.beginExtraction = beginExtraction;
      try {
        const browser = await (launch ? launch() : require('playwright').chromium.launch({ channel:'chrome', headless:true }));
        if (!sessions.has(id)) { await browser.close(); throw apiError('工作階段已結束', 410); }
        s.browser = browser;
        stage = 'context';
        const context = await browser.newContext({ viewport:{width:390,height:720}, acceptDownloads:false, serviceWorkers:'block' });
        // Cancellation or expiry can occur while Chromium is creating the context.
        if (!sessions.has(id)) { await context.close().catch(() => {}); throw apiError('工作階段已結束', 410); }
        s.context = context;
        // This MVP can only navigate to its fixed synthetic local fixture.
        const target = mode === 'real' ? MYFCU_START_URL : `http://127.0.0.1:${port}/api/controlled-browser/mock`;
        const retryGuard=createHistoryPostRetryGuard();
        await s.context.route('**/*', async route => {
          const request = route.request(), u = request.url();
          let requestContext = {};
          if (syntheticRealTest) { try { const frame=request.frame(); requestContext={sourceUrl:frame.url(),mainFrame:frame===s.page.mainFrame(),phase:s.status}; } catch { /* unknown origin stays blocked */ } }
          let allowed = mode === 'real' ? (allowedRealPublicRequest(u, request.method(), request.isNavigationRequest()) || (syntheticRealTest && allowedPersonalRequest(u, request.method(), request.isNavigationRequest(), requestContext))) : u === target;
          if (!allowed && mode === 'real') {
            const phase=syntheticRealTest && s.page && isHistoryPage(s.page.url()) ? 'history' : s.status;
            const declared=await isDeclaredMyFcuAsset(request,s.page,phase,{allowHistory:syntheticRealTest});
            allowed=declared && sessions.has(id) && (['starting','login'].includes(s.status) || (syntheticRealTest && s.status==='extracting'));
          }
          if (!sessions.has(id)) { await Promise.resolve(route.abort()).catch(()=>{}); return; }
          if (!allowed && mode === 'real' && request.isNavigationRequest()) {
            // An unrelated iframe must not be mistaken for a main-frame redirect.
            let isMain = true; // Fail closed if Playwright cannot identify the frame.
            try { isMain = request.frame() === s.page.mainFrame(); } catch { /* unknown frame */ }
            if (isMain) { blockedNavigation = true; void destroy(id); }
          }
          if (allowed) return route.continue();
          const retry=retryGuard.record({url:u,sourceUrl:requestContext.sourceUrl,method:request.method(),resourceType:request.resourceType?.(),navigation:request.isNavigationRequest(),mainFrame:requestContext.mainFrame});
          if (retry.stop) void destroy(id);
          await Promise.resolve(route.abort()).catch(()=>{});
          return;
        });
        s.page = await s.context.newPage();
        if (mode === 'real') {
          if (typeof s.page.routeWebSocket !== 'function') throw apiError('目前 Playwright 不支援必要的 WebSocket 阻擋。', 503, 'SECURITY_FEATURE_UNAVAILABLE');
          await s.page.routeWebSocket('**/*', socket => socket.close());
        }
        s.page.on('popup', popup => void popup.close().catch(() => {}));
        s.page.on('framenavigated', frame => {
          if (frame !== s.page.mainFrame()) return;
          if (mode === 'real' && syntheticRealTest && isHistoryPage(frame.url())) { void beginExtraction(); return; }
          if (!(mode === 'real' ? allowedRealPublicRequest(frame.url(), 'GET', true) : isAllowedMockNavigation(frame.url(), target))) { if (mode === 'real') blockedNavigation = true; void destroy(id); }
        });
        stage = 'navigation';
        const response = await s.page.goto(target, { waitUntil:'domcontentloaded', timeout:10000 });
        if (mode === 'real' && (!response || !response.ok())) throw apiError('公開登入頁回應錯誤，請稍後重試。', 503, 'HTTP_ERROR');
        if (!sessions.has(id)) throw apiError('工作階段已結束', 410);
        s.status = 'login'; return { id, mode, status:s.status, width:390, height:720, expiresAt:s.expires, ...(grant ? { grant } : {}) };
      } catch (error) { await destroy(id); throw classifyStartFailure(stage, error, blockedNavigation); }
    },
    async state(id, identity, cookie, grant) { const s = sessionFor(id, identity, cookie, grant); return { status:s.status, result:s.result ?? null }; },
    async frame(id, identity, cookie, grant) {
      const s = sessionFor(id, identity, cookie, grant); if (s.status !== 'login') throw apiError('畫面已關閉', 409);
      try { return await s.page.screenshot({ type:'jpeg', quality:55 }); }
      catch { if (s.mode === 'real') await destroy(id); throw apiError('無法取得受控畫面，工作階段已結束', 503); }
    },
    async input(id, identity, cookie, event, grant) {
      const s = sessionFor(id, identity, cookie, grant); if (s.status !== 'login') throw apiError('畫面已關閉', 409);
      if (s.mode === 'real') throw apiError('公開頁僅供檢視，操作尚未開放', 403);
      if (event?.type === 'click' && Number.isFinite(event.x) && Number.isFinite(event.y) && event.x >= 0 && event.x < 390 && event.y >= 0 && event.y < 720) await s.page.mouse.click(event.x, event.y);
      else if (event?.type === 'text' && typeof event.text === 'string' && event.text.length <= 256) await s.page.keyboard.insertText(event.text);
      else if (event?.type === 'key' && ['Backspace','Tab','Enter','ArrowLeft','ArrowRight','Delete'].includes(event.key)) await s.page.keyboard.press(event.key);
      else throw apiError('不支援的操作');
      if (await s.page.evaluate(() => location.hash === '#/history') && s.status === 'login') {
        void s.beginExtraction();
      }
      return { status:s.status };
    },
    async cancel(id, identity, cookie, grant) { sessionFor(id, identity, cookie, grant); await destroy(id); },
  };
}
// Test-only proof is derived from the server-owned fixture session, never request identity fields.
export function verifyIsolatedHistoryProof(identity,cookie,records) {
  if(!isIsolatedHistoryMysqlE2E() || !isSyntheticHistoryIdentity(identity) || !Array.isArray(records)) return false;
  let owner;try{owner=ownerKey(identity,cookie);}catch{return false;}
  const s=[...sessions.values()].find(item=>item.owner===owner && item.status==='ready' && item.expires>Date.now());
  if(!s?.result?.allCategoriesComplete)return false;
  const original=[...(s.result.records??[]),...(s.result.pendingRecords??[])];
  return records.length>0 && records.every(row=>original.some(x=>['courseCode','courseName','academicYear','semester','credits','sourceCreditRecord'].every(k=>(x[k]??null)===(row[k]??null))));
}
export const controlledBrowser = createLocalBrowserManager();
