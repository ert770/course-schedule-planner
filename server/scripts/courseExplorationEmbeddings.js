// 探索頁三種相近程度的向量產生器（2026-11-24）。課名、課程說明、課程主題各一個向量。
// 只讀公開課程資料與修課紀錄裡的課號／課名（不含使用者、成績）；只寫 git-ignored 的 simulation-runs。
// 預設 dry-run；--apply 才送文字到 OpenAI。快取以「模型＋維度＋文字」雜湊為鍵，重跑只送變動的文字。
//
// 用法：
//   node scripts/courseExplorationEmbeddings.js            # 盤點
//   node scripts/courseExplorationEmbeddings.js --apply    # 產生 simulation-runs/course-exploration-embeddings/index.json
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const serverDir = fileURLToPath(new URL('../', import.meta.url));
dotenv.config({ path: path.join(serverDir, '.env'), quiet: true });
dotenv.config({ path: path.resolve(serverDir, '../.env'), quiet: true });
const { getAll } = await import('../src/db/database.js');
const { closePool, queryRows } = await import('../src/db/mysql.js');
const {
  buildExplorationDocuments, encodeVector, fieldHash, EXPLORATION_VECTOR_FIELDS, EXPLORATION_VECTOR_VERSION,
} = await import('../src/skills/courseExplorationVectors.js');

const args = process.argv.slice(2);
const model = 'text-embedding-3-large';
const dimension = Number(args.find(arg => arg.startsWith('--dimension='))?.slice(12) ?? 512);
const outDir = path.join(serverDir, 'simulation-runs', 'course-exploration-embeddings');
const cacheFile = path.join(outDir, `${model}-${dimension}-cache.json`);
const outputFile = path.join(outDir, 'index.json');
const BATCH = 32;

try {
  const courses = await getAll('courses');
  const history = await queryRows(
    'SELECT DISTINCT `catalog_course_code` AS courseCode, `course_name` AS courseName FROM `User_Course_History` WHERE `catalog_course_code` IS NOT NULL',
  );
  const documents = buildExplorationDocuments(courses, history);
  let cache = {};
  try { cache = JSON.parse(await fs.readFile(cacheFile, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }

  const texts = new Map();
  for (const doc of documents) {
    for (const field of EXPLORATION_VECTOR_FIELDS) {
      const text = doc.texts[field];
      if (text) texts.set(fieldHash(model, dimension, text), text);
    }
  }
  const missing = [...texts].filter(([hash]) => !cache[hash]);
  console.log(JSON.stringify({
    model, dimension,
    courses: documents.length,
    catalogCourses: documents.filter(doc => doc.source === 'catalog').length,
    historyOnlyCourses: documents.filter(doc => doc.source === 'history').length,
    withDescription: documents.filter(doc => doc.texts.description).length,
    withTopic: documents.filter(doc => doc.texts.topic).length,
    uniqueTexts: texts.size, toSend: missing.length,
    estimatedTokenUpperBound: missing.reduce((sum, [, text]) => sum + Buffer.byteLength(text, 'utf8'), 0),
    outputFile,
  }, null, 2));

  if (!args.includes('--apply')) {
    console.log('唯讀盤點完成；未呼叫外部 API。加 --apply 才產生向量。');
  } else {
    await fs.mkdir(outDir, { recursive: true });
    let actualTokens = 0;
    if (missing.length > 0) {
      if (!process.env.OPENAI_API_KEY) throw new Error('未設定 OPENAI_API_KEY');
      const { default: OpenAI } = await import('openai');
      const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
      for (let offset = 0; offset < missing.length; offset += BATCH) {
        const batch = missing.slice(offset, offset + BATCH);
        const response = await client.embeddings.create({ model, dimensions: dimension, input: batch.map(([, text]) => text) });
        if (response.data.length !== batch.length) throw new Error('API 回傳向量數量不符');
        for (const row of response.data) {
          if (!batch[row.index] || row.embedding?.length !== dimension) throw new Error('API 回傳索引或維度不正確');
          cache[batch[row.index][0]] = row.embedding;
        }
        actualTokens += response.usage?.total_tokens ?? 0;
        const tempFile = `${cacheFile}.tmp`;
        await fs.writeFile(tempFile, JSON.stringify(cache));
        await fs.rename(tempFile, cacheFile);
        if ((offset / BATCH) % 10 === 0 || offset + BATCH >= missing.length) {
          console.log(`已產生 ${Math.min(offset + BATCH, missing.length)} / ${missing.length}`);
        }
      }
    }
    const artifact = {
      schemaVersion: 1, version: EXPLORATION_VECTOR_VERSION, model, dimension,
      generatedAt: new Date().toISOString(), actualTokens,
      courses: documents.map(doc => ({
        courseCode: doc.courseCode, source: doc.source, name: doc.name,
        vectors: Object.fromEntries(EXPLORATION_VECTOR_FIELDS.map(field => {
          const text = doc.texts[field];
          return [field, text ? encodeVector(cache[fieldHash(model, dimension, text)]) : null];
        })),
      })),
    };
    const tempFile = `${outputFile}.tmp`;
    await fs.writeFile(tempFile, JSON.stringify(artifact));
    await fs.rename(tempFile, outputFile);
    console.log(`已寫出 ${outputFile}；實際 API token 用量：${actualTokens}`);
  }
} finally {
  await closePool();
}
