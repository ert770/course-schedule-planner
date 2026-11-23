import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const enabled = process.env.RUN_CONTROLLED_BROWSER_PLAYWRIGHT === 'true';
const here = path.dirname(fileURLToPath(import.meta.url));
const html = readFileSync(path.join(here, 'fixtures/controlled-browser-mock.html'), 'utf8') + '<script>window.angular={element:()=>({injector:()=>({get:()=>({pendingRequests:[]})})})};</script>';
const { collect } = require(path.resolve(here, '../src/myfcu/console-poc.js'));
for (const viewport of [{width:390,height:720},{width:1280,height:800}]) {
  test(`real Playwright synthetic fixture at ${viewport.width}px`, { skip: !enabled }, async () => {
    const { chromium } = require('playwright');
    const browser = await chromium.launch({ channel:'chrome', headless:true });
    try {
      const context = await browser.newContext({viewport});
      const page = await context.newPage();
      await page.setContent(html);
      await page.locator('[aria-label="模擬帳號"]').fill('synthetic');
      await page.locator('[aria-label="模擬密碼"]').fill('synthetic');
      await page.locator('#submit').click();
      assert.equal(await page.locator('#content').isVisible(), true);
      const result = await collect({ load: async hash => {
        await page.locator(`a[href="${hash}"]`).click();
        await page.waitForFunction(h => location.hash === h && document.body.dataset.loaded === h.slice(2), hash);
        return {category:hash,tables:await page.locator('table').evaluateAll(tables=>tables.map(table=>({headers:[...table.querySelectorAll('thead th')].map(x=>x.textContent.trim()),rows:[...table.querySelectorAll('tbody tr')].map(row=>[...row.querySelectorAll('td')].map(x=>x.textContent.trim()))})))};
      }});
      assert.equal(result.allCategoriesComplete,true);
      assert.equal(result.categories.length,6); assert.equal(result.records.length,6);
      assert.equal(result.duplicateRows,1); assert.equal(result.records.filter(r=>r.courseCode==='TEST1001').length,2);
      await context.close();
    } finally { await browser.close(); }
  });
}

test('real Playwright manager renders fixture and extracts via restricted controls', {skip:!enabled}, async () => {
  const { chromium } = require('playwright');
  const { createLocalBrowserManager } = await import('../src/services/controlledBrowserService.js');
  let actualPage;
  const manager = createLocalBrowserManager({ launch: async () => {
    const browser = await chromium.launch({channel:'chrome',headless:true});
    return {
      close: () => browser.close(),
      newContext: async options => {
        const context = await browser.newContext(options);
        return {
          close: () => context.close(),
          route: (pattern, handler) => context.route(pattern, route => handler({ request:()=>route.request(), continue:()=>route.fulfill({status:200,contentType:'text/html',body:html}), abort:()=>route.abort() })),
          newPage: async () => { actualPage = await context.newPage(); return actualPage; },
        };
      },
    };
  }});
  const who={canonicalId:'SYNTHETIC'}, cookie='fcu_session=synthetic-session';
  const session=await manager.start(who,cookie,true,3001);
  try {
  assert.ok((await manager.frame(session.id,who,cookie)).length > 0);
  const box=await actualPage.locator('[aria-label="模擬帳號"]').boundingBox();
  await manager.input(session.id,who,cookie,{type:'click',x:box.x+box.width/2,y:box.y+box.height/2});
  await manager.input(session.id,who,cookie,{type:'text',text:'虛構abc'});
  await manager.input(session.id,who,cookie,{type:'key',key:'Backspace'});
  assert.equal(await actualPage.locator('[aria-label="模擬帳號"]').inputValue(),'虛構ab');
  await manager.input(session.id,who,cookie,{type:'key',key:'Tab'});
  await manager.input(session.id,who,cookie,{type:'text',text:'測試'});
  assert.equal(await actualPage.locator('[aria-label="模擬密碼"]').inputValue(),'測試');
  await manager.input(session.id,who,cookie,{type:'key',key:'Tab'});
  await manager.input(session.id,who,cookie,{type:'key',key:'Enter'});
  let state;
  for(let i=0;i<100;i++){ state=await manager.state(session.id,who,cookie); if(['ready','error','incomplete'].includes(state.status))break; await new Promise(r=>setTimeout(r,50)); }
  assert.equal(state.status,'ready', JSON.stringify(state.result?.categories ?? [])); assert.equal(state.result.records.length,6); assert.equal(state.result.duplicateRows,1);
  } finally { await manager.cancel(session.id,who,cookie).catch(()=>{}); }
});

