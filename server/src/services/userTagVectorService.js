// 協同過濾與 User Embedding 構想階段 4：在正式服務中載入使用者的標籤空間向量。
// 構想見 docs/CHANGE_REPORTS/2026-10-14-cf-user-embedding-design.md 3.3、3.7。
//
// 只在使用者同意 `personalization_learning` 時計算（與 rag-tag-interest-v1 相同）；
// 未同意時回傳 `consented: false`，呼叫端不得改用其他方式推測興趣。
// 使用者向量只在記憶體中計算，不寫入任何資料表。

import fs from 'node:fs';
import { ACTIVE_TERM } from '../data/activeTerm.js';
import { PRIVACY_RETENTION } from '../data/privacyPolicy.js';
import { getInteractionEventsForExport, hasPersonalizationConsent } from './interactionEventService.js';
import { buildCourseTagVectors, buildTagSimilarity } from '../skills/tagVectorSpace.js';
import { buildUserTagVector } from '../skills/userTagVector.js';

const neighborTable = JSON.parse(
  fs.readFileSync(new URL('../data/tagVectorNeighbors.json', import.meta.url), 'utf8'),
);
let similarity = null;

/** 階段 2 的標籤相近表轉成的對稱查表（只建一次）。 */
export function getTagSimilarity() {
  if (!similarity) similarity = buildTagSimilarity(neighborTable);
  return similarity;
}

// 課程向量依「課程陣列」快取：同一份課程資料（例如探索服務已快取的 courses）只建一次索引。
const indexCache = new WeakMap();
export function getCourseTagIndex(courses) {
  if (!Array.isArray(courses)) return buildCourseTagVectors([]);
  let index = indexCache.get(courses);
  if (!index) {
    index = buildCourseTagVectors(courses);
    indexCache.set(courses, index);
  }
  return index;
}

async function defaultLoadEvents(identity, now) {
  if (!(await hasPersonalizationConsent(identity))) return { consented: false, events: [] };
  const retentionMs = PRIVACY_RETENTION.interactionEventDays * 86400000;
  const events = (await getInteractionEventsForExport(identity)).filter(event => {
    const time = Date.parse(event.timestamp ?? '');
    return Number.isFinite(time) && now.getTime() - time <= retentionMs;
  });
  return { consented: true, events };
}

/**
 * @param identity  resolveIdentity() 的結果
 * @param profile   getUserPreferences() 的結果（讀 courseHistory 與興趣）
 * @param courses   課程陣列（建立課程向量）
 * @param deps      測試用注入：{ loadEvents, now }
 * @returns { consented, user, index, similarity }；未同意時 user 為 null。
 */
export async function loadUserTagVectorContext(identity, profile, courses, deps = {}) {
  const now = deps.now ? new Date(deps.now()) : new Date();
  const { consented, events } = deps.loadEvents
    ? await deps.loadEvents(identity)
    : await defaultLoadEvents(identity, now);
  const index = getCourseTagIndex(courses);
  if (!consented) return { consented: false, user: null, index, similarity: getTagSimilarity() };
  const user = buildUserTagVector({
    courseHistory: Array.isArray(profile?.courseHistory) ? profile.courseHistory : [],
    events,
    prefs: profile ?? {},
    index,
    activeTerm: ACTIVE_TERM,
    now: now.toISOString(),
  });
  return { consented: true, user, index, similarity: getTagSimilarity() };
}

export default { getTagSimilarity, getCourseTagIndex, loadUserTagVectorContext };
