import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLocalBrowserManager, closeOwned } from '../src/services/controlledBrowserService.js';

function fakeBrowser() {
  const tracker = { contextClosed:0, browserClosed:0, events:[] };
  let url = 'http://127.0.0.1:3001/api/controlled-browser/mock';
  const page = { routeWebSocket:async()=>{}, on:()=>{}, mainFrame:()=>null, goto:async () => ({ok:()=>true}), url:()=>url, evaluate:async()=>url.endsWith('#/history'), screenshot:async()=>Buffer.from('mock'),
    mouse:{click:async (x,y)=>{tracker.events.push('click');if(x===10&&y===10)url += '#/history';}},
    keyboard:{insertText:async()=>{tracker.events.push('text');}, press:async()=>{tracker.events.push('key');}} };
  const context = { route:async()=>{}, newPage:async()=>page, close:async()=>{tracker.contextClosed++;} };
  return { tracker, browser:{newContext:async()=>context,close:async()=>{tracker.browserClosed++;}} };
}
const identity = {canonicalId:'TESTUSER'};
const other = {canonicalId:'OTHERUSER'};
test('consent and ownership prevent cross-session reads and control', async () => {
  const {browser,tracker}=fakeBrowser(); const manager=createLocalBrowserManager({launch:async()=>browser});
  await assert.rejects(manager.start(identity,'fcu_session=cookie-a',false,3001));
  const s=await manager.start(identity,'fcu_session=cookie-a',true,3001);
  await assert.rejects(manager.state(s.id,other,'fcu_session=cookie-b'),{status:404});
  await assert.rejects(manager.frame(s.id,identity,'fcu_session=cookie-b'),{status:404});
  await assert.rejects(manager.input(s.id,other,'fcu_session=cookie-a',{type:'click',x:2,y:3}),{status:404});
  await assert.rejects(manager.input(s.id,identity,'fcu_session=cookie-a',{type:'click',x:999,y:3}),{status:400});
  await manager.cancel(s.id,identity,'fcu_session=cookie-a');
  assert.equal(tracker.contextClosed,1); assert.equal(tracker.browserClosed,1);
});
test('synthetic login triggers extraction and closes context', async () => {
  const {browser,tracker}=fakeBrowser(); const manager=createLocalBrowserManager({launch:async()=>browser,collect:async()=>({allCategoriesComplete:true, records:[],pendingRecords:[],categories:[],duplicateRows:0,conflicts:0})});
  const s=await manager.start(identity,'fcu_session=cookie-b',true,3001);
  await manager.input(s.id,identity,'fcu_session=cookie-b',{type:'click',x:10,y:10});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal((await manager.state(s.id,identity,'fcu_session=cookie-b')).status,'ready');
  assert.equal(tracker.contextClosed,1); assert.equal(tracker.browserClosed,1);
  await manager.cancel(s.id,identity,'fcu_session=cookie-b');
});
test('logout and timeout destroy the owned browser context', async () => {
  const first=fakeBrowser(), second=fakeBrowser(); let i=0;
  const manager=createLocalBrowserManager({launch:async()=>[first,second][i++].browser,ttl:40});
  const a=await manager.start(identity,'fcu_session=logout-cookie',true,3001);
  await closeOwned(identity,'fcu_session=logout-cookie');
  await assert.rejects(manager.state(a.id,identity,'fcu_session=logout-cookie'),{status:404});
  assert.equal(first.tracker.contextClosed,1);
  const b=await manager.start(other,'fcu_session=expiry-cookie',true,3001);
  await new Promise(resolve=>setTimeout(resolve,80));
  await assert.rejects(manager.state(b.id,other,'fcu_session=expiry-cookie'),{status:404});
  assert.equal(second.tracker.contextClosed,1);
});