test('mock driver supplies cell-span metadata and rejects unknown categories', {skip:!enabled}, async () => {
  const { chromium } = require('playwright');
  const { createMockHistoryDriver } = await import('../src/services/controlledBrowserService.js');
  const browser = await chromium.launch({channel:'chrome',headless:true});
  try {
    const page = await browser.newPage();
    await page.setContent(html);
    await page.locator('[aria-label="模擬帳號"]').fill('synthetic');
    await page.locator('[aria-label="模擬密碼"]').fill('synthetic');
    await page.locator('#submit').click();
    const driver = createMockHistoryDriver(page);
    await assert.rejects(driver.load('#/not-a-category'));
    const loaded = await driver.load('#/courseXd');
    assert.equal(loaded.category,'#/courseXd');
    assert.equal(loaded.tables[0].rowMeta.length, loaded.tables[0].rows.length);
    assert.deepEqual(loaded.tables[0].rowMeta[0],{colspan:false,rowspan:false});
  } finally { await browser.close(); }
});

test('real-page driver uses PoC readiness on synthetic page, without mock loaded marker', {skip:!enabled}, async () => {
  const { chromium }=require('playwright');
  const { collectRealMyFcuHistory }=await import('../src/services/myfcuRealHistory.js');
  const browser=await chromium.launch({channel:'chrome',headless:true});
  try {
    const context=await browser.newContext();
    await context.route('**/*',route=>route.fulfill({status:200,contentType:'text/html',body:html.replace('document.body.dataset.loaded=id','void 0')}));
    const page=await context.newPage();
    await page.goto('https://myfcu.fcu.edu.tw/main/InfoMyFcuLogin.aspx');
    await assert.rejects(collectRealMyFcuHistory(page));
    await page.goto('https://myfcu.fcu.edu.tw/main/S3603/S360380_pmust.aspx?view=1');
    await page.evaluate(()=>{document.querySelector('#content').hidden=false;});
    const result=await collectRealMyFcuHistory(page);
    assert.equal(result.allCategoriesComplete,true);
    assert.equal(result.identityVerification.verified,false);
    assert.equal(result.records.length,6);assert.equal(result.duplicateRows,1);
    assert.equal(result.records.filter(r=>r.courseCode==='TEST1001').length,2);
    await context.close();
  } finally {await browser.close();}
});

test('locked real integration runs shared collector only on isolated synthetic history page', {skip:!enabled}, async () => {
  const { chromium }=require('playwright');
  const { createLocalBrowserManager }=await import('../src/services/controlledBrowserService.js');
  let page,closed=0;
  const fixture=html.replace('<div id="content" hidden>','<div id="content">').replace('document.body.dataset.loaded=id','void 0');
  const manager=createLocalBrowserManager({syntheticRealTest:true,launch:async()=>{
    const browser=await chromium.launch({channel:'chrome',headless:true});
    return {close:()=>browser.close(),newContext:async options=>{
      const context=await browser.newContext(options);
      return {close:async()=>{closed++;await context.close();},
        route:(pattern,handler)=>context.route(pattern,route=>handler({request:()=>route.request(),continue:()=>route.fulfill({status:200,contentType:'text/html',body:fixture}),abort:()=>route.abort()})),
        newPage:async()=>{page=await context.newPage();return page;}};
    }};
  }});
  const who={canonicalId:'SYNTHETIC-REAL'},cookie='fcu_session=synthetic-real';
  const session=await manager.start(who,cookie,true,3001,'real');
  try {
    await assert.rejects(manager.input(session.id,who,cookie,{type:'text',text:'synthetic'},session.grant),{status:403});
    await assert.rejects(manager.state(session.id,{canonicalId:'OTHER'},cookie),{status:404});
    await page.goto('https://myfcu.fcu.edu.tw/main/S3603/S360380_pmust.aspx').catch(()=>{});
    let state;for(let i=0;i<150;i++){state=await manager.state(session.id,who,cookie,session.grant);if(['ready','incomplete','error'].includes(state.status))break;await new Promise(r=>setTimeout(r,100));}
    assert.equal(state.status,'ready');assert.equal(state.result.records.length,6);assert.equal(state.result.duplicateRows,1);
    assert.equal(state.result.records.filter(row=>row.courseCode==='TEST1001').length,2);
    assert.ok(closed>=1);
  } finally {await manager.cancel(session.id,who,cookie,session.grant).catch(()=>{});}
});

