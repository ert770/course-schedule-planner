import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLocalBrowserManager } from '../src/services/controlledBrowserService.js';
import { controlledBrowserBodyError } from '../src/routes/controlledBrowser.js';
import { describeUrl } from '../scripts/diagnoseMyFcuIntegrated.mjs';

test('synthetic sensitive inputs are not written to application console, screenshot paths, or error responses', async () => {
  const sensitive='synthetic-password-token-marker';const calls=[];let options, screenOptions;
  const original={log:console.log,warn:console.warn,error:console.error};
  for(const key of Object.keys(original))console[key]=(...args)=>calls.push(args.map(String).join(' '));
  const page={on:()=>{},goto:async()=>({ok:()=>true}),evaluate:async()=>false,screenshot:async value=>{screenOptions=value;return Buffer.from('synthetic-image');},keyboard:{insertText:async()=>{}},mouse:{}};
  const context={route:async()=>{},newPage:async()=>page,close:async()=>{}};
  const manager=createLocalBrowserManager({launch:async()=>({newContext:async o=>{options=o;return context;},close:async()=>{}})});
  try {
    const who={canonicalId:'SYNTHETIC'},cookie='fcu_session=synthetic-only';
    const session=await manager.start(who,cookie,true,3001);
    const result=await manager.input(session.id,who,cookie,{type:'text',text:sensitive});
    await manager.frame(session.id,who,cookie);
    let payload;controlledBrowserBodyError(Object.assign(new Error(sensitive),{status:400}),{}, {status(){return this},json(v){payload=v}},()=>{});
    assert.equal(JSON.stringify({result,payload,calls}).includes(sensitive),false);
    assert.equal(screenOptions.path,undefined);assert.equal(options.recordVideo,undefined);assert.equal(options.recordHar,undefined);assert.equal(options.storageState,undefined);
    await manager.cancel(session.id,who,cookie);
  } finally {Object.assign(console,original);}
});

test('diagnostics report only preverified origin and fixed pathname without tokens', () => {
  const result=describeUrl('https://myfcu.fcu.edu.tw/main/InfoMyFcuLogin.aspx?token=synthetic-secret#synthetic-fragment');
  assert.equal(result.path,'/main/InfoMyFcuLogin.aspx');assert.equal(JSON.stringify(result).includes('synthetic'),false);
  assert.deepEqual(describeUrl('https://unknown.example/private/synthetic-secret'),{official:false,origin:'人工確認',path:'人工確認'});
  assert.equal(describeUrl('https://myfcu.fcu.edu.tw/private/synthetic-secret').path,'人工確認');
});

test('unexpected controlled-browser exceptions never expose synthetic credentials even with status', async () => {
  const {sendControlledBrowserError}=await import('../src/routes/controlledBrowser.js');
  const secret='synthetic-sensitive-error';let code,payload;
  const res={status(n){code=n;return this;},json(body){payload=body;}};
  sendControlledBrowserError(res,Object.assign(new Error(secret),{status:400,code:secret}));
  assert.equal(code,500);assert.equal(JSON.stringify(payload).includes(secret),false);
});

test('diagnostic blocks unconfirmed POST rather than exposing a broad domain', async () => {
  const {isObservedLoginPost}=await import('../scripts/diagnoseMyFcuIntegrated.mjs');
  assert.equal(isObservedLoginPost('https://myfcu.fcu.edu.tw/main/InfoMyFcuLogin.aspx','POST',true,{mainFrame:true,sourceUrl:'https://myfcu.fcu.edu.tw/main/InfoMyFcuLogin.aspx',phase:'login'}),true);
  assert.equal(isObservedLoginPost('https://myfcu.fcu.edu.tw/unknown','POST',false),false);
  assert.equal(isObservedLoginPost('https://example.test/main/InfoMyFcuLogin.aspx','POST',true),false);
  assert.equal(isObservedLoginPost('https://myfcu.fcu.edu.tw/main/InfoMyFcuLogin.aspx?next=bad','POST',true),false);
});

