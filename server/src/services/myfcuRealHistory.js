import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { validateMyFcuHistoryPage } from './myfcuCompatibility.js';

const poc = fileURLToPath(new URL('../myfcu/console-poc.js', import.meta.url));
const expectedPath = '/main/S3603/S360380_pmust.aspx';
function failure(stage,code,extra={}) {
  return Object.assign(new Error('修課紀錄擷取未完成'),{stage,code,...extra});
}
// Shared readiness gate for the local observer and the locked controlled service.
export async function waitForMyFcuHistoryReady(page,{timeout=45000,onStage=()=>{}}={}) {
  const run=async(name,code,fn)=>{try{await fn();onStage(name,'READY');}catch{throw failure(name,code);}};
  await run('page_init','PAGE_INIT_FAILED',async()=>{
    await page.waitForLoadState('domcontentloaded',{timeout});
    await page.waitForFunction(()=>{try{const a=window.angular;return Boolean(a&&(a.element(document.body)?.injector?.()||a.element(document.documentElement)?.injector?.()));}catch{return false;}},null,{timeout});
  });
  await run('tabs','TABS_NOT_READY',()=>page.waitForFunction(()=>['#/courseXd','#/courseKind1','#/courseXc','#/courseKind23','#/courseSelP','#/courseSelPno'].every(h=>[...document.querySelectorAll('a[href]')].some(a=>a.getAttribute('href')===h)),null,{timeout}));
  await run('initial_data','PAGE_INIT_FAILED',()=>page.waitForFunction(()=>{const visible=n=>{const s=getComputedStyle(n);return s.display!=='none'&&s.visibility!=='hidden'&&Boolean(n.getClientRects().length||n.offsetWidth||n.offsetHeight);};return [...document.querySelectorAll('table')].some(visible)&&![...document.querySelectorAll('[aria-busy="true"],[role="progressbar"],.loading,.spinner')].some(visible);},null,{timeout}));
}
// No raw exception, URLs, script text, course rows or credentials leave this boundary.
export async function collectRealMyFcuHistory(page) {
  let frameUrl,pageUrl;
  try {frameUrl=page.mainFrame().url();pageUrl=page.url();} catch {throw failure('page_validation','HISTORY_URL_REJECTED',{failedCheck:'UNEXPECTED_URL_SOURCE'});}
  if(frameUrl!==pageUrl)throw failure('page_validation','HISTORY_URL_REJECTED',{failedCheck:'UNEXPECTED_URL_SOURCE'});
  const validation=validateMyFcuHistoryPage(pageUrl);
  if(!validation.ok)throw failure('page_validation','HISTORY_URL_REJECTED',{failedCheck:validation.failedCheck});
  let source;
  try {source=await readFile(poc,'utf8');} catch {throw failure('poc_load','POC_READ_FAILED');}
  let outcome;
  try {
    outcome=await page.evaluate(async script => {
      let stage='poc_compile';
      try {
        const exported={exports:{}};
        new Function('module','globalThis',script)(exported,window);
        stage='poc_exports';
        const {TABS,collect,createBrowserDriver}=exported.exports;
        if(!Array.isArray(TABS)||TABS.length!==6||typeof collect!=='function'||typeof createBrowserDriver!=='function')return {ok:false,stage,code:'POC_EXPORTS_INVALID'};
        stage='browser_validation';
        const angular=window.angular;const injector=angular?.element(document.body)?.injector?.()??angular?.element(document.documentElement)?.injector?.();
        const validLink=hash=>[...document.querySelectorAll('a[href]')].some(a=>{try{const target=new URL(a.getAttribute('href'),document.baseURI);return a.getAttribute('href')===hash && (!a.target||a.target==='_self') && !a.hasAttribute('download') && target.origin===location.origin && target.pathname===location.pathname && target.hash===hash;}catch{return false;}});
        if(location.origin!=='https://myfcu.fcu.edu.tw'||location.pathname!=='/main/S3603/S360380_pmust.aspx'||!injector||!document.querySelector('table')||!TABS.every(validLink))return {ok:false,stage,code:'HISTORY_DOM_INVALID'};
        stage='driver_init';const driver=createBrowserDriver(window);
        stage='collect';const result=await collect(driver,{creditRecordVerified:true,includeTrace:true});
        stage='serialization';
        // Check serializability inside the page before crossing Playwright's boundary.
        return {ok:true,result:JSON.parse(JSON.stringify(result))};
      } catch(error) {
        const allowed=new Set(['Error','TypeError','ReferenceError','SyntaxError','EvalError','RangeError']);
        const name=allowed.has(error?.name)?error.name:'Error';
        const match=String(error?.stack??'').match(/<anonymous>:(\d{1,6}):(\d{1,6})/);
        return {ok:false,stage,code:'BROWSER_EXECUTION_FAILED',errorType:name,...(match?{position:{line:Number(match[1]),column:Number(match[2])}}:{})};
      }
    },source);
  } catch(error) {
    const message=String(error?.message??'');
    const code=page.isClosed?.()?'CONTEXT_CLOSED':/execution context was destroyed|navigation/i.test(message)?'EXECUTION_CONTEXT_LOST':/serializ/i.test(message)?'RESULT_SERIALIZATION_FAILED':'PAGE_EVALUATE_FAILED';
    throw failure('page_evaluate',code);
  }
  if(!outcome?.ok)throw failure(outcome?.stage??'page_evaluate',outcome?.code??'INVALID_EVALUATE_RESULT',{...(outcome?.errorType?{errorType:outcome.errorType}:{}),...(outcome?.position?{position:outcome.position}:{})});
  return {...outcome.result,identityVerification:{verified:false,reason:'無法確認 MyFCU 學號與系統帳號是否一致'}};
}
