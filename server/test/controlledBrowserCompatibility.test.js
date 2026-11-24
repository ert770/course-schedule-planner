import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MYFCU_START_URL, isAllowedMyFcuUrl, validateRealMode } from '../src/services/myfcuCompatibility.js';
import { isAllowedMockNavigation } from '../src/services/controlledBrowserService.js';
import { buildHistoryPreview } from '../../client/src/utils/controlledBrowserPreview.js';

test('real-mode preparation permits only explicitly listed official URLs and stays closed', () => {
  assert.equal(isAllowedMyFcuUrl(MYFCU_START_URL),true);
  assert.equal(isAllowedMyFcuUrl('https://myfcu.fcu.edu.tw/main/S3603/S360380_pmust.aspx#/courseSelP'),true);
  for (const url of ['http://myfcu.fcu.edu.tw/main/InfoMyFcuLogin.aspx','https://myfcu.fcu.edu.tw.evil.test/main/x','https://user@myfcu.fcu.edu.tw/main/S3603/S360380_pmust.aspx','https://myfcu.fcu.edu.tw/main/S3603/S360380_pmust.aspx?redirect=https://evil.test','https://myfcu.fcu.edu.tw/main/other']) assert.equal(isAllowedMyFcuUrl(url),false);
  assert.deepEqual(validateRealMode({}),{enabled:false,ready:false,reason:'disabled'});
  assert.deepEqual(validateRealMode({CONTROLLED_BROWSER_REAL_TEST:'true'}),{enabled:true,ready:false,reason:'security-review-required'});
  assert.equal(validateRealMode({CONTROLLED_BROWSER_REAL_TEST:'true',CONTROLLED_BROWSER_MOCK:'true'}).reason,'mode-conflict');
});
test('mock navigation cannot leave exact fixture or known category fragments', () => {
  const target='http://127.0.0.1:3001/api/controlled-browser/mock';
  assert.equal(isAllowedMockNavigation(target+'#/courseSelP',target),true);
  for (const url of ['https://myfcu.fcu.edu.tw/main/x','http://127.0.0.1:3001/api/controlled-browser/mock?redirect=1','http://127.0.0.1:3001/api/controlled-browser/mock#/unknown','data:text/html,x']) assert.equal(isAllowedMockNavigation(url,target),false);
});
test('preview suppresses duplicates while retaining conflicts, retakes and different course IDs', () => {
  const row={courseCode:'TEST1001',courseName:'虛構',academicYear:112,semester:1,credits:3,score:70,sourceCategories:['A']};
  const preview=buildHistoryPreview({records:[row,{...row,sourceCategories:['B']},{...row,score:60},{...row,semester:2},{...row,courseCode:'TEST1002'}],pendingRecords:[]});
  assert.equal(preview.length,3);assert.deepEqual(preview[0].sourceCategories,['A','B']);
  assert.equal(preview[0].conflictingRows.length,1); assert.equal(preview[0].score,70); assert.equal(preview[0].conflictingRows[0].score,60);
});

test('prepared personal request policy allows only observed methods and exact official paths', async () => {
  const {allowedPersonalRequest,MYFCU_START_URL}=await import('../src/services/myfcuCompatibility.js');
  const login='https://myfcu.fcu.edu.tw/main/InfoMyFcuLogin.aspx';
  const history='https://myfcu.fcu.edu.tw/main/S3603/S360380_pmust.aspx';
  assert.equal(allowedPersonalRequest(MYFCU_START_URL,'GET',true),true);
  assert.equal(allowedPersonalRequest(login,'POST',true,{mainFrame:true,sourceUrl:login,phase:'login'}),true);
  assert.equal(allowedPersonalRequest(login,'POST',true,{mainFrame:false,sourceUrl:login,phase:'login'}),false);
  assert.equal(allowedPersonalRequest(login,'POST',false,{mainFrame:true,sourceUrl:login,phase:'login'}),true);
  assert.equal(allowedPersonalRequest(login,'POST',false,{mainFrame:false,sourceUrl:login,phase:'login'}),false);
  assert.equal(allowedPersonalRequest(login,'POST',false,{mainFrame:true,sourceUrl:'https://evil.example/',phase:'login'}),false);
  assert.equal(allowedPersonalRequest(login,'POST',false,{mainFrame:true,sourceUrl:login,phase:'history'}),false);
  assert.equal(allowedPersonalRequest(login+'?unverified=value','POST',false,{mainFrame:true,sourceUrl:login,phase:'login'}),false);
  assert.equal(allowedPersonalRequest(history,'GET',true),true);
  assert.equal(allowedPersonalRequest('https://myfcu.fcu.edu.tw/main/Unknown','POST',false),false);
  assert.equal(allowedPersonalRequest('https://evil.example/main/InfoMyFcuLogin.aspx','POST',true),false);
  assert.equal(allowedPersonalRequest(login+'?next=https://evil.example','POST',true),false);
  assert.equal(allowedPersonalRequest(history,'POST',true),false);
});