test('local guard denies production, non-loopback and untrusted origins', async () => {
  const { localOnly } = await import('../src/routes/controlledBrowser.js');
  const oldMode=process.env.NODE_ENV, oldFeature=process.env.CONTROLLED_BROWSER_MOCK, oldReal=process.env.CONTROLLED_BROWSER_REAL_TEST; delete process.env.CONTROLLED_BROWSER_REAL_TEST;
  const oldDb = ['DB_HOST','DB_USER','DB_NAME'].map(k => process.env[k]);
  for (const k of ['DB_HOST','DB_USER','DB_NAME']) process.env[k] = '';
  const check = ({mode='development', enabled='true', remote='127.0.0.1', host='localhost:3001', origin, site}={}) => {
    process.env.NODE_ENV=mode; process.env.CONTROLLED_BROWSER_MOCK=enabled;
    let status=0, next=false;
    const req={socket:{remoteAddress:remote},get:key=>({host,origin,'sec-fetch-site':site})[key]};
    const res={sendStatus:code=>{status=code;},set:()=>{}};
    localOnly(req,res,()=>{next=true;}); return {status,next};
  };
  try {
    assert.equal(check().next,true);
    assert.equal(check({mode:'production'}).status,404);
    assert.equal(check({enabled:'false'}).status,404);
    assert.equal(check({remote:'192.0.2.1'}).status,403);
    assert.equal(check({host:'other.test'}).status,403);
    assert.equal(check({origin:'https://other.test'}).status,403);
    assert.equal(check({site:'cross-site'}).status,403);
    process.env.CONTROLLED_BROWSER_REAL_TEST='true'; assert.equal(check().status,404); delete process.env.CONTROLLED_BROWSER_REAL_TEST;
    for (const k of ['DB_HOST','DB_USER','DB_NAME']) process.env[k]='synthetic';
    assert.equal(check().status,503);
  } finally { if(oldMode===undefined)delete process.env.NODE_ENV;else process.env.NODE_ENV=oldMode; if(oldFeature===undefined)delete process.env.CONTROLLED_BROWSER_MOCK;else process.env.CONTROLLED_BROWSER_MOCK=oldFeature; ['DB_HOST','DB_USER','DB_NAME'].forEach((k,i)=>{if(oldDb[i]===undefined)delete process.env[k];else process.env[k]=oldDb[i];}); if(oldReal===undefined)delete process.env.CONTROLLED_BROWSER_REAL_TEST;else process.env.CONTROLLED_BROWSER_REAL_TEST=oldReal; }
});

test('failed launch or context setup releases resources', async () => {
  let closed=0;
  const manager=createLocalBrowserManager({launch:async()=>({newContext:async()=>{throw new Error('synthetic failure');},close:async()=>{closed++;}})});
  await assert.rejects(manager.start({canonicalId:'FAIL'},'fcu_session=failure',true,3001),{status:503});
  assert.equal(closed,1);
});

test('HTTP logout handler destroys the matching session context', async () => {
  const old = process.env.SESSION_SECRET;
  process.env.SESSION_SECRET = 'synthetic-only-secret-at-least-32-characters';
  try {
    const { buildSessionCookie } = await import('../src/services/sessionService.js');
    const { default: auth } = await import('../src/routes/auth.js');
    const cookie = buildSessionCookie('TESTUSER').split(';')[0];
    const {browser,tracker}=fakeBrowser(); const manager=createLocalBrowserManager({launch:async()=>browser});
    const session=await manager.start(identity,cookie,true,3001);
    const handler=auth.stack.find(layer=>layer.route?.path==='/logout').route.stack.at(-1).handle;
    let cleared=false, success=false;
    await handler({headers:{cookie}}, {setHeader(_k,value){cleared=/Max-Age=0/.test(value);},json(value){success=value.success;}});
    assert.equal(cleared,true); assert.equal(success,true); assert.equal(tracker.contextClosed,1);
    await assert.rejects(manager.state(session.id,identity,cookie,session.grant),{status:404});
  } finally { if(old===undefined)delete process.env.SESSION_SECRET;else process.env.SESSION_SECRET=old; }
});

test('logout while browser context is starting closes late-created context', async () => {
  let release, started;
  const ready = new Promise(resolve => { started = resolve; });
  const pending = new Promise(resolve => { release = resolve; });
  let contextClosed=0, browserClosed=0;
  const manager=createLocalBrowserManager({launch:async()=>({
    newContext:async()=>{started(); await pending; return {close:async()=>{contextClosed++;}};},
    close:async()=>{browserClosed++;},
  })});
  const opening=manager.start(identity,'fcu_session=starting-cookie',true,3001);
  await ready;
  await closeOwned(identity,'fcu_session=starting-cookie');
  release();
  await assert.rejects(opening,{status:410});
  assert.equal(contextClosed,1);
  assert.equal(browserClosed,1);
});

