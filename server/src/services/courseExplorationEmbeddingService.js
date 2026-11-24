// 探索頁三種相近程度的離線向量（scripts/courseExplorationEmbeddings.js 產生，git-ignored）。
// 請求時只讀檔；不呼叫 embedding API、不寫 MySQL。檔案沒變就沿用記憶體中的索引。
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildExplorationVectorIndex } from '../skills/courseExplorationVectors.js';

const defaultFile = fileURLToPath(new URL('../../simulation-runs/course-exploration-embeddings/index.json', import.meta.url));
let cache = null;

export function resetCourseExplorationEmbeddingCache() {
  cache = null;
}

export async function loadCourseExplorationVectors() {
  const file = process.env.COURSE_EXPLORATION_EMBEDDINGS_PATH
    ? path.resolve(process.env.COURSE_EXPLORATION_EMBEDDINGS_PATH) : defaultFile;
  try {
    const stat = await fs.stat(file);
    if (!cache || cache.file !== file || cache.mtime !== stat.mtimeMs || cache.size !== stat.size) {
      const index = buildExplorationVectorIndex(JSON.parse(await fs.readFile(file, 'utf8')));
      cache = { file, mtime: stat.mtimeMs, size: stat.size, index };
    }
    return { available: true, index: cache.index };
  } catch (error) {
    if (error.code === 'ENOENT') return { available: false, reason: 'exploration-vectors-unavailable' };
    // 格式或版本不符時不退成別的方法，以免畫面上的說明和實際算法不一致。
    console.warn('探索向量產物暫時無法使用：', error.message);
    return { available: false, reason: 'exploration-vectors-invalid' };
  }
}

export default { loadCourseExplorationVectors, resetCourseExplorationEmbeddingCache };