test('public and mock test servers explicitly bind loopback', async () => {
  const {resolveControlledBrowserListenHost}=await import('../src/app.js');
  assert.equal(resolveControlledBrowserListenHost({NODE_ENV:'test',CONTROLLED_BROWSER_MOCK:'true'}),'127.0.0.1');
  assert.equal(resolveControlledBrowserListenHost({NODE_ENV:'test',CONTROLLED_BROWSER_REAL_TEST:'true'}),'127.0.0.1');
  assert.equal(resolveControlledBrowserListenHost({NODE_ENV:'production',CONTROLLED_BROWSER_REAL_TEST:'true'}),undefined);
});

test('declared login assets only: GET, exact origin, type, document and main frame', async () => {
  const {isDeclaredLoginAsset}=await import('../src/services/myfcuCompatibility.js');
  const url='https://myfcu.fcu.edu.tw/main/assets/example.css';
  const frame={url:()=> 'https://myfcu.fcu.edu.tw/main/InfoMyFcuLogin.aspx',evaluate:async()=>true};
  const page={mainFrame:()=>frame};
  const req=(overrides={})=>({method:()=> 'GET',isNavigationRequest:()=>false,resourceType:()=> 'stylesheet',url:()=>url,frame:()=>frame,...overrides});
  assert.equal(await isDeclaredLoginAsset(req(),page,'login'),true);
  assert.equal(await isDeclaredLoginAsset(req({method:()=> 'POST'}),page,'login'),false);
  assert.equal(await isDeclaredLoginAsset(req({isNavigationRequest:()=>true}),page,'login'),false);
  assert.equal(await isDeclaredLoginAsset(req({url:()=> 'https://outside.example/assets/example.css'}),page,'login'),false);
  assert.equal(await isDeclaredLoginAsset(req({resourceType:()=> 'xhr'}),page,'login'),false);
  assert.equal(await isDeclaredLoginAsset(req(),page,'history'),false);
  assert.equal(await isDeclaredLoginAsset(req({frame:()=>({...frame})}),page,'login'),false);
  assert.equal(await isDeclaredLoginAsset(req({url:()=> 'https://myfcu.fcu.edu.tw/main/other.aspx'}),page,'login'),false);
});

test('history declared assets need explicit history permission, exact page and GET', async () => {
  const {isDeclaredMyFcuAsset}=await import('../src/services/myfcuCompatibility.js');
  const source='https://myfcu.fcu.edu.tw/main/S3603/S360380_pmust.aspx';
  const frame={url:()=>source,evaluate:async()=>true},page={mainFrame:()=>frame};
  const request={method:()=> 'GET',isNavigationRequest:()=>false,resourceType:()=> 'script',url:()=> 'https://myfcu.fcu.edu.tw/main/scripts/example.js',frame:()=>frame};
  assert.equal(await isDeclaredMyFcuAsset(request,page,'history',{allowHistory:true}),true);
  assert.equal(await isDeclaredMyFcuAsset(request,page,'history'),false);
  assert.equal(await isDeclaredMyFcuAsset(request,page,'login',{allowHistory:true}),false);
  assert.equal(await isDeclaredMyFcuAsset({...request,method:()=> 'POST'},page,'history',{allowHistory:true}),false);
  assert.equal(await isDeclaredMyFcuAsset({...request,url:()=> 'https://untrusted.example/example.js'},page,'history',{allowHistory:true}),false);
  const badFrame={url:()=> 'https://myfcu.fcu.edu.tw/main/other.aspx',evaluate:async()=>true};
  assert.equal(await isDeclaredMyFcuAsset({...request,frame:()=>badFrame},{mainFrame:()=>badFrame},'history',{allowHistory:true}),false);
});