test('real public session is owned, view-only, and closes on cancellation', async () => {
  const {browser,tracker}=fakeBrowser();const manager=createLocalBrowserManager({launch:async()=>browser});
  const s=await manager.start(identity,'fcu_session=real-owner',true,3001,'real');
  assert.equal(s.mode,'real');
  await assert.rejects(manager.state(s.id,identity,'fcu_session=real-owner'),{status:404});
  await assert.rejects(manager.state(s.id,identity,'fcu_session=real-owner','0'.repeat(64)),{status:404});
  await assert.rejects(manager.frame(s.id,other,'fcu_session=other'),{status:404});
  for (const event of [{type:'text',text:'synthetic'},{type:'key',key:'Enter'},{type:'click',x:5,y:5}]) await assert.rejects(manager.input(s.id,identity,'fcu_session=real-owner',event,s.grant),{status:403});
  await manager.cancel(s.id,identity,'fcu_session=real-owner',s.grant);
  assert.equal(tracker.contextClosed,1);assert.equal(tracker.browserClosed,1);
  await assert.rejects(manager.state(s.id,identity,'fcu_session=real-owner',s.grant),{status:404});
});

test('real public policy rejects protected paths, external hosts and POST', async () => {
  const {allowedRealPublicRequest}=await import('../src/services/controlledBrowserService.js');
  const {MYFCU_START_URL}=await import('../src/services/myfcuCompatibility.js');
  assert.equal(allowedRealPublicRequest(MYFCU_START_URL,'GET',true),true);
  assert.equal(allowedRealPublicRequest(MYFCU_START_URL,'POST',true),false);
  assert.equal(allowedRealPublicRequest('https://myfcu.fcu.edu.tw/main/S3603/S360380_pmust.aspx','GET',true),false);
  assert.equal(allowedRealPublicRequest('https://other.example/test.css','GET',false),false);
  for (const name of ['WebResource.axd','ScriptResource.axd']) {
    const url='https://myfcu.fcu.edu.tw/main/'+name+'?d=synthetic';
    assert.equal(allowedRealPublicRequest(url,'GET',false),true);
    assert.equal(allowedRealPublicRequest(url,'POST',false),false);
    assert.equal(allowedRealPublicRequest(url,'GET',true),false);
    assert.equal(allowedRealPublicRequest('https://evil.example/main/'+name,'GET',false),false);
  }
  assert.equal(allowedRealPublicRequest('https://myfcu.fcu.edu.tw/main/Other.axd','GET',false),false);
  assert.equal(allowedRealPublicRequest('https://myfcu.fcu.edu.tw/unknown.js','GET',false),false);
  assert.equal(allowedRealPublicRequest('https://myfcu.fcu.edu.tw/other/WebResource.axd','GET',false),false);
  assert.equal(allowedRealPublicRequest('https://myfcu.fcu.edu.tw/main/S9901/S9901_BannerHomePage.aspx','GET',true),false);
});

test('startup failures provide safe stage-specific codes without leaking underlying messages', async () => {
  const {classifyStartFailure} = await import('../src/services/controlledBrowserService.js');
  for (const [stage,message,blocked,code] of [
    ['navigation','net::ERR_NAME_NOT_RESOLVED',false,'DNS_ERROR'],
    ['navigation','net::ERR_CERT_AUTHORITY_INVALID',false,'TLS_ERROR'],
    ['navigation','Timeout 10000ms',false,'TIMEOUT'],
    ['navigation','confidential redirect',true,'NAVIGATION_BLOCKED'],
    ['launch','confidential details',false,'BROWSER_LAUNCH_FAILED'],
  ]) {
    const error=classifyStartFailure(stage,new Error(message),blocked);
    assert.equal(error.code,code); assert.equal(error.message.includes('confidential'),false);
  }
});

test('configuration endpoint reports server mode after local and session guards', async () => {
  const {default:router} = await import('../src/routes/controlledBrowser.js');
  const handler=router.stack.find(layer=>layer.route?.path==='/config').route.stack[0].handle;
  const old=process.env.CONTROLLED_BROWSER_REAL_TEST;
  try {
    process.env.CONTROLLED_BROWSER_REAL_TEST='true'; let payload; handler({}, {json:value=>{payload=value;}}); assert.equal(payload.mode,'real');
    process.env.CONTROLLED_BROWSER_REAL_TEST='false'; handler({}, {json:value=>{payload=value;}}); assert.equal(payload.mode,'mock');
  } finally { if(old===undefined)delete process.env.CONTROLLED_BROWSER_REAL_TEST;else process.env.CONTROLLED_BROWSER_REAL_TEST=old; }
});

