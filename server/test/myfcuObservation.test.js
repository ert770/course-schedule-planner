import {test} from 'node:test';
import assert from 'node:assert/strict';
import {allowObservationRequest,safeObservationPath} from '../scripts/observeMyFcuCompatibility.mjs';
const origin='https://myfcu.fcu.edu.tw';
const history=origin+'/main/S3603/S360380_pmust.aspx';
test('local observation separates main navigation from same-origin resources',()=>{
 assert.equal(allowObservationRequest(history,{navigation:true,mainFrame:true}),true);
 assert.equal(allowObservationRequest(origin+'/main/unknown',{navigation:true,mainFrame:true}),false);
 assert.equal(allowObservationRequest(origin+'/main/fake-data',{navigation:false,mainFrame:true}),true);
 assert.equal(allowObservationRequest('https://evil.example/path',{navigation:false}),false);
 assert.equal(allowObservationRequest('http://127.0.0.1/secret',{navigation:false}),false);
 assert.equal(allowObservationRequest('http://192.168.1.1/secret',{navigation:false}),false);
 assert.equal(allowObservationRequest('https://myfcu.fcu.edu.tw.evil.example/',{}),false);
 assert.equal(allowObservationRequest('https://name@myfcu.fcu.edu.tw/main/InfoMyFcuLogin.aspx',{}),false);
});
test('endpoint report never includes sensitive values or query strings',()=>{
 const p=safeObservationPath(history+'/D8800001?token=secret#fragment',history,'xhr',Buffer.alloc(32));
 assert.equal(p.pathname,'/main/S3603/S360380_pmust.aspx/{redacted}');
 assert.doesNotMatch(JSON.stringify(p),/D8800001|token|secret|fragment/);
 assert.equal(safeObservationPath('https://evil.example/x',history,'xhr',Buffer.alloc(32)),null);
});

import {EventEmitter} from 'node:events';
import {observeMyFcu} from '../scripts/observeMyFcuCompatibility.mjs';
function fixture({failStage=0,partial=false,closeEarly=false}={}) {
 let closed=false,count=0,contextClosed=false,browserClosed=false; const page=new EventEmitter();
 const frame={url:()=>history};
 page.mainFrame=()=>frame;page.url=()=>history;page.isClosed=()=>closed;
 page.routeWebSocket=async()=>{};page.waitForLoadState=async()=>{};
 page.waitForFunction=async()=>{count++;await new Promise(r=>setTimeout(r,5));if(count===failStage)throw Error('private');};
 page.evaluate=async()=>({ok:true,result:{allCategoriesComplete:!partial,totalElapsedMs:100,summary:{rawRows:3},categories:[{hash:'#/courseXd',status:partial?'incomplete':'complete',elapsedMs:partial?15000:50,diagnostics:partial?{reason:'timeout',completionBasis:null}: {completionBasis:'stable'},rowSummary:{rawRows:3}}]}});
 page.goto=async()=>{setTimeout(()=>{if(closeEarly){closed=true;page.emit('close');}else page.emit('framenavigated',frame);},5);return {};};
 const ctx=new EventEmitter();ctx.newPage=async()=>page;ctx.route=async()=>{};ctx.close=async()=>{contextClosed=true;closed=true;page.emit('close');};
 const browser={newContext:async()=>ctx,close:async()=>{browserClosed=true;}};
 return {chromium:{launch:async()=>browser},get cleaned(){return contextClosed&&browserClosed;}};
}
test('observation waits for delayed initialization and retains partial category results',async()=>{
 const f=fixture({partial:true});const out=await observeMyFcu({chromium:f.chromium,timeoutMs:2000});
 assert.equal(out.reason,'CATEGORY_TIMEOUT');assert.equal(out.categories.categories[0].category,'#/courseXd');assert.equal(out.categories.categories[0].reason,'CATEGORY_TIMEOUT');assert.equal(out.stages.find(s=>s.name==='page_init').status,'READY');assert.equal(f.cleaned,true);
});
test('observation distinguishes tabs timeout and early context closure',async()=>{
 const f=fixture({failStage:2});const out=await observeMyFcu({chromium:f.chromium,timeoutMs:2000});assert.equal(out.reason,'TABS_NOT_READY');assert.equal(f.cleaned,true);
 const g=fixture({closeEarly:true});const closed=await observeMyFcu({chromium:g.chromium,timeoutMs:2000});assert.equal(closed.reason,'CONTEXT_CLOSED');assert.equal(g.cleaned,true);
});
