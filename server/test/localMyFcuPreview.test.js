import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSessionCookie } from '../src/services/sessionService.js';
import { createLocalMyFcuPreview,closeLocalMyFcuOwned } from '../src/services/localMyFcuPreview.js';
import { allowObservationRequest } from '../scripts/observeMyFcuCompatibility.mjs';
import { localOnly } from '../src/routes/controlledBrowser.js';

const keys=['NODE_ENV','LOCAL_MYFCU_PREVIEW','CONTROLLED_BROWSER_MOCK','CONTROLLED_BROWSER_REAL_TEST','CONTROLLED_BROWSER_PERSONAL_TEST','SESSION_SECRET','CLIENT_ORIGIN'];
test('local preview binds cookie, identity and grant; cancellation and logout revoke',async()=>{
 const saved=Object.fromEntries(keys.map(k=>[k,process.env[k]]));
 try{
  Object.assign(process.env,{NODE_ENV:'development',LOCAL_MYFCU_PREVIEW:'true',SESSION_SECRET:'synthetic-session-secret-with-sufficient-length'});
  let deliver;const observer=({signal,onResult})=>new Promise(resolve=>{deliver=async()=>{await onResult({allCategoriesComplete:true,records:[],pendingRecords:[]});resolve({status:'COMPLETE'});};signal.addEventListener('abort',()=>resolve({status:'INCOMPLETE'}),{once:true});});
  const service=createLocalMyFcuPreview({observer,getChromium:()=>({})});
  const a={found:true,canonicalId:'SYNTHETIC_A'},b={found:true,canonicalId:'SYNTHETIC_B'},ca=buildSessionCookie(a.canonicalId),cb=buildSessionCookie(b.canonicalId);
  await assert.rejects(service.start(a,ca,false));const session=await service.start(a,ca,true);await new Promise(r=>setImmediate(r));
  assert.throws(()=>service.state(session.id,b,cb,session.grant),{status:404});assert.throws(()=>service.state(session.id,a,ca,'0'.repeat(64)),{status:404});
  await deliver();await new Promise(r=>setImmediate(r));assert.equal(service.state(session.id,a,ca,session.grant).status,'ready');assert.equal(service.state(session.id,a,ca,session.grant).identityVerification.verified,false);
  closeLocalMyFcuOwned({canonicalId:a.canonicalId},ca);assert.throws(()=>service.state(session.id,a,ca,session.grant),{status:404});
  const next=await service.start(b,cb,true);service.cancel(next.id,b,cb,next.grant);assert.throws(()=>service.state(next.id,b,cb,next.grant),{status:404});
 }finally{for(const [k,v] of Object.entries(saved))if(v===undefined)delete process.env[k];else process.env[k]=v;}
});
test('local preview network policy restricts origins, navigation and frames',()=>{
 const host='https://myfcu.fcu.edu.tw';
 assert.equal(allowObservationRequest(host+'/main/S3603/S360380_pmust.aspx',{navigation:true,mainFrame:true,strictFrames:true}),true);
 assert.equal(allowObservationRequest(host+'/main/unknown',{navigation:true,mainFrame:true,strictFrames:true}),false);
 assert.equal(allowObservationRequest(host+'/main/unknown',{navigation:true,mainFrame:false,strictFrames:true}),false);
 assert.equal(allowObservationRequest(host+'/main/S9901/S9901_BannerHomePage.aspx',{navigation:true,mainFrame:false,strictFrames:true,method:'GET'}),true);
 for(const url of ['http://127.0.0.1/','http://192.168.1.1/','https://myfcu.fcu.edu.tw.evil.example/'])assert.equal(allowObservationRequest(url,{strictFrames:true}),false);
});
test('local preview route fails closed outside development or on cross-origin mutation',()=>{
 const saved=Object.fromEntries(keys.map(k=>[k,process.env[k]]));try{
 Object.assign(process.env,{NODE_ENV:'development',LOCAL_MYFCU_PREVIEW:'true',CONTROLLED_BROWSER_MOCK:'false',CONTROLLED_BROWSER_REAL_TEST:'false',CONTROLLED_BROWSER_PERSONAL_TEST:'false',CLIENT_ORIGIN:'http://localhost:5173'});
 const req={method:'POST',socket:{remoteAddress:'127.0.0.1'},get:key=>({host:'localhost:3001',origin:'https://evil.example'}[key])};let status=0,passed=false;const res={sendStatus:n=>{status=n;},set:()=>{}};
 localOnly(req,res,()=>{passed=true;});assert.equal(passed,false);assert.equal(status,403);
 process.env.NODE_ENV='production';status=0;localOnly(req,res,()=>{passed=true;});assert.equal(status,404);
 }finally{for(const [k,v] of Object.entries(saved))if(v===undefined)delete process.env[k];else process.env[k]=v;}
});

