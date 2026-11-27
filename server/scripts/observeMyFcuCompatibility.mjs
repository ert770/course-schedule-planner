import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { MYFCU_START_URL, validateMyFcuHistoryPage } from '../src/services/myfcuCompatibility.js';
import { collectRealMyFcuHistory, waitForMyFcuHistoryReady } from '../src/services/myfcuRealHistory.js';
import { canSnapshotHistory } from '../src/services/historySnapshot.js';
import { describeHistoryEndpoint } from './diagnoseMyFcuIntegrated.mjs';

const origin='https://myfcu.fcu.edu.tw';
const login='/main/InfoMyFcuLogin.aspx', history='/main/S3603/S360380_pmust.aspx';
const tabs=new Set(['#/courseXd','#/courseKind1','#/courseXc','#/courseKind23','#/courseSelP','#/courseSelPno']);
const require=createRequire(import.meta.url);

// Observation only; never import this relaxed network policy into the service.
export function allowObservationRequest(raw,{navigation=false,mainFrame=false,strictFrames=false,method='GET'}={}) {
  try { const u=new URL(raw); if(u.origin!==origin || u.username || u.password) return false;
    if(navigation && mainFrame)return [login,history].includes(u.pathname);
    if(navigation && strictFrames)return method==='GET' && u.pathname==='/main/S9901/S9901_BannerHomePage.aspx';
    return true;
  } catch {return false;}
}
export function safeObservationPath(raw, sourceUrl, resourceType, salt) {
  try {
    const u=new URL(raw);if(u.origin!==origin || u.username || u.password)return null;
    const shaped=describeHistoryEndpoint(raw,{sourceUrl,mainFrame:true,navigation:false,resourceType:'xhr'});
    const known=[login,history,'/main/WebResource.axd','/main/ScriptResource.axd'];
    const endpoint=known.includes(u.pathname)?{pathname:u.pathname,classification:'KNOWN_FIXED_PATH'}:(shaped??{pathname:'/{redacted}',classification:'TEMPLATE_REQUIRES_REVIEW'});
    return {...endpoint,endpointId:crypto.createHmac('sha256',salt).update(u.origin).update('\0').update(u.pathname).digest('hex').slice(0,24)};
  }catch{return null;}
}
export async function observeMyFcu({chromium,timeoutMs=300000,keepOnFailure=false,inspectionMs=120000,initTimeoutMs=45000,signal=null,onResult=null,strictFrames=false,launchEnv=null,allowPartialRows=false}) {
  let browser,context,page,timer,abortHandler,done=false,phase='login',lastTab=null, blocked=0, historyReached=false, result=null, reason=null, resolveWait=null, extractionError=null, historyArrivalUrl=null;
  const salt=crypto.randomBytes(32),requests=new WeakMap(),summary=new Map(),startedAt=Date.now(),stages=[];
  const stage=(name,status)=>stages.push({name,status,elapsedMs:Date.now()-startedAt});
  const finish=(resolve,why)=>{if(done)return;done=true;reason=why;resolve();};
  try {
    browser=await chromium.launch({channel:'chrome',headless:false,...(launchEnv?{env:launchEnv}:{})});
    context=await browser.newContext({acceptDownloads:false,serviceWorkers:'block'});
    if(strictFrames)await context.addInitScript(()=>{for(const name of ['RTCPeerConnection','webkitRTCPeerConnection','WebTransport']){try{Object.defineProperty(window,name,{value:undefined,writable:false,configurable:false});}catch{}}});
    if(signal?.aborted)throw Error('CANCELLED');
    abortHandler=()=>void context?.close().catch(()=>{});signal?.addEventListener('abort',abortHandler,{once:true});
    page=await context.newPage();
    if(typeof page.routeWebSocket!=='function')throw Error('WS_GUARD_UNAVAILABLE');
    await page.routeWebSocket('**/*',socket=>socket.close());
    page.on('popup',p=>void p.close().catch(()=>{}));
    await context.route('**/*',async route=>{
      const req=route.request();let mainFrame=false;try{mainFrame=req.frame()===page.mainFrame();}catch{}
      if(!allowObservationRequest(req.url(),{navigation:req.isNavigationRequest(),mainFrame,strictFrames,method:req.method()})){blocked++;if(mainFrame && req.isNavigationRequest()){stage('navigation','NAVIGATION_BLOCKED');if(resolveWait)finish(resolveWait,'NAVIGATION_BLOCKED');}return route.abort();}
      return route.continue();
    });
    context.on('request',req=>{try{
      const kind=req.resourceType();if(!['xhr','fetch'].includes(kind))return;
      const frame=req.frame();if(frame!==page.mainFrame())return;
      const source=new URL(frame.url());if(source.origin!==origin || ![login,history].includes(source.pathname))return;
      const endpoint=safeObservationPath(req.url(),frame.url(),kind,salt);if(!endpoint)return;
      const hash=source.pathname===history&&tabs.has(source.hash)?source.hash:null;
      if(hash && hash!==lastTab){lastTab=hash;}
      requests.set(req,{method:['GET','POST'].includes(req.method())?req.method():'OTHER',resourceType:kind,sourcePath:source.pathname,phase,category:hash,elapsedSecond:Math.floor((Date.now()-startedAt)/1000),...endpoint});
    }catch{}});
    context.on('response',res=>{try{
      const entry=requests.get(res.request());if(!entry)return;
      const key=JSON.stringify({...entry,httpStatus:res.status()});
      if(summary.size<200||summary.has(key))summary.set(key,{...entry,httpStatus:res.status(),count:(summary.get(key)?.count??0)+1});
    }catch{}});
    const wait=new Promise(resolve=>{
      resolveWait=resolve;
      timer=setTimeout(()=>finish(resolve,'TIMEOUT'),timeoutMs);timer.unref?.();
      page.on('close',()=>finish(resolve,'CONTEXT_CLOSED'));
      page.on('framenavigated',frame=>{
        if(done)return;
        if(strictFrames && frame===page.mainFrame() && frame.url()!=='about:blank' && !allowObservationRequest(frame.url(),{navigation:true,mainFrame:true,strictFrames:true})){stage('navigation','NAVIGATION_BLOCKED');finish(resolve,'NAVIGATION_BLOCKED');void context.close().catch(()=>{});return;}
        if(frame!==page.mainFrame())return;
        let u;try{u=new URL(frame.url());}catch{return;}
        if(!validateMyFcuHistoryPage(frame.url()).ok || historyReached)return;
        historyArrivalUrl=frame.url();
        historyReached=true;stage('login','HISTORY_REDIRECT');phase='history';stage('history','REACHED');
        void (async()=>{
          const fail=(code)=>{stage(phase,code);finish(resolve,page.isClosed()?'CONTEXT_CLOSED':code);};
          try {await waitForMyFcuHistoryReady(page,{timeout:initTimeoutMs,onStage:(name,status)=>{phase=name;stage(name,status);}});}
          catch(error){phase=error?.stage??'page_init';fail(error?.code??'PAGE_INIT_FAILED');return;}
          try {phase='extracting';stage(phase,'STARTED');const collected=await collectRealMyFcuHistory(page);
            const partial = !collected.allCategoriesComplete && allowPartialRows && canSnapshotHistory(collected);
            const status = collected.allCategoriesComplete ? 'COMPLETE' : partial ? 'PARTIAL' : 'INCOMPLETE';
            if (!signal?.aborted && status !== 'INCOMPLETE' && onResult) await onResult(collected);
            result={status,elapsedMs:collected.totalElapsedMs,summary:{rawRows:collected.summary?.rawRows??0,duplicateRows:collected.duplicateRows??0,excludedRows:collected.summary?.excludedRows??0,anomalyRows:collected.summary?.anomalyRows??0,pendingRows:collected.summary?.pendingRows??0,candidateRows:collected.summary?.candidateRows??0,conflicts:collected.conflicts??0},categories:collected.categories.map(c=>({category:c.hash,status:c.status,elapsedMs:c.elapsedMs,reason:c.status==='complete'?null:(!c.diagnostics?.completionBasis && c.elapsedMs>=14000?'CATEGORY_TIMEOUT':'CATEGORY_INCOMPLETE'),completionBasis:c.diagnostics?.completionBasis??null,dataState:c.diagnostics?.dataState??null,rawRows:c.rowSummary?.rawRows??null,validRows:c.rowSummary?.validRows??null,excludedRows:c.rowSummary?.excludedRows??null,invalidRows:c.rowSummary?.invalidRows??null,rowReviewOnly:c.rowReviewOnly??null,unresolvedReasons:(c.rowSummary?.details??[]).filter(d=>d?.kind==='unresolved').flatMap(d=>(d.reasons??[]).map(r=>`${r}${d.merged?'(merged)':''}`)).reduce((acc,r)=>(acc[r]=(acc[r]??0)+1,acc),{}),unrecognizedSemesters:[...new Set((c.rowSummary?.details??[]).map(d=>d?.semesterText).filter(Boolean))]}))};
            const endReason = status === 'COMPLETE' ? 'EXTRACTION_FINISHED' : partial ? 'PARTIAL_ROWS'
              : result.categories.some(category => category.reason === 'CATEGORY_TIMEOUT') ? 'CATEGORY_TIMEOUT' : 'CATEGORY_INCOMPLETE';
            stage(phase,status);finish(resolve,endReason);
          } catch(error) {extractionError={stage:error?.stage??'unknown',code:error?.code??'UNEXPECTED_FAILURE',...(error?.errorType?{errorType:error.errorType}:{}),...(error?.position?{position:error.position}:{}),...(error?.failedCheck?{failedCheck:error.failedCheck}:{}),...(error?.routeNormalization?{routeNormalization:error.routeNormalization}:{}),...(error?.failedCheck==='HASH_REJECTED'?{hashShape:(()=>{try{const h=new URL(page.url()).hash;return {empty:!h,rootSlash:h==='#/',bangRoot:h==='#!'||h==='#!/',hasQuery:h.includes('?'),startsSlash:h.startsWith('#/'),startsBang:h.startsWith('#!'),lengthBucket:h.length===0?'zero':h.length<=3?'short':h.length<=32?'medium':'long'};}catch{return {unavailable:true};}})()}:{}),urlChangedSinceArrival:historyArrivalUrl!==page.mainFrame().url(),pageMatchesMainFrame:page.url()===page.mainFrame().url()};fail('EXTRACTION_FAILED');}
        })();
      });
    });
    await page.goto(MYFCU_START_URL,{waitUntil:'domcontentloaded',timeout:30000});
    await wait;
    clearTimeout(timer);
    if(keepOnFailure && reason!=='EXTRACTION_FINISHED' && !page.isClosed()){
      stdout.write('擷取未完成；視窗將保留供本人檢查，關閉視窗或等待逾時後自動清理。\n');
      let inspectionTimer;await Promise.race([page.waitForEvent('close').catch(()=>{}),new Promise(resolve=>{inspectionTimer=setTimeout(resolve,Math.min(Math.max(inspectionMs,1000),120000));})]);clearTimeout(inspectionTimer);
    }
    return {stages,extractionError,status:result?.status??'INCOMPLETE',reason,historyReached,blockedRequests:blocked,categories:result,apiObservations:[...summary.values()],interpretation:'請求時間關聯不證明用途或必要性；候選路徑須另行核實，不能自動加入白名單'};
  }catch{return {status:'BLOCKED',reason:page?.isClosed()?'CONTEXT_CLOSED':stages.some(x=>x.status==='NAVIGATION_BLOCKED')?'NAVIGATION_BLOCKED':'PAGE_INIT_FAILED',stages,historyReached,blockedRequests:blocked};}
  finally{clearTimeout(timer);if(abortHandler)signal?.removeEventListener('abort',abortHandler);await context?.close().catch(()=>{});await browser?.close().catch(()=>{});}
}
async function main(){
  if(process.platform!=='win32'){stdout.write('僅供 Windows 本機執行。\n');return;}
  stdout.write('將在本機獨立 Chrome 由本人操作官方登入；程式不讀取或保存帳密、Cookie、請求內容或修課內容。瀏覽器及作業系統可能產生暫存。\n');
  const rl=createInterface({input:stdin,output:stdout});const answer=await rl.question('確認本人同意本機觀察？請輸入 YES：');rl.close();if(answer!=='YES'){stdout.write('已取消。\n');return;}
  try{const report=await observeMyFcu({chromium:require('playwright').chromium,keepOnFailure:process.argv.includes('--keep-on-failure')});stdout.write(JSON.stringify(report,null,2)+'\n');}catch{stdout.write('{"status":"BLOCKED","reason":"PLAYWRIGHT_UNAVAILABLE"}\n');}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))await main();
