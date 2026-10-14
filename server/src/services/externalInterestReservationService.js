import { getCachedCourseCatalog } from './courseCatalogCache.js';
import { loadUserTagVectorContext } from './userTagVectorService.js';
import { scoreCoursesForUser } from '../skills/userTagVector.js';
import { logger } from '../utils/logger.js';

// 候選課的 s_vec。系外保留名額與階段 6 的 s_vec shadow 共用同一次計算。
// 完整課程目錄只用來建立課程向量；用共用的 10 分鐘快取，避免每次排課都多讀一次 MySQL。
// 只供伺服器排課流程建立；不接受 HTTP body 傳入的分數。
export async function loadCandidateVectorScores(identity, prefs, candidates, {
  loadCourses = () => getCachedCourseCatalog(),
  loadContext = loadUserTagVectorContext,
} = {}) {
  try {
    const catalog = await loadCourses();
    // 使用完整課程目錄，歷史課才不會因未在本次候選池中而失去向量。
    const context = await loadContext(identity, prefs, catalog);
    if (!context.consented) return { source: 'no-consent', scores: new Map() };
    if (!context.user?.positive?.size) return { source: 'no-positive-signal', scores: new Map() };
    const scores = scoreCoursesForUser(context.user, context.index,
      candidates.map(course => course.catalogCourseCode), { similarity: context.similarity });
    return { source: 's_vec', modelVersion: context.user.modelVersion, scores };
  } catch (error) {
    logger.warn(`候選課 s_vec 無法計算：${error.message}`, { label: 'Schedule' });
    return { source: 'unavailable', scores: new Map() };
  }
}

// keyword 是可重現舊行為的 A/B 開關，不是另一種學習模型。
// `precomputed` 是同一次排課已算好的 loadCandidateVectorScores() 結果。
export async function loadExternalInterestReservation(identity, prefs, candidates, {
  mode = process.env.EXTERNAL_INTEREST_RESERVATION_MODE ?? 'vector',
  precomputed = null,
  ...deps
} = {}) {
  if (mode === 'keyword') return null;
  if (mode !== 'vector') {
    logger.warn('系外興趣保留候選無法計算，改用原畢業配額：EXTERNAL_INTEREST_RESERVATION_MODE 只接受 vector 或 keyword',
      { label: 'Schedule' });
    return { source: 'unavailable', scores: new Map() };
  }
  return precomputed ?? loadCandidateVectorScores(identity, prefs, candidates, deps);
}