test('local preview cannot unlock formal import with client identity claims',async()=>{
 const {configureHistoryImport}=await import('../src/routes/courseHistoryImport.js');
 const names=[...keys,'COURSE_HISTORY_IMPORT_ENABLED','COURSE_HISTORY_IMPORT_FIXTURE'];const saved=Object.fromEntries(names.map(k=>[k,process.env[k]]));
 try{Object.assign(process.env,{NODE_ENV:'development',LOCAL_MYFCU_PREVIEW:'true',CONTROLLED_BROWSER_MOCK:'false',CONTROLLED_BROWSER_REAL_TEST:'false',CONTROLLED_BROWSER_PERSONAL_TEST:'false',COURSE_HISTORY_IMPORT_FIXTURE:'false',COURSE_HISTORY_IMPORT_ENABLED:'true'});
 const req={identity:{found:true,canonicalId:'SYNTHETIC',numericId:'1'},socket:{remoteAddress:'127.0.0.1'},get:()=> 'http://localhost:5173',body:{identityConfirmed:true,myfcuIdentityVerified:true}};
 let status=0,next=false;const res={status(n){status=n;return this;},json(){return this;}};await configureHistoryImport(req,res,()=>{next=true;});assert.equal(next,false);assert.equal(status,503);
 }finally{for(const [k,v] of Object.entries(saved))if(v===undefined)delete process.env[k];else process.env[k]=v;}
});

test('local browser environment excludes application secrets and proxy credentials',async()=>{
 const {localBrowserEnvironment}=await import('../src/services/localMyFcuPreview.js');
 const value=localBrowserEnvironment({PATH:'synthetic-path',SYSTEMROOT:'synthetic-root',DB_PASSWORD:'synthetic-private',HTTPS_PROXY:'synthetic-private',API_KEY:'synthetic-private',DEBUG:'synthetic-private'});
 assert.deepEqual(value,{PATH:'synthetic-path',SYSTEMROOT:'synthetic-root'});assert.doesNotMatch(JSON.stringify(value),/synthetic-private/);
});

test('local preview blocks remote or unapproved database before startup',async()=>{
 const {startServer,resolveControlledBrowserListenHost}=await import('../src/app.js');
 const names=[...keys,'DB_HOST','DB_USER','DB_NAME','DB_SSL_CA_PATH','LOCAL_MYFCU_ALLOW_LOCAL_DB','ISOLATED_HISTORY_MYSQL_E2E'];const saved=Object.fromEntries(names.map(k=>[k,process.env[k]]));
 try{Object.assign(process.env,{NODE_ENV:'development',LOCAL_MYFCU_PREVIEW:'true',CONTROLLED_BROWSER_MOCK:'false',CONTROLLED_BROWSER_REAL_TEST:'false',CONTROLLED_BROWSER_PERSONAL_TEST:'false',ISOLATED_HISTORY_MYSQL_E2E:'false',DB_HOST:'remote.invalid',DB_USER:'synthetic',DB_NAME:'synthetic',DB_SSL_CA_PATH:'',LOCAL_MYFCU_ALLOW_LOCAL_DB:'true'});
  assert.equal(resolveControlledBrowserListenHost(process.env),'127.0.0.1');await assert.rejects(startServer(0),/本機預覽拒絕/);
  process.env.DB_HOST='127.0.0.1';process.env.LOCAL_MYFCU_ALLOW_LOCAL_DB='false';await assert.rejects(startServer(0),/本機預覽拒絕/);
 }finally{for(const [k,v] of Object.entries(saved))if(v===undefined)delete process.env[k];else process.env[k]=v;}
});

test('closed extraction session cannot be reused for import',async()=>{
 const names=[...keys,'MYFCU_SESSION_IMPORT','DB_HOST','DB_SSL_CA_PATH','DB_USER','DB_NAME','LOCAL_MYFCU_SELF_ATTESTED_IMPORT','ISOLATED_HISTORY_MYSQL_E2E','LOCAL_MYFCU_SYNTHETIC_E2E'];const old=Object.fromEntries(names.map(k=>[k,process.env[k]]));
 try{Object.assign(process.env,{NODE_ENV:'development',LOCAL_MYFCU_PREVIEW:'true',MYFCU_SESSION_IMPORT:'true',DB_HOST:'synthetic.aivencloud.com',DB_SSL_CA_PATH:'synthetic-ca',DB_USER:'fake',DB_NAME:'fake',CONTROLLED_BROWSER_MOCK:'false',CONTROLLED_BROWSER_REAL_TEST:'false',CONTROLLED_BROWSER_PERSONAL_TEST:'false',LOCAL_MYFCU_SELF_ATTESTED_IMPORT:'false',ISOLATED_HISTORY_MYSQL_E2E:'false',LOCAL_MYFCU_SYNTHETIC_E2E:'false',SESSION_SECRET:'synthetic-secret-at-least-thirty-two-characters'});
 const {getLocalHistoryForAutoImport}=await import('../src/services/localMyFcuPreview.js');let deliver;const observer=({onResult})=>new Promise(resolve=>{deliver=async()=>{onResult({allCategoriesComplete:true,records:[{courseName:'虛構'}],pendingRecords:[]});resolve({status:'COMPLETE'})}});const service=createLocalMyFcuPreview({observer,getChromium:()=>({})});const id={found:true,canonicalId:'FAKE_A',numericId:2},cookie=buildSessionCookie(id.canonicalId);const session=await service.start(id,cookie,true);await new Promise(r=>setImmediate(r));await deliver();await new Promise(r=>setImmediate(r));assert.equal(service.state(session.id,id,cookie,session.grant).systemIdentity.numericId,2);service.cancel(session.id,id,cookie,session.grant);assert.equal(getLocalHistoryForAutoImport(id,cookie),null);assert.throws(()=>service.state(session.id,id,cookie,session.grant),{status:404});
 }finally{for(const [k,v] of Object.entries(old))if(v===undefined)delete process.env[k];else process.env[k]=v;}
});
