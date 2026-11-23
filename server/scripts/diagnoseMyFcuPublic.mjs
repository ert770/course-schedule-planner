import dns from 'node:dns/promises';
import tls from 'node:tls';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { MYFCU_START_URL } from '../src/services/myfcuCompatibility.js';
const require = createRequire(import.meta.url), host = 'myfcu.fcu.edu.tw';
export function allowedRequest(raw, navigation, method='GET') {
  try { const u=new URL(raw), path=decodeURIComponent(u.pathname).toLowerCase(); if(u.protocol!=='https:'||u.hostname!==host||u.port||u.username||u.password||method!=='GET') return false; if(navigation) return path==='/main/infomyfculogin.aspx'; return /\.(?:js|css|png|jpe?g|gif|svg|ico|woff2?)$/.test(path); } catch { return false; }
}
export function summarizeHeaders(headers) {
  const names=['content-security-policy','content-security-policy-report-only','x-frame-options','strict-transport-security','x-content-type-options','referrer-policy','permissions-policy'];
  const out=Object.fromEntries(names.map(n=>[n,Boolean(headers[n])]));
  for(const n of names.slice(0,2)) out[`${n}-directives`]=(headers[n]||'').split(';').map(x=>x.trim().split(/\s+/)[0]).filter(x=>/^[a-z][a-z0-9-]*$/i.test(x));
  return out;
}
function testTls(){ return new Promise((resolve,reject)=>{const s=tls.connect({host,port:443,servername:host,rejectUnauthorized:true});s.setTimeout(10000,()=>s.destroy(Object.assign(new Error('timeout'),{code:'TIMEOUT'})));s.once('secureConnect',()=>{s.end();resolve();});s.once('error',reject);}); }
function safeCode(e){const x=String(e?.code||'UNAVAILABLE');return /^[A-Z0-9_]{1,40}$/.test(x)?x:'UNAVAILABLE';}
export async function runDiagnostic(){
  const report={dns:{status:'BLOCKED'},tls:{status:'BLOCKED'},http:{status:'BLOCKED'},redirect:{status:'BLOCKED'},csp:{status:'BLOCKED'},browser:{status:'BLOCKED'}};
  try{await dns.lookup(host);report.dns={status:'PASS'};}catch(e){report.dns={status:'FAIL',reason:safeCode(e)};return report;}
  try{await testTls();report.tls={status:'PASS'};}catch(e){report.tls={status:'FAIL',reason:safeCode(e)};return report;}
  let browser,context,blockedNavigation=false;
  try{
    const {chromium}=require('playwright');browser=await chromium.launch({channel:'chrome',headless:true});context=await browser.newContext({acceptDownloads:false});report.browser={status:'PASS',context:'non-persistent'};
    await context.route('**/*',route=>{const q=route.request();if(allowedRequest(q.url(),q.isNavigationRequest(),q.method()))return route.continue();if(q.isNavigationRequest())blockedNavigation=true;return route.abort();});
    const page=await context.newPage();page.on('popup',p=>void p.close().catch(()=>{}));
    const response=await page.goto(MYFCU_START_URL,{waitUntil:'domcontentloaded',timeout:20000});
    if(!response){report.http={status:'FAIL',reason:'NO_RESPONSE'};return report;}
    report.http={status:response.ok()?'PASS':'FAIL',statusCode:response.status()};let count=0,prev=response.request().redirectedFrom();while(prev){count++;prev=prev.redirectedFrom();}
    report.redirect={status:blockedNavigation?'BLOCKED':'PASS',httpRedirects:count,finalPage:'public-login-only',note:'Login Redirect parameter cannot be verified without authentication'};
    report.csp={status:'PASS',headers:summarizeHeaders(await response.allHeaders())};
  }catch(e){if(report.browser.status!=='PASS')report.browser={status:'FAIL',reason:e?.code==='MODULE_NOT_FOUND'?'PLAYWRIGHT_NOT_INSTALLED':'LAUNCH_FAILED'};else{report.http={status:'FAIL',reason:'NAVIGATION_FAILED'};report.redirect={status:'BLOCKED',reason:'NAVIGATION_OR_REDIRECT_RESTRICTED'};}}
  finally{await context?.close().catch(()=>{});await browser?.close().catch(()=>{});}
  return report;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){const r=await runDiagnostic();console.log(JSON.stringify(r,null,2));if(Object.values(r).some(x=>x.status==='FAIL'))process.exitCode=1;}
