import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCourseTextEmbeddingIndex } from '../skills/courseTextVector.js';

const defaultFile = fileURLToPath(new URL('../../simulation-runs/course-text-embeddings/index.json', import.meta.url));
let cache;
export function resetCourseTextEmbeddingCache() { cache = null; }

// 本機離線產物。探索請求只讀檔案；不呼叫 embedding API、不寫 MySQL。
export async function loadCourseTextEmbeddingIndex(courses) {
  const file = process.env.COURSE_TEXT_EMBEDDINGS_PATH
    ? path.resolve(process.env.COURSE_TEXT_EMBEDDINGS_PATH) : defaultFile;
  try {
    const stat = await fs.stat(file);
    if (!cache || cache.file !== file || cache.mtime !== stat.mtimeMs || cache.size !== stat.size) {
      const artifact = JSON.parse(await fs.readFile(file, 'utf8'));
      cache = { file, mtime: stat.mtimeMs, size: stat.size, artifact };
    }
    if (cache.indexCourses !== courses) {
      cache.index = buildCourseTextEmbeddingIndex(courses, cache.artifact);
      cache.indexCourses = courses;
    }
    return { available: true, index: cache.index };
  } catch (error) {
    if (error.code === 'ENOENT') return { available: false, reason: 'text-embeddings-unavailable' };
    // 格式、版本與讀檔失敗均不退成另一種方法，以免 A/B 名稱和實際計算不一致。
    console.warn('課程文字向量產物暫時無法使用：', error.message);
    return { available: false, reason: 'text-embeddings-invalid' };
  }
}
