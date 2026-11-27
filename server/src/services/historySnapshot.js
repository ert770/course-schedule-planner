import crypto from 'node:crypto';
const snapshots = new Map();
const lifetimeMs = 30 * 60 * 1000;
const maxSnapshots = 3;
const version = 1;
const categories = ['#/courseXd', '#/courseKind1', '#/courseXc', '#/courseKind23', '#/courseSelP', '#/courseSelPno'];
const reviewableCategories = new Set(['#/courseKind1', '#/courseKind23']);
function owner(identity) {
 const id = Number(identity?.numericId);
 if (!identity?.found || identity.source !== 'mysql' || !identity.canWriteMysqlProfile || !Number.isSafeInteger(id) || id < 1 || !identity.canonicalId) throw new Error('SNAPSHOT_IDENTITY');
 return `${id}:${identity.canonicalId}`;
}
function digest(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function cleanup() { const now=Date.now(); for(const [key,s] of snapshots) if(s.expiresAt<=now) snapshots.delete(key); }
export function canSnapshotHistory(result) {
 if (!Array.isArray(result?.records) || !Array.isArray(result.pendingRecords)) return false;
 if (result.allCategoriesComplete === true) return true;
 if (!Array.isArray(result.categories) || result.categories.length !== categories.length) return false;
 return categories.every(hash => result.categories.some(category => category?.hash === hash && (
  category.status === 'complete' || (reviewableCategories.has(hash) && category.status === 'incomplete' &&
   category.rowReviewOnly === true && category.rowSummary?.invalidRows > 0)
 )));
}
export function saveHistorySnapshot(identity,result) {
 cleanup();const key=owner(identity);
 if(!canSnapshotHistory(result))throw new Error('SNAPSHOT_INCOMPLETE');
 const payload=JSON.stringify(result);if(Buffer.byteLength(payload)>4*1024*1024)throw new Error('SNAPSHOT_TOO_LARGE');
 const hash=digest(payload);const old=snapshots.get(key);
 if(old && old.hash===hash && old.status==='ready')return {createdAt:old.createdAt,expiresAt:old.expiresAt,version,hash};
 if(!old && snapshots.size>=maxSnapshots)throw new Error('SNAPSHOT_LIMIT');
 const now=Date.now();const entry={payload,hash,createdAt:now,expiresAt:now+lifetimeMs,status:'ready'};snapshots.set(key,entry);const timer=setTimeout(()=>{if(snapshots.get(key)===entry)snapshots.delete(key);},lifetimeMs);timer.unref?.();
 return {createdAt:now,expiresAt:now+lifetimeMs,version,hash};
}
export function readHistorySnapshot(identity) {
 cleanup();const s=snapshots.get(owner(identity));if(!s || s.status!=='ready')return null;
 if(digest(s.payload)!==s.hash)throw new Error('SNAPSHOT_INTEGRITY');
 return {result:JSON.parse(s.payload),createdAt:s.createdAt,expiresAt:s.expiresAt,version,hash:s.hash,preflight:s.preflight ?? null};
}
export function claimHistorySnapshot(identity) { const data=readHistorySnapshot(identity);if(!data)return null;const s=snapshots.get(owner(identity));s.status='importing';return data; }
export function releaseHistorySnapshot(identity,consumed=false) {const key=owner(identity),s=snapshots.get(key);if(!s)return;if(consumed){snapshots.delete(key);return;}if(s.expiresAt>Date.now())s.status='ready';else snapshots.delete(key);}

export function setHistorySnapshotPreflight(identity,hash,summary) {const data=readHistorySnapshot(identity);if(!data || data.hash!==hash)throw new Error('SNAPSHOT_CHANGED');const s=snapshots.get(owner(identity));s.preflight=JSON.parse(JSON.stringify(summary));}
