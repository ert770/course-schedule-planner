import { getAll } from '../db/database.js';
import { loadUserTagVectorContext } from './userTagVectorService.js';
import { scoreCoursesForUser } from '../skills/userTagVector.js';
import { logger } from '../utils/logger.js';

// 只供伺服器排課流程建立；不接受 HTTP body 傳入的分數。
// keyword 是可重現舊行為的 A/B 開關，不是另一種學習模型。
export async function loadExternalInterestReservation(identity, prefs, candidates, {
  mode = process.env.EXTERNAL_INTEREST_RESERVATION_MODE ?? 'vector',
  loadCourses = () => getAll('courses'),
  loadContext = loadUserTagVectorContext,
} = {}) {
  if (mode === 'keyword') return null;
  try {
    if (mode !== 'vector') throw new Error('EXTERNAL_INTEREST_RESERVATION_MODE 只接受 vector 或 keyword');
    const catalog = await loadCourses();
    // 使用完整課程目錄，歷史課才不會因未在本次候選池中而失去向量。
    const context = await loadContext(identity, prefs, catalog);
    if (!context.consented) return { source: 'no-consent', scores: new Map() };
    if (!context.user?.positive?.size) return { source: 'no-positive-signal', scores: new Map() };
    const scores = scoreCoursesForUser(context.user, context.index,
      candidates.map(course => course.catalogCourseCode), { similarity: context.similarity });
    return { source: 's_vec', modelVersion: context.user.modelVersion, scores };
  } catch (error) {
    logger.warn(`系外興趣保留候選無法計算，改用原畢業配額：${error.message}`, { label: 'Schedule' });
    return { source: 'unavailable', scores: new Map() };
  }
}