test('POST diagnostic distinguishes login query and AJAX while hiding unknown paths', async () => {
  const {classifyPost}=await import('../scripts/diagnoseMyFcuIntegrated.mjs');
  const salt=Buffer.alloc(32,7),base='https://myfcu.fcu.edu.tw';
  assert.equal(classifyPost(base+'/main/InfoMyFcuLogin.aspx',true,salt,{mainFrame:true,sourceUrl:base+'/main/InfoMyFcuLogin.aspx',phase:'login'}).reason,'ALLOWED_LOGIN');
  assert.equal(classifyPost(base+'/main/InfoMyFcuLogin.aspx',false,salt).reason,'LOGIN_SOURCE_OR_PHASE_UNVERIFIED');
  assert.equal(classifyPost(base+'/main/InfoMyFcuLogin.aspx',false,salt,{mainFrame:true,sourceUrl:base+'/main/InfoMyFcuLogin.aspx',phase:'login'}).reason,'ALLOWED_LOGIN');
  assert.equal(classifyPost(base+'/main/InfoMyFcuLogin.aspx?secret=synthetic',true,salt).reason,'LOGIN_QUERY_MISMATCH');
  const a=classifyPost(base+'/private/synthetic-student?token=secret',false,salt),b=classifyPost(base+'/private/synthetic-student?other=value',false,salt);
  assert.equal(a.endpointId,b.endpointId);assert.equal(a.pathname,'需本人確認');assert.equal(JSON.stringify(a).includes('synthetic'),false);
  assert.notEqual(a.endpointId,classifyPost(base+'/private/other',false,salt).endpointId);
});

test('login query equivalence is limited to one known redirect parameter', async () => {
  const {isKnownLoginQuery,allowedPersonalRequest}=await import('../src/services/myfcuCompatibility.js');
  const {describeLoginQuery}=await import('../scripts/diagnoseMyFcuIntegrated.mjs');
  const base='https://myfcu.fcu.edu.tw/main/InfoMyFcuLogin.aspx',ctx={mainFrame:true,sourceUrl:base,phase:'login'},salt=Buffer.alloc(32,2);
  for(const query of ['?Redirect=%2fmain%2fS3603%2fS360380_pmust.aspx','?Redirect=/main/S3603/S360380_pmust.aspx'])assert.equal(allowedPersonalRequest(base+query,'POST',false,ctx),true);
  for(const query of ['?Redirect=/main/S3603/S360380_pmust.aspx&extra=secret','?Redirect=/main/S3603/S360380_pmust.aspx&Redirect=else','?Redirect=/other'])assert.equal(isKnownLoginQuery(new URL(base+query)),false);
  const summary=describeLoginQuery(base+'?Redirect=synthetic-secret&private-name=another-secret',salt);
  assert.equal(JSON.stringify(summary).includes('secret'),false);assert.equal(JSON.stringify(summary).includes('private-name'),false);
  assert.equal(summary.parameterCount,2);assert.equal(summary.parameterNames[0],'Redirect');
});

test('public resource report exposes only conservative same-origin static paths and never query', async () => {
  const {publicStaticPath}=await import('../scripts/diagnoseMyFcuIntegrated.mjs');
  assert.equal(publicStaticPath('https://myfcu.fcu.edu.tw/main/css/site.css?token=synthetic','stylesheet'),'/main/css/site.css');
  assert.equal(publicStaticPath('https://myfcu.fcu.edu.tw/main/D8800001/photo.png','image'),null);
  assert.equal(publicStaticPath('https://myfcu.fcu.edu.tw/main/session-secret.js','script'),null);
  assert.equal(publicStaticPath('https://external.example/main/app.js','script'),null);
  assert.equal(publicStaticPath('https://myfcu.fcu.edu.tw/main/record.aspx','script'),null);
});