test('strict policy permits synthetic login AJAX but rejects unverified same-origin POST', {skip:!enabled}, async () => {
  const {chromium}=require('playwright');
  const {allowedPersonalRequest}=await import('../src/services/myfcuCompatibility.js');
  const browser=await chromium.launch({channel:'chrome',headless:true});
  try{
    const context=await browser.newContext();const page=await context.newPage();
    await context.route('**/*',route=>{const req=route.request();let contextInfo={};try{const frame=req.frame();contextInfo={mainFrame:frame===page.mainFrame(),sourceUrl:frame.url(),phase:'login'};}catch{}
      return allowedPersonalRequest(req.url(),req.method(),req.isNavigationRequest(),contextInfo)?route.fulfill({status:200,contentType:'text/html',body:'OK'}):route.abort();});
    await page.goto('https://myfcu.fcu.edu.tw/main/InfoMyFcuLogin.aspx');
    const result=await page.evaluate(async()=>{const ok=await fetch('/main/InfoMyFcuLogin.aspx',{method:'POST',body:'synthetic'});let blocked=false;try{await fetch('/main/unknown',{method:'POST',body:'synthetic'});}catch{blocked=true;}return {status:ok.status,blocked};});
    assert.deepEqual(result,{status:200,blocked:true});await context.close();
  }finally{await browser.close();}
});

