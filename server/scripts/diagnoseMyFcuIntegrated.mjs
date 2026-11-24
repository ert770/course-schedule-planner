import dns from 'node:dns/promises';
import crypto from 'node:crypto';
import tls from 'node:tls';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { MYFCU_START_URL, allowedPersonalRequest, isKnownLoginQuery, isDeclaredMyFcuAsset, createHistoryPostRetryGuard } from '../src/services/myfcuCompatibility.js';
import { allowedRealPublicRequest } from '../src/services/controlledBrowserService.js';

const require = createRequire(import.meta.url);
const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const officialOrigin = 'https://myfcu.fcu.edu.tw';
// Only fixed, preverified public and destination paths can appear in reports.
const fixedPaths = new Set(['/main/InfoMyFcuLogin.aspx','/main/S3603/S360380_pmust.aspx','/main/WebResource.axd','/main/ScriptResource.axd','/main/S9901/S9901_BannerHomePage.aspx']);
export function describeUrl(raw) {
  try {
    const u = new URL(raw);
    if (u.origin !== officialOrigin || u.username || u.password) return {official:false,origin:'人工確認',path:'人工確認'};
    return {official:true,origin:officialOrigin,path:fixedPaths.has(u.pathname) ? u.pathname : '人工確認'};
  } catch {return {official:false,origin:'人工確認',path:'人工確認'};}
}
// A structural candidate, not proof of a fixed or authorized endpoint. Unknown
// segments are never disclosed. No query, fragment or request data is inspected.
export function describeHistoryEndpoint(raw, context = {}) {
  try {
    const target=new URL(raw), source=new URL(context.sourceUrl);
    if(target.origin!==officialOrigin || target.username || target.password || source.origin!==officialOrigin || source.pathname!=='/main/S3603/S360380_pmust.aspx' || !context.mainFrame || context.navigation || context.resourceType!=='xhr') return null;
    const safe=new Set(['main','S3603','S360380_pmust.aspx','InfoMyFcuLogin.aspx','WebResource.axd','ScriptResource.axd']);
    const generic=/^(?:(?:get|load|fetch|query|select|read|course|courses|history|record|records|data|list|student|academic|year|term|semester|credit|result|service|api|must|pmust|elective|init|page|json|handler|method|web|asp|net|ajax|update|check|is|all|user|info|search|x[dc]|kind|sel|p|no|do|post|retrieve|detail|items|class|grad|requirement|education|school|personal|common|sys|s|c|h|r|f|v|l|_)+)(?:\.(?:asmx|ashx|aspx))?$/i;
    const segments=target.pathname.split('/');let redacted=false;const redactionReasons=[];
    const clean=segments.map((part,index)=>{
      if(!part && index===0)return '';
      if(safe.has(part))return part;
      if(part.length>2 && part.length<=40 && /^[A-Za-z_.]+$/.test(part) && generic.test(part) && !/(token|secret|password|session|cookie|auth|account|credential)/i.test(part)) return part;
      redacted=true;redactionReasons.push(part.length>40?'SEGMENT_TOO_LONG':!part?'EMPTY_SEGMENT':!/^[A-Za-z_.]+$/.test(part)?'NON_ALPHABETIC_OR_DIGITS':/(token|secret|password|session|cookie|auth|account|credential)/i.test(part)?'SENSITIVE_TERM':part.length<=2?'SEGMENT_TOO_SHORT':'NOT_IN_SAFE_VOCABULARY');return '{redacted}';
    });
    return {pathname:clean.join('/'),classification:redacted?'TEMPLATE_REQUIRES_REVIEW':'STATIC_SHAPED_CANDIDATE_NOT_VERIFIED',requiresHumanReview:true,...(redacted?{redactionReasons}:{})};
  } catch {return null;}
}
export function isObservedLoginPost(raw, method, navigation, context = {}) {
  return method === 'POST' && allowedPersonalRequest(raw,method,navigation,context);
}
// Keyed, per-invocation fingerprints correlate endpoints across the two runs
// without printing unknown pathnames or persisting the key.
export function classifyPost(raw, navigation, salt, context = {}) {
  try {
    const u=new URL(raw), start=new URL(MYFCU_START_URL);
    const official=u.origin===officialOrigin && !u.username && !u.password;
    const login=official && u.pathname==='/main/InfoMyFcuLogin.aspx';
    const queryAllowed=isKnownLoginQuery(u);
    const reason=!official?'UNCONFIRMED_ORIGIN':login && !queryAllowed?'LOGIN_QUERY_MISMATCH':login && !isObservedLoginPost(raw,'POST',navigation,context)?'LOGIN_SOURCE_OR_PHASE_UNVERIFIED':login?'ALLOWED_LOGIN':'UNCONFIRMED_POST_PATH';
    return {official,pathname:official && fixedPaths.has(u.pathname)?u.pathname:'需本人確認',endpointId:crypto.createHmac('sha256',salt).update(u.origin).update('\0').update(u.pathname).digest('hex'),reason};
  } catch {return {official:false,pathname:'需本人確認',endpointId:'無法分類',reason:'INVALID_URL'};}
}
// Parameter values and unknown parameter names never leave memory.
export function describeLoginQuery(raw, salt) {
  try {
    const u=new URL(raw);
    if(u.origin!==officialOrigin || u.pathname!=='/main/InfoMyFcuLogin.aspx') return null;
    const fields=[...u.searchParams.keys()].map(name=>name==='Redirect'?'Redirect':'未知參數-'+crypto.createHmac('sha256',salt).update(name).digest('hex').slice(0,16));
    return {parameterCount:fields.length,parameterNames:fields,duplicateNames:new Set(fields).size!==fields.length,knownRedirect:isKnownLoginQuery(u)};
  } catch {return null;}
}
function resourceShape(raw) {
  try {const u=new URL(raw);const path=u.pathname;const m=path.match(/\.(css|js|png|jpe?g|gif|svg|ico|woff2?)$/i);return {official:u.origin===officialOrigin,underMain:path.startsWith('/main/'),depth:path.split('/').filter(Boolean).length,extension:m?m[1].toLowerCase():null};}
  catch {return {official:false,underMain:false,depth:null,extension:null};}
}
// Only non-interactive public-page resources with conservative static-looking paths
// are printed. Suspect or dynamic paths remain redacted and receive an HMAC id.
export function publicStaticPath(raw, type) {
  try {
    const u=new URL(raw), ext={stylesheet:/\.css$/i,script:/\.js$/i,image:/\.(?:png|jpe?g|gif|svg|ico|webp)$/i,font:/\.(?:woff2?|ttf|otf)$/i,other:/\.(?:css|js|png|jpe?g|gif|svg|ico|webp|woff2?|ttf|otf)$/i};
    if(u.origin!==officialOrigin || u.username || u.password || !ext[type]?.test(u.pathname)) return null;
    const path=u.pathname;
    if(path.length>180 || !/^\/[A-Za-z0-9_./-]+$/.test(path) || /\d{6,}|[a-f0-9]{20,}|token|secret|password|session/i.test(path) || path.split('/').some(x=>x.length>48)) return null;
    return path;
  } catch {return null;}
}
function tlsCheck() {return new Promise(resolve=>{const s=tls.connect({host:'myfcu.fcu.edu.tw',port:443,servername:'myfcu.fcu.edu.tw',rejectUnauthorized:true});s.setTimeout(8000,()=>s.destroy());s.once('secureConnect',()=>{s.end();resolve('PASS');});s.once('error',()=>resolve('BLOCKED'));s.once('close',()=>resolve('BLOCKED'));});}
function tests(files, env={}) {
  const run=spawnSync(process.execPath,['--test','--test-reporter=tap',...files],{cwd:serverRoot,env:{...process.env,...env,DB_HOST:'',DB_USER:'',DB_NAME:'',DB_PASSWORD:'',DB_SSL_CA_PATH:''},encoding:'utf8',timeout:60000,windowsHide:true,maxBuffer:4*1024*1024});
  const counts={}; for(const name of ['tests','pass','fail','skipped']) {const m=(run.stdout||'').match(new RegExp(`^# ${name} (\\d+)$`,'m'));if(m)counts[name]=Number(m[1]);}
  return {status:run.status===0?'PASS':run.error?'BLOCKED':'FAIL',...counts};
}
async function observe(manual, networkReady, blockUnknownPost = false, salt = crypto.randomBytes(32), personalPolicy = false, probeTabs = false, publicPolicy = false) {
  if (!networkReady) return {status:'BLOCKED',reason:'DNS_OR_TLS'};
  let browser,context;
  const observations=new Map(), posts=new Map(), denied=new Map(), publicAssets=new Map(), assetRequests=new WeakMap(), queryVariants=new Map(), seenRequests=new WeakMap();
  let historyReached=false, historyTabsPresent=false, blockedUnknownPosts=0, tabDiagnostics=null, angularStatus=null, probeStarted=false, stopReason=null;
  const retryGuard=createHistoryPostRetryGuard(), finalizedPosts=new WeakSet();
  try {
    const {chromium}=require('playwright');
    browser=await chromium.launch({channel:'chrome',headless:!manual});
    context=await browser.newContext({acceptDownloads:false,serviceWorkers:'block'});
    const page=await context.newPage();
    function recordPost(req) {
      if (req.method() !== 'POST') return null;
      if (seenRequests.has(req)) return seenRequests.get(req);
      const nav=req.isNavigationRequest();let kind='resource',source={official:false,origin:'人工確認',path:'人工確認'},requestContext={phase:historyReached?'history':'login'};
      try {const f=req.frame();source=describeUrl(f.url());requestContext={...requestContext,sourceUrl:f.url(),mainFrame:f===page.mainFrame()};if(nav)kind=f.page()!==page?'other-page':requestContext.mainFrame?'main':'iframe';} catch {if(nav)kind='unknown';}
      const info=classifyPost(req.url(),nav,salt,requestContext);
      const queryStructure=describeLoginQuery(req.url(),salt);
      if(queryStructure){const normalized=[...new URL(req.url()).searchParams.entries()].sort(([ak,av],[bk,bv])=>ak.localeCompare(bk)||av.localeCompare(bv));const digest=crypto.createHmac('sha256',salt).update(JSON.stringify(normalized)).digest('hex');const variants=queryVariants.get(info.endpointId)??new Set();variants.add(digest);queryVariants.set(info.endpointId,variants);}
      const endpointPath=describeHistoryEndpoint(req.url(),{...requestContext,navigation:nav,resourceType:req.resourceType()});
      const entry={...info,...(endpointPath?{endpointPath}:{}),source,kind,resourceType:req.resourceType(),pathShape:resourceShape(req.url()),queryStructure,phase:historyReached?'history-or-later':'before-history',action:blockUnknownPost && info.reason!=='ALLOWED_LOGIN'?'blocked':'allowed',httpStatus:null};
      seenRequests.set(req,entry);return entry;
    }
    function finalizePost(req) {
      if(finalizedPosts.has(req)) return;
      const entry=recordPost(req); if(!entry) return;
      finalizedPosts.add(req); const key=JSON.stringify(entry);
      posts.set(key,{...entry,count:(posts.get(key)?.count??0)+1});
    }
    context.on('request',req=>{try{recordPost(req);}catch{/* no raw request output */}});
    if (blockUnknownPost || personalPolicy || publicPolicy) await context.route('**/*',async route=>{
      const req=route.request(), method=req.method(), nav=req.isNavigationRequest();
      if(stopReason){await route.abort().catch(()=>{});return;}
      let info={phase:historyReached?'history':'login'};
      try {const frame=req.frame();info={...info,mainFrame:frame===page.mainFrame(),sourceUrl:frame.url()};} catch { /* fail closed for unknown frame */ }
      let allowed=publicPolicy ? allowedRealPublicRequest(req.url(),method,nav) : personalPolicy ? allowedPersonalRequest(req.url(),method,nav,info) : method!=='POST' || recordPost(req)?.reason==='ALLOWED_LOGIN';
      if (!allowed && (personalPolicy || publicPolicy)) allowed=await isDeclaredMyFcuAsset(req,page,info.phase,{allowHistory:personalPolicy});
      if(stopReason){await route.abort().catch(()=>{});return;}
      if((publicPolicy || personalPolicy) && !nav && method==='GET') {
        const location=describeUrl(req.url()), endpoint=classifyPost(req.url(),false,salt);
        const item={phase:historyReached?'history-or-later':'before-history',resourceType:req.resourceType(),official:location.official,origin:location.origin,pathname:(publicPolicy && !historyReached ? publicStaticPath(req.url(),req.resourceType()) : null) || location.path,pathShape:resourceShape(req.url()),endpointId:endpoint.endpointId,action:allowed?'allowed':'blocked',httpStatus:null};
        assetRequests.set(req,item);
      }
      if (allowed) return route.continue();
      const post=recordPost(req);if(method==='POST'){blockedUnknownPosts++;if(post)post.action='blocked';finalizePost(req);}
      const retry=retryGuard.record({url:req.url(),sourceUrl:info.sourceUrl,method,resourceType:req.resourceType(),navigation:nav,mainFrame:info.mainFrame});
      const location=describeUrl(req.url()), endpoint=classifyPost(req.url(),nav,salt);
      const publicPath=publicPolicy && !nav && method==='GET' ? publicStaticPath(req.url(),req.resourceType()) : null;
      const item={method:['GET','POST'].includes(method)?method:'OTHER',kind:nav?(info.mainFrame?'main':'iframe'):'resource',resourceType:req.resourceType(),phase:historyReached?'history-or-later':'before-history',official:location.official,origin:location.origin,pathname:publicPath || location.path,reason:nav?'NAVIGATION_NOT_ALLOWED':'RESOURCE_NOT_DECLARED_OR_UNVERIFIED',pathShape:resourceShape(req.url()),endpointId:endpoint.endpointId};
      const key=JSON.stringify(item);if(denied.size<120 || denied.has(key))denied.set(key,{...item,count:(denied.get(key)?.count??0)+1});
      if(retry.stop && !stopReason){stopReason='HISTORY_POST_RETRY_LIMIT';tabDiagnostics={status:'INCOMPLETE',reason:stopReason};stdout.write('修課頁請求遭反覆封鎖，已停止以避免持續重試。\n');void context.close().catch(()=>{});}
      await route.abort().catch(()=>{});
    });
    function finishAsset(req){const item=assetRequests.get(req);if(!item)return;const key=JSON.stringify(item);if(publicAssets.size<120 || publicAssets.has(key))publicAssets.set(key,{...item,count:(publicAssets.get(key)?.count??0)+1});}
    context.on('requestfinished',req=>{try{finishAsset(req);finalizePost(req);}catch{/* no raw data */}});
    context.on('requestfailed',req=>{try{finishAsset(req);finalizePost(req);}catch{/* no raw data */}});
    context.on('response',response=>{
      try {
        const req=response.request(), nav=req.isNavigationRequest();
        const post=recordPost(req); if(post)post.httpStatus=response.status();
        const asset=assetRequests.get(req);if(asset)asset.httpStatus=response.status();
        let kind='resource';
        if(nav) {try {const frame=req.frame();kind=frame.page()!==page?'other-page':frame===page.mainFrame()?'main':'iframe';} catch {kind='unknown';}}
        const location=describeUrl(response.url());
        const method=req.method();
        if (nav && kind === 'main' && location.path === '/main/S3603/S360380_pmust.aspx' && response.ok()) {
          historyReached=true;
          void page.waitForLoadState('domcontentloaded').then(()=>page.waitForTimeout(1500)).then(()=>page.evaluate(()=>{
            try {const angular=window.angular;const injector=angular?.element(document.body)?.injector?.() ?? angular?.element(document.documentElement)?.injector?.();return {libraryPresent:Boolean(angular),injectorReady:Boolean(injector)};} catch {return {libraryPresent:Boolean(window.angular),injectorReady:false};}
          })).then(value=>{angularStatus=value;}).catch(()=>{});
          void page.waitForFunction(()=>['#/courseXd','#/courseKind1','#/courseXc','#/courseKind23','#/courseSelP','#/courseSelPno'].every(hash=>[...document.querySelectorAll('a[href]')].some(link=>link.getAttribute('href')===hash)),null,{timeout:12000}).then(async()=>{
            historyTabsPresent=true;
            if (!probeTabs || probeStarted) return;
            probeStarted=true; stdout.write('已偵測分類頁，開始去敏分類載入測試；請暫勿關閉視窗。\n');
            try {
              const {collectRealMyFcuHistory}=await import('../src/services/myfcuRealHistory.js');
              const result=await collectRealMyFcuHistory(page);
              tabDiagnostics={status:result.allCategoriesComplete?'COMPLETE':'INCOMPLETE',totalElapsedMs:result.totalElapsedMs,summary:{rawRows:result.summary?.rawRows??0,duplicateRows:result.duplicateRows??0,excludedRows:result.summary?.excludedRows??0,anomalyRows:result.summary?.anomalyRows??0,pendingRows:result.summary?.pendingRows??0,candidateRows:result.summary?.candidateRows??0,conflicts:result.conflicts??0},categories:result.categories.map(c=>({hash:c.hash,status:c.status,elapsedMs:c.elapsedMs,rawRows:c.rowSummary?.rawRows??null,validRows:c.rowSummary?.validRows??null,pendingRows:c.rowSummary?.pendingRows??null,excludedRows:c.rowSummary?.excludedRows??null,invalidRows:c.rowSummary?.invalidRows??null}))};
            } catch {if(!stopReason)tabDiagnostics={status:'ERROR',reason:'EXTRACTION_FAILED'};}
            stdout.write('分類載入測試已結束，請關閉視窗以顯示去敏報告。\n');
          }).catch(()=>{});
        }
        const item={...location,kind,method:['GET','POST'].includes(method)?method:'OTHER',phase:historyReached?'history-or-later':'before-history',httpStatus:response.status()};
        // Aggregate only sanitized values; no headers, bodies, screenshots or full URLs.
        const key=JSON.stringify(item);
        if (observations.has(key)) observations.get(key).count++;
        else if(observations.size<120)observations.set(key,{...item,count:1});
      } catch { /* never print browser errors or network content */ }
    });
    const res=await page.goto(MYFCU_START_URL,{waitUntil:'domcontentloaded',timeout:20000});
    const status=res?.ok()?'PASS':'FAIL';
    if (publicPolicy && status==='PASS') await page.waitForLoadState('load',{timeout:5000}).catch(()=>{});
    if(manual && status==='PASS') {
      // User alone operates the local browser. No keyboard or credential capture.
      let timer;
      await Promise.race([page.waitForEvent('close').catch(()=>{}),new Promise(resolve=>{timer=setTimeout(resolve,300000);timer.unref?.();})]);
      clearTimeout(timer);
    }
    return {status:manual && status==='PASS' && (!historyReached || (probeTabs && (!historyTabsPresent || tabDiagnostics?.status!=='COMPLETE'))) ? 'INCOMPLETE':status,mode:manual?'USER_OPERATED':'PUBLIC_ONLY',historyReached,historyTabsPresent,angularStatus,blockedUnknownPosts,stopReason,publicResources:[...publicAssets.values()],deniedRequests:[...denied.values()],tabDiagnostics,postSummary:[...posts.values()].map(item=>({...item,queryStructureOrValuesChanged:(queryVariants.get(item.endpointId)?.size??0)>1})),observations:[...observations.values()],unknownPostNecessity:'UNCONFIRMED'};
  } catch {return {status:'BLOCKED',reason:'BROWSER_OR_NAVIGATION',observations:[...observations.values()]};}
  finally {await context?.close().catch(()=>{});await browser?.close().catch(()=>{});}
}
async function main() {
  const compare=process.argv.includes('--compare-posts');
  const publicPolicy=process.argv.includes('--public-resources');
  const personalPolicy=process.argv.includes('--personal-policy');
  const probeTabs=process.argv.includes('--probe-tabs');
  const manual=compare || process.argv.includes('--observe-login');
  const blockUnknownPost=process.argv.includes('--block-unknown-post');
  if ((blockUnknownPost || personalPolicy || probeTabs) && !manual) {stdout.write(JSON.stringify({status:'BLOCKED',reason:'MANUAL_MODE_REQUIRED'})+'\n');return;}
  if(manual) {
    if(personalPolicy) stdout.write('本次會使用待驗證的嚴格本人模式規則，未知 GET／POST 將被阻擋。\n');
    if(probeTabs) stdout.write('到達六分類頁後將自動執行去敏分類測試，不會儲存或輸出課程資料。\n');
    if(compare) stdout.write('將依序開啟兩個隔離視窗：第一個正常觀察，第二個阻擋未知 POST；請在每個視窗自行登入並關閉。\n');
    if(blockUnknownPost) stdout.write('本次將阻擋非已確認登入端點的所有 POST；可能影響官方頁面功能。\n');
    stdout.write('將開啟全新、非持久化的本機 Chrome；請自行登入，完成後關閉視窗。程式不讀取輸入、Cookie、Token、頁面內容或 POST body。作業系統與瀏覽器仍可能保留暫存。\n');
    const rl=createInterface({input:stdin,output:stdout});const answer=await rl.question('確認本人同意手動觀察？請輸入 YES：');rl.close();
    if(answer!=='YES') {stdout.write(JSON.stringify({status:'CANCELLED'})+'\n');return;}
  }
  let dnsStatus='BLOCKED';try {await dns.lookup('myfcu.fcu.edu.tw');dnsStatus='PASS';}catch{}
  const tlsStatus=dnsStatus==='PASS'?await tlsCheck():'BLOCKED';
  const salt=crypto.randomBytes(32);
  let observation;
  if(compare) {
    const baseline=await observe(true,dnsStatus==='PASS'&&tlsStatus==='PASS',false,salt);
    stdout.write('第一階段結束；接著開啟阻擋未知 POST 的第二階段。\n');
    const blocked=await observe(true,dnsStatus==='PASS'&&tlsStatus==='PASS',true,salt);
    const before=baseline.postSummary??[];
    const difference=(blocked.postSummary??[]).filter(x=>x.action==='blocked').map(x=>({endpointId:x.endpointId,kind:x.kind,reason:x.reason,blockedCount:x.count,baselineCount:before.filter(previous=>previous.endpointId===x.endpointId).reduce((sum,previous)=>sum+previous.count,0),baselineStatuses:[...new Set(before.filter(previous=>previous.endpointId===x.endpointId).map(previous=>previous.httpStatus))]}));
    observation={baseline,blocked,difference,interpretation:baseline.historyTabsPresent&&!blocked.historyTabsPresent&&difference.length?'OUTCOME_DIFFERS_CORRELATION_ONLY':'NO_CAUSAL_CONCLUSION'};
  } else observation=await observe(manual,dnsStatus==='PASS'&&tlsStatus==='PASS',blockUnknownPost,salt,personalPolicy,probeTabs,publicPolicy);
  const report={publicNetwork:{dns:dnsStatus,tls:tlsStatus},
    localSecurity:tests(['test/controlledBrowser.test.js','test/controlledBrowserCompatibility.test.js','test/controlledBrowserMockSetup.test.js','test/controlledBrowserSensitive.test.js']),
    syntheticBrowser:tests(['test/controlledBrowserPlaywright.test.js'],{RUN_CONTROLLED_BROWSER_PLAYWRIGHT:'true'}),
    poc:tests(['test/myfcu61Rows.test.js','test/myfcuCreditScore.test.js']),
    observation,
    limitations:['本人登入功能保持關閉','未驗證代理、作業系統與瀏覽器暫存是否留存敏感資料','未知網域與非固定路徑需人工確認','一般 Chrome 登入與本程式 Context 不共用'],
  };
  stdout.write(JSON.stringify(report,null,2)+'\n');
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) await main();