test('blocked iframe does not terminate session; unknown main-frame navigation does', async () => {
  let handler, contextClosed=0, browserClosed=0;
  const mainFrame={}, subFrame={};
  const page={mainFrame:()=>mainFrame,routeWebSocket:async()=>{},on:()=>{},goto:async()=>({ok:()=>true})};
  const context={route:async(_pattern,fn)=>{handler=fn;},newPage:async()=>page,close:async()=>{contextClosed++;}};
  const manager=createLocalBrowserManager({launch:async()=>({newContext:async()=>context,close:async()=>{browserClosed++;}})});
  const cookie='fcu_session=synthetic-frame-test';
  const session=await manager.start(identity,cookie,true,3001,'real');
  let aborted=0;
  const route=frame=>({request:()=>({url:()=> 'https://untrusted.example/path',method:()=> 'GET',isNavigationRequest:()=>true,frame:()=>frame}),abort:()=>{aborted++;},continue:()=>{throw new Error('must not continue');}});
  await handler(route(subFrame));
  assert.equal(aborted,1);assert.equal((await manager.state(session.id,identity,cookie,session.grant)).status,'login');
  await handler(route(mainFrame));
  await new Promise(resolve=>setImmediate(resolve));
  await assert.rejects(manager.state(session.id,identity,cookie,session.grant),{status:404});
  assert.equal(aborted,2);assert.equal(contextClosed,1);assert.equal(browserClosed,1);
});

test('controlled-browser malformed request error never exposes raw body or exception', async () => {
  const {controlledBrowserBodyError}=await import('../src/routes/controlledBrowser.js');
  for (const status of [400,413]) {
    let result,code;
    controlledBrowserBodyError(Object.assign(new Error('synthetic-sensitive-input'),{status}),{}, {status(n){code=n;return this;},json(v){result=v;}},()=>{});
    assert.equal(code,status);assert.equal(JSON.stringify(result).includes('synthetic-sensitive-input'),false);
  }
});

test('personal login switch cannot open controlled browser access', async () => {
  const {localOnly}=await import('../src/routes/controlledBrowser.js');
  const old=process.env.CONTROLLED_BROWSER_PERSONAL_TEST;
  try {
    process.env.CONTROLLED_BROWSER_PERSONAL_TEST='true';let result;
    localOnly({}, {sendStatus:value=>{result=value;}},()=>{throw new Error('must not proceed');});
    assert.equal(result,404);
  } finally {if(old===undefined)delete process.env.CONTROLLED_BROWSER_PERSONAL_TEST;else process.env.CONTROLLED_BROWSER_PERSONAL_TEST=old;}
});

test('real grant is revoked by logout and expires no later than login session', async () => {
  const {browser,tracker}=fakeBrowser();const manager=createLocalBrowserManager({launch:async()=>browser,ttl:5000});
  const cookie='fcu_session=grant-logout';const session=await manager.start(identity,cookie,true,3001,'real',Date.now()+80);
  assert.ok(session.expiresAt <= Date.now()+80);
  await closeOwned(identity,cookie);
  await assert.rejects(manager.state(session.id,identity,cookie,session.grant),{status:404});
  assert.equal(tracker.contextClosed,1);
});

test('real screenshot failure revokes grant and destroys context', async () => {
  const {browser,tracker}=fakeBrowser();
  const original=browser.newContext;
  browser.newContext=async options=>{const context=await original(options);const create=context.newPage;context.newPage=async()=>{const page=await create();page.screenshot=async()=>{throw new Error('synthetic secret');};return page;};return context;};
  const manager=createLocalBrowserManager({launch:async()=>browser}),cookie='fcu_session=failed-screenshot';
  const session=await manager.start(identity,cookie,true,3001,'real');
  await assert.rejects(manager.frame(session.id,identity,cookie,session.grant),{status:503});
  await assert.rejects(manager.state(session.id,identity,cookie,session.grant),{status:404});
  assert.equal(tracker.contextClosed,1);
});
