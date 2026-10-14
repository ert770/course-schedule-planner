// 協同過濾與 User Embedding 構想階段 1：用當學期課程建立標籤空間向量，抽 20 門課列出最相近的 5 門，
// 供人工檢查。**只讀**：對資料庫只做 SELECT，輸出到 `server/simulation-runs/<out>/`（不進版控）。
//
// 抽樣：10 門依關鍵字挑（每個關鍵字取課號最小的一門），10 門依固定種子隨機挑，結果可重現。
// 另外比較「納入 too_common 標籤」與「不納入」時，有多少課程的最近鄰居改變。
//
// 用法：node scripts/tagVectorStage1Check.js --out=tag-vector-stage1

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(scriptDir, '..', '.env'), quiet: true });
dotenv.config({ path: path.resolve(scriptDir, '..', '..', '.env'), quiet: true });

const { getAll } = await import('../src/db/database.js');
const { closePool, isMysqlConfigured } = await import('../src/db/mysql.js');
const { interestTagCatalog } = await import('../src/data/interestTagCatalog.js');
const { buildCourseTagVectors, nearestCourses } = await import('../src/skills/tagVectorSpace.js');
const { makeRandom } = await import('./lib/choiceEvaluation.js');

const args = process.argv.slice(2);
const outName = args.find(arg => arg.startsWith('--out='))?.split('=')[1];
if (!outName) { console.error('請指定 --out=<名稱>'); process.exit(1); }
const outDir = path.resolve(scriptDir, '..', 'simulation-runs', outName);

const KEYWORDS = ['機器學習', '人工智慧', '資料庫', '網路', '程式設計', '金融', '管理', '設計', '英文', '物聯網'];
const RANDOM_COUNT = 10;
const SEED = 20261014;
const K = 5;

const tooCommonNames = new Set(interestTagCatalog.canonicalTags
  .filter(tag => tag.eligibility?.exclusionReason === 'too_common')
  .map(tag => tag.name));

function sampleCodes(index, courses) {
  const departmentOf = new Map();
  for (const course of courses) {
    const code = String(course.catalogCourseCode ?? '').trim().toUpperCase();
    if (code && !departmentOf.has(code)) departmentOf.set(code, course.department ?? '');
  }
  const usable = [...index.vectors.entries()]
    .filter(([, vector]) => vector.norm > 0)
    .map(([code]) => code)
    .sort();
  const picked = [];
  for (const keyword of KEYWORDS) {
    const code = usable.find(item => !picked.includes(item) && index.courseNames.get(item).includes(keyword));
    if (code) picked.push(code);
  }
  const random = makeRandom(SEED);
  const rest = usable.filter(code => !picked.includes(code));
  while (picked.length < KEYWORDS.length + RANDOM_COUNT && rest.length > 0) {
    picked.push(rest.splice(Math.floor(random() * rest.length), 1)[0]);
  }
  return picked.map(code => ({ code, department: departmentOf.get(code) ?? '' }));
}

function describe(index, code) {
  const vector = index.vectors.get(code);
  return [...vector.weights.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([id, weight]) => `${index.tagNames.get(id)}(${weight.toFixed(2)})`);
}

async function main() {
  if (!isMysqlConfigured()) throw new Error('未設定 MySQL（DB_*），無法量測。');
  const courses = await getAll('courses');
  const index = buildCourseTagVectors(courses);
  const withoutCommon = buildCourseTagVectors(courses.map(course => ({
    ...course,
    ragTag: (Array.isArray(course.ragTag) ? course.ragTag : []).filter(raw => !tooCommonNames.has(String(raw).trim())),
  })));

  const zero = [...index.vectors.values()].filter(vector => !(vector.norm > 0)).length;
  const sizes = [...index.vectors.values()].map(vector => vector.weights.size).sort((a, b) => a - b);
  const idfValues = [...index.idf.values()];
  const commonIdf = [...index.idf.entries()]
    .filter(([id]) => tooCommonNames.has(index.tagNames.get(id)))
    .map(([id, value]) => ({ tag: index.tagNames.get(id), courses: index.documentFrequency.get(id), idf: Number(value.toFixed(3)) }))
    .sort((a, b) => a.idf - b.idf);

  // 納入 too_common 前後，最近 1 門鄰居改變或從無到有的課程數。
  let gainedNeighbor = 0;
  let changedTop1 = 0;
  for (const code of index.vectors.keys()) {
    const after = nearestCourses(index, code, { k: 1 })[0]?.courseCode ?? null;
    const before = nearestCourses(withoutCommon, code, { k: 1 })[0]?.courseCode ?? null;
    if (after && !before) gainedNeighbor += 1;
    else if (after !== before) changedTop1 += 1;
  }

  const samples = sampleCodes(index, courses).map(({ code, department }) => ({
    courseCode: code,
    name: index.courseNames.get(code),
    department,
    tags: describe(index, code),
    neighbors: nearestCourses(index, code, { k: K }).map(item => ({
      courseCode: item.courseCode,
      name: index.courseNames.get(item.courseCode),
      similarity: Number(item.similarity.toFixed(3)),
      sharedTags: item.sharedTags.map(tag => tag.canonicalName),
    })),
  }));

  const summary = {
    modelVersion: index.modelVersion,
    courseCodes: index.courseCount,
    vectorTags: index.idf.size,
    zeroVectorCourses: zero,
    tagsPerCourse: { min: sizes[0], median: sizes[Math.floor(sizes.length / 2)], max: sizes[sizes.length - 1] },
    idfRange: { min: Number(Math.min(...idfValues).toFixed(3)), max: Number(Math.max(...idfValues).toFixed(3)) },
    tooCommonIdf: commonIdf,
    tooCommonEffect: { gainedNeighbor, changedTop1 },
  };

  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'stage1.json'), JSON.stringify({ generatedAt: new Date().toISOString(), summary, samples }, null, 2));

  const lines = ['# 階段 1：標籤空間向量抽查', '', '```json', JSON.stringify(summary, null, 2), '```', ''];
  samples.forEach((sample, number) => {
    lines.push(`## ${number + 1}. ${sample.name}（${sample.courseCode}，${sample.department}）`, '');
    lines.push(`標籤：${sample.tags.join('、')}`, '');
    lines.push('| # | 相近課程 | 相似度 | 共用標籤 |', '| --- | --- | --- | --- |');
    sample.neighbors.forEach((item, rank) => {
      lines.push(`| ${rank + 1} | ${item.name}（${item.courseCode}） | ${item.similarity} | ${item.sharedTags.join('、')} |`);
    });
    lines.push('');
  });
  fs.writeFileSync(path.join(outDir, 'stage1.md'), lines.join('\n'));
  console.log(JSON.stringify(summary, null, 2));
}

try {
  await main();
} finally {
  await closePool();
}