test('public login page can load only its declared synthetic static assets', {skip:!enabled}, async () => {
  const {chromium}=require('playwright');
  const {isDeclaredLoginAsset,MYFCU_START_URL}=await import('../src/services/myfcuCompatibility.js');
  const browser=await chromium.launch({channel:'chrome',headless:true});
  try {
    const context=await browser.newContext();const page=await context.newPage();const allowed=[];
    await context.route('**/*',async route=>{
      const req=route.request();
      if(req.isNavigationRequest() && req.url()===MYFCU_START_URL)return route.fulfill({status:200,contentType:'text/html',body:'<link rel="stylesheet" href="/main/assets/demo.css"><script src="/main/assets/demo.js"></script><img src="/main/assets/demo.png">'});
      const yes=await isDeclaredLoginAsset(req,page,'starting');
      if(!yes)return route.abort();
      allowed.push(req.resourceType());
      if(req.resourceType()==='stylesheet')return route.fulfill({status:200,contentType:'text/css',body:'body{color:rgb(1,2,3)}'});
      if(req.resourceType()==='script')return route.fulfill({status:200,contentType:'text/javascript',body:'window.fixtureLoaded=true;'});
      return route.fulfill({status:200,contentType:'image/png',body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/a7sAAAAASUVORK5CYII=','base64')});
    });
    await page.goto(MYFCU_START_URL,{waitUntil:'load'});
    assert.deepEqual(allowed.sort(),['image','script','stylesheet']);assert.equal(await page.evaluate(()=>window.fixtureLoaded),true);
    const rejected=await page.evaluate(()=>new Promise(resolve=>{const image=new Image();image.onload=()=>resolve(false);image.onerror=()=>resolve(true);image.src='/main/assets/not-declared.png';}));
    assert.equal(rejected,true);
    await context.close();
  } finally {await browser.close();}
});

test('public manager applies shared declared-asset policy with isolated synthetic response', {skip:!enabled}, async () => {
  const {chromium}=require('playwright');const {createLocalBrowserManager}=await import('../src/services/controlledBrowserService.js');
  let page,assets=0;
  const fixture='<link rel="stylesheet" href="/main/assets/demo.css"><script src="/main/assets/demo.js"></script>';
  const manager=createLocalBrowserManager({launch:async()=>{const browser=await chromium.launch({channel:'chrome',headless:true});return {close:()=>browser.close(),newContext:async options=>{
    const context=await browser.newContext(options);return {close:()=>context.close(),route:(pattern,handler)=>context.route(pattern,route=>handler({request:()=>route.request(),continue:()=>{const type=route.request().resourceType();if(type==='document')return route.fulfill({status:200,contentType:'text/html',body:fixture});assets++;return route.fulfill({status:200,contentType:type==='stylesheet'?'text/css':'text/javascript',body:type==='stylesheet'?'body{color:red}':'window.publicFixture=true;'});},abort:()=>route.abort()})),newPage:async()=>{page=await context.newPage();return page;}};
  }};}});
  const who={canonicalId:'SYNTHETIC-PUBLIC'},cookie='fcu_session=synthetic-public';const session=await manager.start(who,cookie,true,3001,'real');
  try {await page.waitForLoadState('load');assert.equal(assets,2);assert.equal(await page.evaluate(()=>window.publicFixture),true);assert.ok((await manager.frame(session.id,who,cookie,session.grant)).length>0);}
  finally {await manager.cancel(session.id,who,cookie,session.grant);}
});

test('declared synthetic history assets initialize page and six categories through shared PoC', {skip:!enabled}, async () => {
  const {chromium}=require('playwright');const {isDeclaredMyFcuAsset}=await import('../src/services/myfcuCompatibility.js');
  const {collectRealMyFcuHistory}=await import('../src/services/myfcuRealHistory.js');
  const browser=await chromium.launch({channel:'chrome',headless:true});
  try {
    const context=await browser.newContext();const page=await context.newPage(),allowed=[];
    const fixture='<link rel="stylesheet" href="/main/assets/history.css"><script src="/main/assets/history.js"></script>'+html.replace('<div id="content" hidden>','<div id="content">').replace('document.body.dataset.loaded=id','void 0');
    await context.route('**/*',async route=>{
      const req=route.request();if(req.isNavigationRequest() && new URL(req.url()).pathname==='/main/S3603/S360380_pmust.aspx')return route.fulfill({status:200,contentType:'text/html',body:fixture});
      const yes=await isDeclaredMyFcuAsset(req,page,'history',{allowHistory:true});if(!yes)return route.abort();allowed.push(req.resourceType());
      return route.fulfill({status:200,contentType:req.resourceType()==='script'?'text/javascript':'text/css',body:req.resourceType()==='script'?'window.fixtureInitialized=true;':'body{color:red}'});
    });
    await page.goto('https://myfcu.fcu.edu.tw/main/S3603/S360380_pmust.aspx',{waitUntil:'load'});
    assert.deepEqual(allowed.sort(),['script','stylesheet']);assert.equal(await page.evaluate(()=>window.fixtureInitialized),true);
    const result=await collectRealMyFcuHistory(page);assert.equal(result.allCategoriesComplete,true);assert.equal(result.categories.length,6);assert.equal(result.duplicateRows,1);
    await context.close();
  } finally {await browser.close();}
});


test('history XHR retry flood closes the browser context on the threshold', {skip:!enabled}, async () => {
  const {createHistoryPostRetryGuard}=await import('../src/services/myfcuCompatibility.js');
  const {chromium}=require('playwright');const browser=await chromium.launch({channel:'chrome',headless:true});
  const context=await browser.newContext({serviceWorkers:'block'});const guard=createHistoryPostRetryGuard(12);
  let page,blocked=0,stopReason=null;
  try {
    await context.route('**/*',async route=>{
      const req=route.request();
      if(req.isNavigationRequest()) return route.fulfill({status:200,contentType:'text/html',body:'<html><body>fixture</body></html>'});
      if(stopReason) return route.abort().catch(()=>{});
      const f=req.frame();const result=guard.record({url:req.url(),sourceUrl:f.url(),method:req.method(),resourceType:req.resourceType(),navigation:req.isNavigationRequest(),mainFrame:f===page.mainFrame()});
      if(result.tracked) blocked++;
      if(result.stop && !stopReason){stopReason='HISTORY_POST_RETRY_LIMIT';void context.close().catch(()=>{});}
      await route.abort().catch(()=>{});
    });
    page=await context.newPage();await page.goto('https://myfcu.fcu.edu.tw/main/S3603/S360380_pmust.aspx?fixture=1#/unrecognized');
    await page.evaluate(()=>{ for(let i=0;i<250;i++){const x=new XMLHttpRequest();x.open('POST','/main/S3603/example');x.onerror=()=>{};x.send();} }).catch(()=>{});
    for(let i=0;i<100&&!stopReason;i++)await new Promise(resolve=>setTimeout(resolve,20));
    assert.equal(stopReason,'HISTORY_POST_RETRY_LIMIT');assert.equal(blocked,12);for(let i=0;i<100&&!page.isClosed();i++)await new Promise(resolve=>setTimeout(resolve,20));assert.equal(page.isClosed(),true);
  } finally {await context.close().catch(()=>{});await browser.close();}
});

test('real driver safely selects a confirmed category from Angular bootstrap root', {skip:!enabled}, async()=>{
 const {chromium}=require('playwright');const {collectRealMyFcuHistory}=await import('../src/services/myfcuRealHistory.js');
 const browser=await chromium.launch({channel:'chrome',headless:true});
 try {const context=await browser.newContext();const page=await context.newPage();
  const fixture=html.replace('<div id="content" hidden>','<div id="content">').replace('document.body.dataset.loaded=id','void 0')+'<script>window.angular={element:()=>({injector:()=>({get:()=>({pendingRequests:[]})})})};location.hash="/unrecognized-initial";</script>';
  await context.route('**/*',route=>route.fulfill({status:200,contentType:'text/html',body:fixture}));
  await page.goto('https://myfcu.fcu.edu.tw/main/S3603/S360380_pmust.aspx');
  const result=await collectRealMyFcuHistory(page);
  assert.equal(result.allCategoriesComplete,true);assert.equal(result.categories.length,6);assert.equal(result.duplicateRows,1);assert.equal(result.records.filter(r=>r.courseCode==='TEST1001').length,2);
  await page.evaluate(()=>location.hash='/https://evil.test');
  await assert.rejects(collectRealMyFcuHistory(page),e=>e.failedCheck==='HASH_REJECTED');
  await context.close();
 }finally{await browser.close();}
});
