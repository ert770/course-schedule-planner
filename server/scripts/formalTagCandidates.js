// 形式標籤候選清單：找出「描述上課形式或泛用詞、而不是課程主題」的向量標籤，供人工審核後在向量中降權。
// 背景見 docs/CHANGE_REPORTS/2026-10-14-tag-vector-stage1.md 4.2。
//
// **只讀**：對資料庫只做 SELECT。輸出到 `server/simulation-runs/<out>/`（不進版控）。
//
// 兩個指標（以當學期課程、課號為單位）：
//   一致性（coherence）  帶有這個標籤的課，拿掉這個標籤後兩兩之間的平均餘弦相似度。
//                         主題標籤的課彼此也像（帶「半導體」的課都是電子材料課）；
//                         形式標籤的課彼此不像（帶「互動教學」的有航太英文、醫療法、韓文）。
//   系所分散度            帶有這個標籤的課分布在幾個不同系所，除以課數（1 = 每門課都在不同系所）。
// 候選條件：出現在至少 3 門課，且一致性低於門檻（預設 0.05）。
// 依一致性由低到高排序；另列已知例子（互動教學、半導體等）的指標，讓審核者知道門檻落在哪裡。
//
// 用法：node scripts/formalTagCandidates.js --out=formal-tag-candidates [--max-coherence=0.05]

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
const { parseClassName } = await import('../src/skills/courseScope.js');
const { buildCourseTagVectors } = await import('../src/skills/tagVectorSpace.js');

const args = process.argv.slice(2);
const argValue = name => args.find(arg => arg.startsWith(`--${name}=`))?.split('=')[1];
const outName = argValue('out');
if (!outName) { console.error('請指定 --out=<名稱>'); process.exit(1); }
const outDir = path.resolve(scriptDir, '..', 'simulation-runs', outName);
const MAX_COHERENCE = Number(argValue('max-coherence') ?? 0.05);
const MIN_COURSES = 3;
const REFERENCE_TAGS = ['互動教學', '學術討論', '研究生', '人文社會科學', '資訊科技', '資訊技術', '專業英語',
  '工業應用', '批判性思維', '半導體', '資料庫', '機器學習', '行政法', '管理會計', '物聯網'];

const mainName = new Map(interestTagCatalog.mainCategories.map(item => [item.id, item.name]));
const tagById = new Map(interestTagCatalog.canonicalTags.map(tag => [tag.id, tag]));
const round = value => (value === null ? null : Number(value.toFixed(4)));

// 去掉某個標籤後的餘弦相似度。
function cosineWithout(left, right, excludedId) {
  let dot = 0; let leftNorm = 0; let rightNorm = 0;
  for (const [id, value] of left) {
    if (id === excludedId) continue;
    leftNorm += value * value;
    const other = right.get(id);
    if (other !== undefined) dot += value * other;
  }
  for (const [id, value] of right) if (id !== excludedId) rightNorm += value * value;
  return leftNorm > 0 && rightNorm > 0 ? dot / Math.sqrt(leftNorm * rightNorm) : 0;
}

async function main() {
  if (!isMysqlConfigured()) throw new Error('未設定 MySQL（DB_*），無法量測。');
  const courses = await getAll('courses');
  const index = buildCourseTagVectors(courses);
  const departmentOf = new Map();
  for (const course of courses) {
    const code = String(course.catalogCourseCode ?? '').trim().toUpperCase();
    if (!code || departmentOf.has(code)) continue;
    const parsed = parseClassName(course.department);
    departmentOf.set(code, parsed.department || course.department || '');
  }
  const coursesByTag = new Map();
  for (const [code, vector] of index.vectors) {
    for (const id of vector.weights.keys()) {
      if (!coursesByTag.has(id)) coursesByTag.set(id, []);
      coursesByTag.get(id).push(code);
    }
  }

  const rows = [];
  for (const [id, codes] of coursesByTag) {
    if (codes.length < MIN_COURSES) continue;
    let sum = 0; let pairs = 0;
    for (let i = 0; i < codes.length; i += 1) {
      const left = index.vectors.get(codes[i]).weights;
      for (let j = i + 1; j < codes.length; j += 1) {
        sum += cosineWithout(left, index.vectors.get(codes[j]).weights, id);
        pairs += 1;
      }
    }
    const departments = new Set(codes.map(code => departmentOf.get(code)));
    const tag = tagById.get(id);
    rows.push({
      canonicalTagId: id,
      tag: index.tagNames.get(id),
      courses: codes.length,
      departments: departments.size,
      departmentSpread: round(departments.size / codes.length),
      coherence: round(sum / pairs),
      idf: round(index.idf.get(id)),
      tooCommon: tag?.eligibility?.exclusionReason === 'too_common',
      mainCategories: [...new Set((tag?.categoryAssignments ?? []).map(item => mainName.get(item.mainCategoryId)))].join('、'),
      examples: codes.slice(0, 6).map(code => `${index.courseNames.get(code)}（${departmentOf.get(code)}）`),
    });
  }
  rows.sort((a, b) => a.coherence - b.coherence || b.departmentSpread - a.departmentSpread);
  const candidates = rows.filter(row => row.coherence < MAX_COHERENCE);
  const reference = REFERENCE_TAGS.map(name => {
    const row = rows.find(item => item.tag === name);
    return row
      ? { tag: name, courses: row.courses, coherence: row.coherence, departmentSpread: row.departmentSpread, rank: rows.indexOf(row) + 1 }
      : { tag: name, note: '出現少於 3 門課或不是向量標籤' };
  });
  const coherences = rows.map(row => row.coherence).sort((a, b) => a - b);
  const quantile = q => coherences[Math.floor(q * (coherences.length - 1))];
  const summary = {
    scoredTags: rows.length,
    maxCoherence: MAX_COHERENCE,
    candidates: candidates.length,
    coherenceQuantiles: { p10: quantile(0.1), p25: quantile(0.25), median: quantile(0.5), p75: quantile(0.75) },
  };

  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'candidates.json'), JSON.stringify({
    generatedAt: new Date().toISOString(), readOnly: true, summary, reference, candidates, allScored: rows,
  }, null, 2));
  console.log(JSON.stringify({ summary, reference }, null, 2));
}

try {
  await main();
} finally {
  await closePool();
}
