// 階段 4 本機原型。SELECT 公開課程；只寫 git-ignored simulation-runs。
// 預設 dry-run；--apply 才會送文字到 OpenAI；--include-syllabi 會額外納入 DB 大綱文字。
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const serverDir = fileURLToPath(new URL('../', import.meta.url));
dotenv.config({ path: path.join(serverDir, '.env'), quiet: true });
dotenv.config({ path: path.resolve(serverDir, '../.env'), quiet: true });
const { getAll } = await import('../src/db/database.js');
const { closePool } = await import('../src/db/mysql.js');
const { interestTagCatalog } = await import('../src/data/interestTagCatalog.js');
const { buildCourseTextDocuments, COURSE_TEXT_VECTOR_VERSION,
  COURSE_TEXT_SYLLABUS_VECTOR_VERSION } = await import('../src/skills/courseTextVector.js');
const args = process.argv.slice(2);
const model = args.find(arg => arg.startsWith('--model='))?.slice(8) ?? 'text-embedding-3-large';
const includeSyllabi = args.includes('--include-syllabi');
if (!['text-embedding-3-large', 'text-embedding-3-small'].includes(model)) throw new Error('不支援的 embedding 模型');
const outDir = path.join(serverDir, 'simulation-runs', 'course-text-embeddings');
const cacheFile = path.join(outDir, `${model}-cache.json`);
const outputFile = path.join(outDir, 'index.json');

try {
  const courses = await getAll('courses');
  const syllabi = includeSyllabi ? await (await import('../src/db/database.js')).getCourseSyllabusVectorDocuments() : [];
  const textVersion = includeSyllabi ? COURSE_TEXT_SYLLABUS_VECTOR_VERSION : COURSE_TEXT_VECTOR_VERSION;
  const documents = buildCourseTextDocuments(courses, syllabi, { includeSyllabi });
  let cache = {};
  try { cache = JSON.parse(await fs.readFile(cacheFile, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const missing = documents.filter(doc => !cache[doc.contentHash]);
  const summary = {
    model, catalogVersion: interestTagCatalog.catalogVersion, sections: courses.length,
    uniqueCourses: documents.length, cached: documents.length - missing.length,
    toSend: missing.length, withDescription: documents.filter(doc => doc.hasDescription).length,
    withSyllabus: documents.filter(doc => doc.hasSyllabus).length,
    syllabusRows: syllabi.length,
    textVersion,
    truncated: documents.filter(doc => doc.truncated).length,
    // UTF-8 byte 數為保守 token 上界估算；實際用量依 API 回傳。
    estimatedTokenUpperBound: missing.reduce((sum, doc) => sum + Buffer.byteLength(doc.text, 'utf8'), 0),
    outputFile,
  };
  console.log(JSON.stringify(summary, null, 2));
  if (!args.includes('--apply')) {
    console.log('唯讀盤點完成；未呼叫外部 API。加 --apply 才建立本機產物。');
  } else {
    await fs.mkdir(outDir, { recursive: true });
    let actualTokens = 0;
    if (missing.length > 0) {
      if (!process.env.OPENAI_API_KEY) throw new Error('未設定 OPENAI_API_KEY');
      const { default: OpenAI } = await import('openai');
      const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
      // 每份文件最多 1800 code points，每批最多 16 份，保守限制總 token。
      for (let offset = 0; offset < missing.length; offset += 16) {
        const batch = missing.slice(offset, offset + 16);
        const response = await client.embeddings.create({ model, input: batch.map(doc => doc.text) });
        if (response.data.length !== batch.length) throw new Error('API 回傳向量數量不符');
        for (const row of response.data) {
          if (!batch[row.index] || !Array.isArray(row.embedding)) throw new Error('API 回傳索引不正確');
          cache[batch[row.index].contentHash] = row.embedding;
        }
        actualTokens += response.usage?.total_tokens ?? 0;
        const tempFile = `${cacheFile}.tmp`;
        await fs.writeFile(tempFile, JSON.stringify(cache));
        await fs.rename(tempFile, cacheFile);
        console.log(`已產生 ${Math.min(offset + 16, missing.length)} / ${missing.length}`);
      }
    }
    const dimension = cache[documents[0]?.contentHash]?.length;
    if (!dimension) throw new Error('沒有可輸出的向量');
    const artifact = {
      schemaVersion: 1, textVersion,
      catalogVersion: interestTagCatalog.catalogVersion, embeddingModel: model, dimension,
      generatedAt: new Date().toISOString(), actualTokens,
      courses: documents.map(doc => ({ courseCode: doc.courseCode, contentHash: doc.contentHash, vector: cache[doc.contentHash] })),
    };
    const { buildCourseTextEmbeddingIndex } = await import('../src/skills/courseTextVector.js');
    buildCourseTextEmbeddingIndex(courses, artifact, syllabi);
    const tempFile = `${outputFile}.tmp`;
    await fs.writeFile(tempFile, JSON.stringify(artifact));
    await fs.rename(tempFile, outputFile);
    console.log(`已寫出本機產物；實際 API token 用量：${actualTokens}`);
  }
} finally {
  await closePool();
}
