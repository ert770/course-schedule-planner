import { createRequire } from 'node:module';
import { MYFCU_START_URL } from '../src/services/myfcuCompatibility.js';
import { allowedRealPublicRequest } from '../src/services/controlledBrowserService.js';
const require = createRequire(import.meta.url);
// No query, hash, userinfo, cookies, request headers, or response bodies are printed.
function sanitizedUrl(raw) {
  try {
    const u = new URL(raw);
    if (!['http:', 'https:'].includes(u.protocol)) return '(非 HTTP 網址)';
    const parts=u.pathname.split('/').map(segment => /[%@]|[a-zA-Z0-9_-]{25,}/.test(segment) ? '[已隱藏]' : segment);
    return u.origin + parts.join('/');
  } catch { return '(無法辨識)'; }
}
function why(raw, method, navigation) {
  try {
    const u=new URL(raw), start=new URL(MYFCU_START_URL);
    if(method !== 'GET') return 'method-not-GET';
    if(u.username||u.password) return 'userinfo-forbidden';
    if(u.origin!==start.origin) return 'origin-not-allowed';
    if(navigation && u.pathname!==start.pathname) return 'navigation-path-not-allowed';
    if(navigation && (u.search!==start.search || u.hash)) return 'navigation-parameters-not-allowed';
    return 'resource-path-not-allowed';
  } catch {return 'invalid-url';}
}
let browser,context,page;
const entries=[];
try {
  const {chromium}=require('playwright');
  browser=await chromium.launch({channel:'chrome',headless:true});
  context=await browser.newContext({acceptDownloads:false,serviceWorkers:'block'});
  page=await context.newPage();
  if(typeof page.routeWebSocket!=='function') throw new Error('WEBSOCKET_GUARD_UNAVAILABLE');
  await page.routeWebSocket('**/*',socket=>socket.close());
  await context.route('**/*',route=>{
    const req=route.request(), navigation=req.isNavigationRequest();
    const allowed=allowedRealPublicRequest(req.url(),req.method(),navigation);
    if(!allowed) {
      let frame, kind='resource';
      if(navigation) { try {frame=req.frame();kind=frame===page.mainFrame()?'main':'iframe';} catch {kind='unknown-navigation';} }
      let originSource='(無)';
      try { originSource=sanitizedUrl(req.redirectedFrom()?.url() || frame?.parentFrame()?.url() || frame?.url() || ''); } catch { /* unavailable */ }
      if(entries.length<30) entries.push({kind,stage:req.redirectedFrom()?'http-redirect':navigation?'navigation':'resource',source:originSource,target:sanitizedUrl(req.url()),reason:why(req.url(),req.method(),navigation)});
      return route.abort();
    }
    return route.continue();
  });
  page.on('popup',p=>void p.close().catch(()=>{}));
  try { const response=await page.goto(MYFCU_START_URL,{waitUntil:'domcontentloaded',timeout:15000}); console.log(JSON.stringify({result:response?.ok()?'loaded':'http-failure',httpStatus:response?.status()??null,blocked:entries},null,2)); }
  catch (error) {
    const text=String(error?.message||'');
    const reason=/ERR_NAME_NOT_RESOLVED|ENOTFOUND/i.test(text)?'DNS_ERROR':/ERR_CERT_|SSL|TLS/i.test(text)?'TLS_ERROR':/timeout/i.test(text)?'TIMEOUT':entries.some(x=>x.kind==='main'||x.kind==='unknown-navigation')?'NAVIGATION_BLOCKED':'NAVIGATION_FAILED';
    console.log(JSON.stringify({result:'navigation-failed',reason,blocked:entries},null,2));process.exitCode=1;
  }
} catch {console.log(JSON.stringify({result:'browser-setup-failed',blocked:entries},null,2));process.exitCode=1;}
finally {await context?.close().catch(()=>{});await browser?.close().catch(()=>{});}
