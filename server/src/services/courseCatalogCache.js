// 完整課程目錄的短期快取。`getAll('courses')` 每次都重新查詢 MySQL（實測 1.4～3 秒），
// 學期內課程不變，所以排課的系外保留候選與歷史修課回饋共用這份快取（10 分鐘）。
// 回傳同一個陣列，也讓 userTagVectorService 依陣列身分快取的課程索引生效。
// 探索服務另有自己的快取（含字元二元組 tf-idf 索引），不在此處。
import { getAll } from '../db/database.js';

export const COURSE_CATALOG_CACHE_TTL_MS = 10 * 60 * 1000;
let cache = null;
// 同時進來的請求（例如頁面載入時的多個 API）共用同一次查詢，不各自打資料庫。
let inFlight = null;

export function resetCourseCatalogCache() {
  cache = null;
  inFlight = null;
}

export async function getCachedCourseCatalog({ now = Date.now(), loadCourses = () => getAll('courses') } = {}) {
  if (cache && cache.expiresAt > now) return cache.courses;
  if (!inFlight) {
    const pending = Promise.resolve()
      .then(loadCourses)
      .then((courses) => {
        cache = { courses, expiresAt: now + COURSE_CATALOG_CACHE_TTL_MS };
        return courses;
      })
      .finally(() => {
        if (inFlight === pending) inFlight = null;
      });
    inFlight = pending;
  }
  return inFlight;
}

export default { COURSE_CATALOG_CACHE_TTL_MS, getCachedCourseCatalog, resetCourseCatalogCache };
