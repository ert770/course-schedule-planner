import crypto from 'node:crypto';
import { saveHistorySnapshot } from './historySnapshot.js';
import { createRequire } from 'node:module';
import { observeMyFcu } from '../../scripts/observeMyFcuCompatibility.mjs';
import { readSession, parseCookies, SESSION_COOKIE_NAME, SESSION_MAX_AGE_SECONDS } from './sessionService.js';
import { isIsolatedHistoryMysqlE2E, isSyntheticHistoryIdentity, isLocalSelfAttestedHistory, isSessionHistoryImport } from './isolatedHistoryE2E.js';
const require=createRequire(import.meta.url), sessions=new Map(), maxSessions=3, ttl=5*60*1000;
// Do not pass database credentials, API keys or proxy credentials to Chrome.
export function localBrowserEnvironment(env=process.env){
 const allowed=new Set(['SYSTEMROOT','WINDIR','COMSPEC','PATH','PATHEXT','TEMP','TMP','USERPROFILE','LOCALAPPDATA','APPDATA','PROGRAMFILES','PROGRAMFILES(X86)','PROGRAMDATA','HOMEDRIVE','HOMEPATH','LANG']);
 return Object.fromEntries(Object.entries(env).filter(([key,value])=>allowed.has(key.toUpperCase()) && typeof value==='string'));
}
const safeError=(message,status=400)=>Object.assign(new Error(message),{status,safeLocalPreviewError:true});
function ownerFor(identity,cookie){
 const session=readSession(cookie),token=parseCookies(cookie)[SESSION_COOKIE_NAME];
 if(!session||!token||!identity?.found||session.studentId!==identity.canonicalId)throw safeError('登入狀態已失效',401);
 return {key:crypto.createHash('sha256').update(token).update('\0').update(identity.canonicalId).digest('hex'),deadline:session.issuedAt+SESSION_MAX_AGE_SECONDS*1000};
}
function get(id,identity,cookie,grant){
 const owner=ownerFor(identity,cookie),s=sessions.get(id);
 if(!s||s.owner!==owner.key||typeof grant!=='string'||!/^[a-f0-9]{64}$/.test(grant))throw safeError('找不到工作階段',404);
 const digest=crypto.createHash('sha256').update(grant).digest();if(!crypto.timingSafeEqual(digest,s.grant))throw safeError('找不到工作階段',404);
 if(Date.now()>=s.expires){close(id);throw safeError('工作階段已逾時',410);}return s;
}
function close(id){const s=sessions.get(id);if(!s)return;sessions.delete(id);clearTimeout(s.timer);s.abort.abort();s.result=null;s.grant=null;}
export function closeLocalMyFcuOwned(identity,cookie){let owner;try{owner=ownerFor({...identity,found:true},cookie).key;}catch{return;}for(const [id,s] of sessions)if(s.owner===owner)close(id);}
export function createLocalMyFcuPreview({observer=observeMyFcu,getChromium=()=>require('playwright').chromium}={}) { return {
 async start(identity,cookie,consent){
  if(process.platform!=='win32'||process.env.NODE_ENV==='production'||process.env.LOCAL_MYFCU_PREVIEW!=='true')throw safeError('本機預覽尚未開放',403);
  if(process.env.DEBUG || process.env.PWDEBUG || process.env.PLAYWRIGHT_DEBUG)throw safeError('請先關閉瀏覽器偵錯記錄',403);
  if(consent!==true)throw safeError('請先同意資料使用告知');
  const owner=ownerFor(identity,cookie);if([...sessions.values()].some(s=>s.owner===owner.key))throw safeError('已有進行中的工作階段',409);if(sessions.size>=maxSessions)throw safeError('工作階段已滿',503);
  const id=crypto.randomUUID(),grant=crypto.randomBytes(32).toString('hex'),expires=Math.min(Date.now()+ttl,owner.deadline);if(expires<=Date.now())throw safeError('登入狀態已逾時',401);
  const s={owner:owner.key,grant:crypto.createHash('sha256').update(grant).digest(),expires,status:'starting',result:null,abort:new AbortController()};sessions.set(id,s);s.timer=setTimeout(()=>close(id),expires-Date.now());s.timer.unref?.();
  void (async () => {
   try {
    const sessionImport = isSessionHistoryImport();
    const synthetic = isIsolatedHistoryMysqlE2E() && process.env.LOCAL_MYFCU_SYNTHETIC_E2E === 'true';
    const run = synthetic ? (await import('../../test/syntheticLocalMyFcuObserver.js')).observeSyntheticLocal : observer;
    const report = await run({
     chromium: getChromium(), signal: s.abort.signal, strictFrames: true, launchEnv: localBrowserEnvironment(),
     allowPartialRows: sessionImport,
     onResult: result => {
      if (sessions.get(id) !== s) return;
      if (synthetic && (!isSyntheticHistoryIdentity(identity) || result.syntheticSubject !== identity.canonicalId)) return;
      const { syntheticSubject: _, ...safe } = result;
      s.result = safe;
      s.syntheticProof = synthetic;
     },
    });
    if (sessions.get(id) !== s) return;
    const completed = report.status === 'COMPLETE' || (sessionImport && report.status === 'PARTIAL');
    if (completed && s.result) {
     if (sessionImport) s.snapshot = saveHistorySnapshot(identity, s.result);
     s.status = 'ready';
    } else s.status = 'error';
   } catch {
    if (sessions.get(id) === s) s.status = 'error';
   }
  })();
  return {id,grant,expiresAt:expires,status:'starting'};
 },
 state(id,identity,cookie,grant){const s=get(id,identity,cookie,grant);return {status:s.status,result:s.result,snapshot:s.snapshot ?? null,systemIdentity:{numericId:Number.isSafeInteger(Number(identity.numericId)) && Number(identity.numericId)>0 ? Number(identity.numericId) : null},identityVerification:s.syntheticProof?{verified:true,source:'synthetic'}:{verified:false,reason:'未驗證 MyFCU 身分，請確認由本人登入'}};},
 cancel(id,identity,cookie,grant){get(id,identity,cookie,grant);close(id);},
}; }
// Test-only source binding; no client-controlled user identity is accepted.
export function verifyLocalSyntheticHistoryProof(identity,cookie,records){
 if(!isIsolatedHistoryMysqlE2E() || process.env.LOCAL_MYFCU_SYNTHETIC_E2E!=='true' || !isSyntheticHistoryIdentity(identity) || !Array.isArray(records))return false;
 let owner;try{owner=ownerFor(identity,cookie).key;}catch{return false;}
 const s=[...sessions.values()].find(x=>x.owner===owner&&x.syntheticProof&&x.status==='ready'&&x.expires>Date.now());
 if(!s?.result?.allCategoriesComplete)return false;const originals=[...(s.result.records??[]),...(s.result.pendingRecords??[])];
 return records.length>0&&records.every(row=>originals.some(x=>['courseCode','courseName','academicYear','semester','credits','sourceCreditRecord'].every(k=>(x[k]??null)===(row[k]??null))));
}
// A declaration proves only that the user confirmed this session's extracted data.
export function verifyLocalAttestedHistorySource(identity,cookie,records){
 if(!isLocalSelfAttestedHistory() || !Array.isArray(records) || !records.length)return false;
 let owner;try{owner=ownerFor(identity,cookie).key;}catch{return false;}
 const s=[...sessions.values()].find(x=>x.owner===owner&&x.status==='ready'&&x.expires>Date.now());
 if(!s?.result?.allCategoriesComplete)return false;
 const originals=[...(s.result.records??[]),...(s.result.pendingRecords??[])];
 return records.every(row=>originals.some(x=>!x.conflictingRows?.length && ['courseCode','courseName','academicYear','semester','credits','sourceCreditRecord'].every(k=>(x[k]??null)===(row[k]??null))));
}
export function getLocalHistoryForAutoImport(identity,cookie){
 if(!isLocalSelfAttestedHistory() && !isSessionHistoryImport())return null;
 let owner;try{owner=ownerFor(identity,cookie).key;}catch{return null;}
 const s=[...sessions.values()].find(x=>x.owner===owner&&x.status==='ready'&&x.expires>Date.now());
 if(!s?.result?.allCategoriesComplete)return null;
 s.status='importing';
 return [...(s.result.records??[]),...(s.result.pendingRecords??[])];
}
export function releaseLocalHistoryImport(identity,cookie){
 let owner;try{owner=ownerFor(identity,cookie).key;}catch{return;}
 const s=[...sessions.values()].find(x=>x.owner===owner&&x.status==='importing'&&x.expires>Date.now());
 if(s)s.status='ready';
}
export const localMyFcuPreview=createLocalMyFcuPreview();
