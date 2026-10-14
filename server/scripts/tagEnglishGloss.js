// 標籤相近表（階段 2）的中英對照：替每個向量標籤產生簡短的英文對照，供 tagEmbeddingStage2.js
// 以「中文（English）」計算 embedding，讓短中文詞不再被字面拖著走（例：神經網路 被拉向 網路管理）。
//
// **只送標籤名稱，不含任何使用者資料。** 對資料庫不讀也不寫。
// 結果寫到 `server/simulation-runs/tag-english-gloss/glosses.json`（不進版控），重跑只送還沒翻譯的標籤。
//
// 用法：node scripts/tagEnglishGloss.js

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(scriptDir, '..', '.env'), quiet: true });
dotenv.config({ path: path.resolve(scriptDir, '..', '..', '.env'), quiet: true });

const { interestTagCatalog } = await import('../src/data/interestTagCatalog.js');
const { isVectorEligibleTag } = await import('../src/skills/tagVectorSpace.js');

const outDir = path.resolve(scriptDir, '..', 'simulation-runs', 'tag-english-gloss');
const outFile = path.join(outDir, 'glosses.json');
const MODEL = process.env.OPENAI_MODEL || 'gpt-5.6-luna';
const BATCH = 80;
const CONCURRENCY = 3;

const SYSTEM = [
  '你在整理大學課程的主題標籤。請為每個標籤給出最通用的英文學術用語（2～6 個英文字），用來區分意思。',
  '例如：神經網路 → neural networks；網路管理 → network administration；演算法 → algorithms；',
  '資訊安全 → information security；機構學 → mechanisms (mechanical engineering)。',
  '標籤本身已是英文或是軟體名稱時，原樣回傳（例：Python → Python；Matlab → MATLAB）。',
  '只回傳 JSON：{"glosses":[...]}，陣列順序與長度必須和輸入完全相同，每一項是英文字串。',
].join('\n');

let client = null;
async function ask(names) {
  if (!client) {
    if (!process.env.OPENAI_API_KEY) throw new Error('未設定 OPENAI_API_KEY。');
    const { default: OpenAI } = await import('openai');
    client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  const input = names.map((name, i) => `${i + 1}. ${name}`).join('\n');
  const response = await client.responses.create({
    model: MODEL, instructions: SYSTEM, input: [{ role: 'user', content: `共 ${names.length} 個標籤：\n${input}` }],
  }, { timeout: 180000 });
  const match = String(response.output_text ?? '').match(/\{[\s\S]*\}/);
  const glosses = match ? JSON.parse(match[0]).glosses : null;
  return Array.isArray(glosses) && glosses.length === names.length
    && glosses.every(item => typeof item === 'string' && item.trim() && item.length <= 80)
    ? glosses.map(item => item.trim())
    : null;
}

const tags = interestTagCatalog.canonicalTags.filter(isVectorEligibleTag);
const cache = fs.existsSync(outFile) ? JSON.parse(fs.readFileSync(outFile, 'utf8')) : {};
const pending = tags.filter(tag => !cache[tag.id]);
console.log(`標籤 ${tags.length} 個，已有 ${tags.length - pending.length} 個，需翻譯 ${pending.length} 個`);
fs.mkdirSync(outDir, { recursive: true });
const batches = [];
for (let start = 0; start < pending.length; start += BATCH) batches.push(pending.slice(start, start + BATCH));
let done = 0;
for (let group = 0; group < batches.length; group += CONCURRENCY) {
  await Promise.all(batches.slice(group, group + CONCURRENCY).map(async batch => {
    let glosses = null;
    for (let attempt = 0; attempt < 3 && !glosses; attempt += 1) glosses = await ask(batch.map(tag => tag.name)).catch(() => null);
    if (!glosses) { console.log(`  「${batch[0].name}」起的一批連續三次失敗，略過`); return; }
    batch.forEach((tag, i) => { cache[tag.id] = glosses[i]; });
    fs.writeFileSync(outFile, JSON.stringify(cache, null, 1));
    done += batch.length;
    console.log(`  已完成 ${done} / ${pending.length}`);
  }));
}
const missing = tags.filter(tag => !cache[tag.id]).length;
console.log(`完成：${tags.length - missing} 個有英文對照，${missing} 個缺少（重跑會補）`);
