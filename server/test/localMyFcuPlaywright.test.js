import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {observeMyFcu} from '../scripts/observeMyFcuCompatibility.mjs';
const require=createRequire(import.meta.url),enabled=process.env.RUN_CONTROLLED_BROWSER_PLAYWRIGHT==='true';
test('local observer runs shared six-category collector in a disposable synthetic browser context',{skip:!enabled},async()=>{
 const {chromium}=require('playwright');
 let html=await readFile(new URL('./fixtures/controlled-browser-mock.html',import.meta.url),'utf8');
 html=html.replace('<div id="content" hidden>','<div id="content">').replace('document.body.dataset.loaded=id','void 0');
 html+='<script>window.angular={element:()=>({injector:()=>({get:()=>({pendingRequests:[]})})})};if(location.pathname.includes("InfoMyFcuLogin"))setTimeout(()=>location.href="/main/S3603/S360380_pmust.aspx",30);</script>';
 let closed=false,records=null,launchOptions=null;
 const fake={launch:async options=>{launchOptions=options;const browser=await chromium.launch({channel:'chrome',headless:true});return {close:async()=>{closed=true;await browser.close();},newContext:async options=>{const ctx=await browser.newContext(options);return new Proxy(ctx,{get(target,key){if(key==='route')return (pattern,handler)=>target.route(pattern,route=>handler({request:()=>route.request(),abort:()=>route.abort(),continue:()=>route.fulfill({status:200,contentType:'text/html',body:html})}));const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;}});}};}};
 const report=await observeMyFcu({chromium:fake,strictFrames:true,timeoutMs:30000,initTimeoutMs:5000,launchEnv:{SYSTEMROOT:process.env.SYSTEMROOT,PATH:process.env.PATH},onResult:value=>{records=value;}});
 assert.equal(launchOptions.env.SYSTEMROOT,process.env.SYSTEMROOT);assert.equal(launchOptions.env.PATH,process.env.PATH);assert.equal(report.status,'COMPLETE');assert.equal(records?.allCategoriesComplete,true);assert.equal(records.categories.length,6);assert.equal(records.duplicateRows,1);assert.equal(records.records.filter(x=>x.courseCode==='TEST1001').length,2);assert.equal(closed,true);
});
