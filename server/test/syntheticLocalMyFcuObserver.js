// Test-only local observer. It serves every document from a synthetic fixture;
// it never connects to MyFCU, Aiven or any other network host.
import {readFile} from 'node:fs/promises';
import {collectRealMyFcuHistory,waitForMyFcuHistoryReady} from '../src/services/myfcuRealHistory.js';
export async function observeSyntheticLocal({chromium,signal,onResult}){
 let browser,context;try{
  let html=await readFile(new URL('./fixtures/controlled-browser-mock.html',import.meta.url),'utf8');
  html=html.replace('<div id="content" hidden>','<div id="content">').replace('document.body.dataset.loaded=id','void 0').replace('<th>成績</th>','<th>取得學分記錄</th>').replace('<th>課名</th>','<th>課名</th><th>修讀班級名稱</th>').replace('r.forEach(x=>','[r[0],r[1],"資訊二甲",...r.slice(2)].forEach(x=>').replace("['TEST1001','虛構課程甲','112'","['','虛構課程甲','112'").replace("'虛構課程','112'","'虛構課程'+(i+1),'112'");
  html=html.replace("'112','1','3','55']]:i===1", "'112','1','3','55'],['MISSING1','虛構未匹配','112','2','2','X']]:i===1");
  html=html.replace("'112','2','2','75']]", "'112','2','2',i===2?'60':'75']]");
  html+='<script>window.angular={element:()=>({injector:()=>({get:()=>({pendingRequests:[]})})})};</script>';
  browser=await chromium.launch({channel:'chrome',headless:true});if(signal?.aborted)return {status:'INCOMPLETE'};context=await browser.newContext({acceptDownloads:false,serviceWorkers:'block'});if(signal?.aborted)return {status:'INCOMPLETE'};
  signal?.addEventListener('abort',()=>void context.close().catch(()=>{}),{once:true});
  await context.route('**/*',route=>{const u=new URL(route.request().url());return u.origin==='https://myfcu.fcu.edu.tw'&&u.pathname==='/main/S3603/S360380_pmust.aspx'&&route.request().method()==='GET'?route.fulfill({status:200,contentType:'text/html',body:html}):route.abort();});
  const page=await context.newPage();await page.goto('https://myfcu.fcu.edu.tw/main/S3603/S360380_pmust.aspx');await waitForMyFcuHistoryReady(page);const result=await collectRealMyFcuHistory(page);
  if(signal?.aborted)return {status:'INCOMPLETE'};
  await onResult({...result,identityVerification:{verified:true,source:'synthetic'},syntheticSubject:'AC-FIXTURE-A'});return {status:result.allCategoriesComplete?'COMPLETE':'INCOMPLETE'};
 }catch{return {status:'INCOMPLETE'};}finally{await context?.close().catch(()=>{});await browser?.close().catch(()=>{});}
}
