import { Router } from 'express';
import { requireIdentity } from '../middleware/requireIdentity.js';
import { requireServiceConsent } from '../middleware/requireConsent.js';
import { isMysqlConfigured, getPool, withTransaction } from '../db/mysql.js';
import { readHistorySnapshot, claimHistorySnapshot, releaseHistorySnapshot, setHistorySnapshotPreflight } from '../services/historySnapshot.js';
import { isIsolatedHistoryMysqlE2E, isLocalSelfAttestedHistory, isSessionHistoryImport } from '../services/isolatedHistoryE2E.js';
import { verifyIsolatedHistoryProof, closeOwned } from '../services/controlledBrowserService.js';
import { courseHistoryImporter } from '../services/courseHistoryImportService.js';
import { verifyLocalSyntheticHistoryProof, verifyLocalAttestedHistorySource, getLocalHistoryForAutoImport, closeLocalMyFcuOwned, releaseLocalHistoryImport } from '../services/localMyFcuPreview.js';
import { importExtractedHistory } from '../services/courseHistoryAutoImport.js';
const router=Router();
router.use(requireIdentity,requireServiceConsent);
const localRequest=req=>['127.0.0.1','::ffff:127.0.0.1'].includes(req.socket.localAddress) && ['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress) && ['localhost','127.0.0.1'].includes((req.get('host')||'').split(':')[0]);
router.get('/snapshot', (req,res)=>{
 res.set('Cache-Control','no-store');if(!isSessionHistoryImport() || !localRequest(req))return res.sendStatus(403);
 try { const snapshot=readHistorySnapshot(req.identity);if(!snapshot)return res.status(404).json({error:'沒有可用快照，請重新擷取'});return res.json({ ...snapshot, numericId:Number(req.identity.numericId), studentId:req.identity.canonicalId }); } catch {return res.status(409).json({error:'快照無法驗證'});}
});
router.post('/snapshot-preview', async(req,res)=>{
 res.set('Cache-Control','no-store');if(!isSessionHistoryImport() || !localRequest(req) || req.get('origin')!==(process.env.CLIENT_ORIGIN||'http://localhost:5173') || Object.keys(req.body ?? {}).length!==0)return res.sendStatus(403);
 try {const snap=readHistorySnapshot(req.identity);if(!snap)return res.status(404).json({error:'沒有可用快照'});const rows=[...(snap.result.records??[]),...(snap.result.pendingRecords??[])];const summary=await importExtractedHistory(req.identity,rows,fn=>fn(getPool()),{sessionImport:true,dryRun:true});setHistorySnapshotPreflight(req.identity,snap.hash,summary);return res.json({numericId:Number(req.identity.numericId),studentId:req.identity.canonicalId,summary,hash:snap.hash});}catch{return res.status(503).json({error:'唯讀比對未完成'});}
});
router.post('/auto',async(req,res)=>{
 res.set('Cache-Control','no-store');
 if(!(isLocalSelfAttestedHistory() || isSessionHistoryImport()) || !['127.0.0.1','::ffff:127.0.0.1'].includes(req.socket.localAddress) || !['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress) || !['localhost','127.0.0.1'].includes((req.get('host')||'').split(':')[0]) || req.get('origin')!==(process.env.CLIENT_ORIGIN||'http://localhost:5173') || req.body?.consent!==true || req.body?.identityConfirmed!==true || Object.keys(req.body).some(k=>!['consent','identityConfirmed','snapshotHash'].includes(k)))return res.status(403).json({error:'本機來源或本人聲明未確認'});
 if (isSessionHistoryImport()) {
  let snap;try { snap=claimHistorySnapshot(req.identity);if(!snap || !snap.preflight || req.body.snapshotHash!==snap.hash || snap.preflight.conflicts>0){if(snap)releaseHistorySnapshot(req.identity);return res.status(409).json({error:'快照或唯讀比對已失效，請重新檢查'});} const rows=[...(snap.result.records??[]),...(snap.result.pendingRecords??[])];
   const result=await withTransaction(async connection=>{await connection.execute('SELECT user_id FROM User_Profiles WHERE user_id = ? FOR UPDATE',[Number(req.identity.numericId)]);const run=fn=>fn(connection);const current=await importExtractedHistory(req.identity,rows,run,{sessionImport:true,dryRun:true});if(JSON.stringify(current)!==JSON.stringify(snap.preflight) || current.conflicts>0)throw new Error('PREFLIGHT_CHANGED');return importExtractedHistory(req.identity,rows,run,{sessionImport:true});});
   releaseHistorySnapshot(req.identity,true);closeLocalMyFcuOwned(req.identity,req.headers.cookie);return res.json(result);
  } catch { if(snap)releaseHistorySnapshot(req.identity);return res.status(409).json({error:'匯入未完成或資料已變更，請重新比對'}); }
 }
 const rows=getLocalHistoryForAutoImport(req.identity,req.headers.cookie);if(!rows)return res.status(403).json({error:'擷取工作階段已失效'});
 try{const result=await importExtractedHistory(req.identity,rows);closeLocalMyFcuOwned(req.identity,req.headers.cookie);res.json(result);}catch{releaseLocalHistoryImport(req.identity,req.headers.cookie);return res.status(503).json({error:'匯入未完成，請稍後重試'});}
});
export async function configureHistoryImport(req,res,next){
  const fixture=process.env.COURSE_HISTORY_IMPORT_FIXTURE==='true';
  if(isLocalSelfAttestedHistory()) {
    if (!['127.0.0.1','::ffff:127.0.0.1'].includes(req.socket.localAddress) || !['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress) || !['localhost','127.0.0.1'].includes((req.get('host')||'').split(':')[0]) || req.body?.localSourceAttested!==true || !verifyLocalAttestedHistorySource(req.identity,req.headers.cookie,req.body?.records)) return res.status(403).json({error:'本機來源或本人聲明未確認'});
    req.historyImporter=courseHistoryImporter;req.historyIdentity=req.identity;req.historyLocalAttestation=true;
  } else if(isIsolatedHistoryMysqlE2E()) {
    if (!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress) || !(verifyIsolatedHistoryProof(req.identity,req.headers.cookie,req.body?.records) || verifyLocalSyntheticHistoryProof(req.identity,req.headers.cookie,req.body?.records))) return res.status(403).json({error:'隔離測試身分或來源不符'});
    req.historyImporter=courseHistoryImporter;req.historyIdentity=req.identity;
  } else if(fixture){
    const valid=process.env.NODE_ENV==='test' && process.env.CONTROLLED_BROWSER_MOCK==='true' && process.env.CONTROLLED_BROWSER_REAL_TEST!=='true' && process.env.CONTROLLED_BROWSER_PERSONAL_TEST!=='true' && !isMysqlConfigured() && ['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress) && ((req.identity.canonicalId==='AC-FIXTURE-A' && Number(req.identity.numericId)===1)||(req.identity.canonicalId==='AC-FIXTURE-B' && Number(req.identity.numericId)===2));
    if(!valid)return res.status(403).json({error:'隔離測試條件不符'});
    req.historyImporter=(await import('../../test/fixtures/courseHistoryImportMemory.js')).fixtureImporter;
    req.historyIdentity={...req.identity,source:'mysql'};req.historyFixture=true;
  } else {
    if(process.env.COURSE_HISTORY_IMPORT_ENABLED!=='true' || process.env.CONTROLLED_BROWSER_MOCK==='true' || process.env.CONTROLLED_BROWSER_REAL_TEST==='true' || process.env.CONTROLLED_BROWSER_PERSONAL_TEST==='true')return res.status(503).json({error:'修課匯入尚未啟用'});
    // A client assertion cannot establish that the MyFCU account belongs to this session.
    // The production path must stay closed until a server-side identity proof exists.
    return res.status(503).json({error:'MyFCU 身分核對尚未完成，正式匯入尚未開放'});
  }
  const origin=req.get('origin');
  const expected=process.env.CLIENT_ORIGIN||'http://localhost:5173';
  if(!origin || origin!==expected) return res.status(403).json({error:'請從網站操作匯入'});
  next();
}
router.use(configureHistoryImport);
for(const action of ['preview','commit'])router.post('/'+action,async(req,res)=>{
  try {res.set('Cache-Control','no-store');const result=await req.historyImporter[action](req.body,req.historyIdentity,req.historyLocalAttestation?{localAttested:true}:undefined);if(action==='commit' && (isIsolatedHistoryMysqlE2E() || req.historyLocalAttestation)){await closeOwned(req.identity,req.headers.cookie);closeLocalMyFcuOwned(req.identity,req.headers.cookie);}res.json({...result,...(req.historyFixture?{fixture:true}:{})});}
  catch(e){if(e.code==='ER_DUP_ENTRY')return res.status(409).json({error:'資料已有變動，請重新預覽'});res.status(e.safeImportError?e.status:503).json({error:e.safeImportError?e.message:'修課匯入暫時無法使用'});}
});
export default router;