test('blocked same-origin history XHR retries stop without authorizing unknown posts', async () => {
  const {createHistoryPostRetryGuard,allowedPersonalRequest}=await import('../src/services/myfcuCompatibility.js');
  const guard=createHistoryPostRetryGuard(3);
  const base={url:'https://myfcu.fcu.edu.tw/main/unknown-endpoint',sourceUrl:'https://myfcu.fcu.edu.tw/main/S3603/S360380_pmust.aspx#/courseXd',method:'POST',resourceType:'xhr',navigation:false,mainFrame:true};
  assert.equal(allowedPersonalRequest(base.url,'POST',false,{sourceUrl:base.sourceUrl,phase:'history',mainFrame:true}),false);
  assert.deepEqual(guard.record(base),{tracked:true,stop:false,count:1});
  assert.equal(guard.record({...base,url:base.url+'?ignored=1'}).stop,false);
  assert.equal(guard.record(base).stop,true);
  for(const invalid of [{...base,method:'GET'},{...base,mainFrame:false},{...base,url:'https://evil.example/x'},{...base,sourceUrl:'https://myfcu.fcu.edu.tw/main/InfoMyFcuLogin.aspx'}]) assert.equal(guard.record(invalid).tracked,false);
});

test('history page identity accepts ordinary query and category hashes without granting redirects',async()=>{
 const {isMyFcuHistoryPage}=await import('../src/services/myfcuCompatibility.js');
 const base='https://myfcu.fcu.edu.tw/main/S3603/S360380_pmust.aspx';
 for(const hash of ['', '#/courseXd','#/courseKind1','#/courseXc','#/courseKind23','#/courseSelP','#/courseSelPno']){
  assert.equal(isMyFcuHistoryPage(base+'?lang=zh&view=1'+hash),true);
 }
 assert.equal(isMyFcuHistoryPage(base+'#/courseXd?view=1'),true);
 for(const value of ['http://myfcu.fcu.edu.tw/main/S3603/S360380_pmust.aspx','https://myfcu.fcu.edu.tw.evil.test/main/S3603/S360380_pmust.aspx','https://myfcu.fcu.edu.tw/main/other',base+'?redirect=https%3A%2F%2Fevil.test',base+'?next=x',base+'#/https://evil.test'])assert.equal(isMyFcuHistoryPage(value),false);
});

test('history URL rejections provide precise sanitized checks',async()=>{
 const {validateMyFcuHistoryPage}=await import('../src/services/myfcuCompatibility.js');
 const base='https://myfcu.fcu.edu.tw/main/S3603/S360380_pmust.aspx';
 for(const [url,reason] of [['not-a-url','INVALID_URL'],['http://myfcu.fcu.edu.tw/main/S3603/S360380_pmust.aspx','HTTPS_REQUIRED'],['https://evil.test/main/S3603/S360380_pmust.aspx','ORIGIN_MISMATCH'],['https://myfcu.fcu.edu.tw/other','PATHNAME_MISMATCH'],[base+'?redirect=secret','QUERY_REJECTED'],[base+'#/https://evil.test','HASH_REJECTED']])assert.deepEqual(validateMyFcuHistoryPage(url),{ok:false,failedCheck:reason});
 assert.deepEqual(validateMyFcuHistoryPage(base+'?view=1#/courseXd'),{ok:true,failedCheck:null});
 const {collectRealMyFcuHistory}=await import('../src/services/myfcuRealHistory.js');
 await assert.rejects(collectRealMyFcuHistory({mainFrame:()=>({url:()=>base}),url:()=>base+'?view=1'}),e=>e.code==='HISTORY_URL_REJECTED'&&e.failedCheck==='UNEXPECTED_URL_SOURCE');
 await assert.rejects(collectRealMyFcuHistory({mainFrame:()=>({url:()=>base+'#/https://evil.test'}),url:()=>base+'#/https://evil.test'}),e=>e.code==='HISTORY_URL_REJECTED'&&e.failedCheck==='HASH_REJECTED');
});
