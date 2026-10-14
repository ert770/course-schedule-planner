// 協同過濾與 User Embedding 構想階段 2（B，用途 1）：標籤相近表。
// 構想見 docs/CHANGE_REPORTS/2026-10-14-cf-user-embedding-design.md 3.2.2。
//
// 1. 取向量用的標準標籤（tagVectorSpace.js 的資格規則）。預設只送標籤名稱；--text=path 會加上分類路徑。
// 2. 送進 OpenAI 文字 embedding API。**只送標籤與分類名稱，不含任何使用者資料。**
//    結果依內容雜湊快取在 `server/simulation-runs/tag-embeddings/`（不進版控），重跑不會重送。
// 3. 每個標籤找出最相近的前 5 個標籤（餘弦相似度），輸出候選表與分段抽樣供人工檢查 τ。
// 4. 指定 --tau 時，另外寫出正式相近表 `src/data/tagVectorNeighbors.json`（只含相似度 ≥ τ 的對）。
//
// 對資料庫不讀也不寫；標籤目錄來自 `src/data/interestTagCatalog.json`。
//
// 用法：
//   node scripts/tagEmbeddingStage2.js --out=tag-embedding-stage2
//   node scripts/tagEmbeddingStage2.js --out=tag-embedding-stage2 --tau=0.8

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(scriptDir, '..', '.env'), quiet: true });
dotenv.config({ path: path.resolve(scriptDir, '..', '..', '.env'), quiet: true });

const { interestTagCatalog } = await import('../src/data/interestTagCatalog.js');
const { isVectorEligibleTag, TAG_VECTOR_MODEL_VERSION } = await import('../src/skills/tagVectorSpace.js');

const args = process.argv.slice(2);
const argValue = name => args.find(arg => arg.startsWith(`--${name}=`))?.split('=')[1];
const outName = argValue('out');
if (!outName) { console.error('請指定 --out=<名稱>'); process.exit(1); }
const outDir = path.resolve(scriptDir, '..', 'simulation-runs', outName);
const cacheDir = path.resolve(scriptDir, '..', 'simulation-runs', 'tag-embeddings');
// 2026-10-14 比較後採用 large：small 對短中文詞偏重字面（機器學習最近的是機構學）。
const EMBEDDING_MODEL = argValue('model') ?? 'text-embedding-3-large';
const TAU = argValue('tau') ? Number(argValue('tau')) : null;
// name：只送標籤名稱（預設）；path：名稱加上分類路徑。2026-10-14 實測 path 會讓分類路徑主導相似度。
const TEXT_MODE = argValue('text') ?? 'name';
const TOP_K = 5;
const BATCH = 256;
const BANDS = [[0.9, 1.01], [0.85, 0.9], [0.8, 0.85], [0.75, 0.8], [0.7, 0.75]];
const PER_BAND = 10;
const neighborsUrl = new URL('../src/data/tagVectorNeighbors.json', import.meta.url);

const mainName = new Map(interestTagCatalog.mainCategories.map(item => [item.id, item.name]));
const subName = new Map(interestTagCatalog.subcategories.map(item => [item.id, item.name]));

function tagText(tag) {
  if (TEXT_MODE === 'name') return tag.name;
  const paths = [...new Set((tag.categoryAssignments ?? []).map(item => (
    `${mainName.get(item.mainCategoryId) ?? ''}／${subName.get(item.subcategoryId) ?? ''}`
  )))].sort();
  return paths.length > 0 ? `${tag.name}｜${paths.join('；')}` : tag.name;
}

const hash = text => crypto.createHash('sha256').update(text).digest('hex').slice(0, 16);

function loadCache() {
  const file = path.join(cacheDir, `${EMBEDDING_MODEL}.json`);
  return { file, entries: fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {} };
}

async function embedAll(items) {
  const cache = loadCache();
  const missing = items.filter(item => !cache.entries[hash(item.text)]);
  console.log(`標籤 ${items.length} 個，快取已有 ${items.length - missing.length} 個，需送出 ${missing.length} 個`);
  if (missing.length > 0) {
    if (!process.env.OPENAI_API_KEY) throw new Error('未設定 OPENAI_API_KEY。');
    const { default: OpenAI } = await import('openai');
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    let tokens = 0;
    for (let start = 0; start < missing.length; start += BATCH) {
      const batch = missing.slice(start, start + BATCH);
      const response = await client.embeddings.create({ model: EMBEDDING_MODEL, input: batch.map(item => item.text) });
      tokens += response.usage?.total_tokens ?? 0;
      response.data.forEach((row, offset) => { cache.entries[hash(batch[offset].text)] = row.embedding; });
      fs.mkdirSync(cacheDir, { recursive: true });
      fs.writeFileSync(cache.file, JSON.stringify(cache.entries));
      console.log(`  已送出 ${Math.min(start + BATCH, missing.length)} / ${missing.length}`);
    }
    console.log(`API 用量：${tokens} tokens`);
  }
  return items.map(item => {
    const vector = Float32Array.from(cache.entries[hash(item.text)]);
    let norm = 0;
    for (const value of vector) norm += value * value;
    norm = Math.sqrt(norm);
    for (let i = 0; i < vector.length; i += 1) vector[i] /= norm;
    return vector;
  });
}

function topNeighbors(vectors) {
  const count = vectors.length;
  const dimension = vectors[0].length;
  const result = Array.from({ length: count }, () => []);
  for (let i = 0; i < count; i += 1) {
    const left = vectors[i];
    for (let j = i + 1; j < count; j += 1) {
      const right = vectors[j];
      let dot = 0;
      for (let d = 0; d < dimension; d += 1) dot += left[d] * right[d];
      for (const [a, b] of [[i, j], [j, i]]) {
        const list = result[a];
        if (list.length < TOP_K || dot > list[list.length - 1].similarity) {
          list.push({ index: b, similarity: dot });
          list.sort((x, y) => y.similarity - x.similarity);
          if (list.length > TOP_K) list.pop();
        }
      }
    }
  }
  return result;
}

function seededShuffle(list, seed) {
  let state = seed >>> 0;
  const random = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const copy = [...list];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

async function main() {
  const tags = interestTagCatalog.canonicalTags.filter(isVectorEligibleTag);
  const items = tags.map(tag => ({ id: tag.id, name: tag.name, text: tagText(tag) }));
  const vectors = await embedAll(items);
  console.log('計算相近標籤…');
  const neighbors = topNeighbors(vectors);

  const pairs = [];
  const seen = new Set();
  neighbors.forEach((list, i) => list.forEach(({ index, similarity }) => {
    const key = i < index ? `${i}:${index}` : `${index}:${i}`;
    if (seen.has(key)) return;
    seen.add(key);
    pairs.push({ left: items[i].name, right: items[index].name, similarity: Number(similarity.toFixed(4)) });
  }));
  const distribution = {};
  for (const threshold of [0.95, 0.9, 0.85, 0.8, 0.75, 0.7, 0.6]) {
    distribution[`>=${threshold}`] = pairs.filter(pair => pair.similarity >= threshold).length;
  }
  const tagsWithNeighbor = {};
  for (const threshold of [0.9, 0.85, 0.8, 0.75, 0.7]) {
    tagsWithNeighbor[`>=${threshold}`] = neighbors.filter(list => list[0]?.similarity >= threshold).length;
  }
  const samples = BANDS.map(([low, high], band) => ({
    band: `${low}～${Math.min(high, 1)}`,
    pairs: seededShuffle(pairs.filter(pair => pair.similarity >= low && pair.similarity < high), 20261014 + band)
      .slice(0, PER_BAND),
  }));

  const summary = {
    embeddingModel: EMBEDDING_MODEL,
    textMode: TEXT_MODE,
    tagCount: items.length,
    dimension: vectors[0].length,
    candidatePairs: pairs.length,
    pairsAtOrAbove: distribution,
    tagsWhoseBestNeighborIsAtOrAbove: tagsWithNeighbor,
  };
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'stage2.json'), JSON.stringify({
    generatedAt: new Date().toISOString(), summary, samples,
    neighbors: items.map((item, i) => ({
      tag: item.name, text: item.text,
      neighbors: neighbors[i].map(({ index, similarity }) => ({ tag: items[index].name, similarity: Number(similarity.toFixed(4)) })),
    })),
  }, null, 2));
  const lines = ['# 階段 2：標籤相近表抽查', '', '```json', JSON.stringify(summary, null, 2), '```', ''];
  for (const sample of samples) {
    lines.push(`## 相似度 ${sample.band}`, '', '| 標籤 A | 標籤 B | 相似度 |', '| --- | --- | --- |');
    sample.pairs.forEach(pair => lines.push(`| ${pair.left} | ${pair.right} | ${pair.similarity} |`));
    lines.push('');
  }
  fs.writeFileSync(path.join(outDir, 'stage2.md'), lines.join('\n'));
  console.log(JSON.stringify(summary, null, 2));

  if (TAU !== null) {
    if (!(TAU > 0 && TAU < 1)) throw new Error('--tau 必須介於 0～1');
    const table = {};
    items.forEach((item, i) => {
      const kept = neighbors[i]
        .filter(({ similarity }) => similarity >= TAU)
        .map(({ index, similarity }) => ({ canonicalTagId: items[index].id, similarity: Number(similarity.toFixed(4)) }));
      if (kept.length > 0) table[item.id] = kept;
    });
    const output = {
      schemaVersion: 1,
      vectorModelVersion: TAG_VECTOR_MODEL_VERSION,
      catalogVersion: interestTagCatalog.catalogVersion,
      embeddingModel: EMBEDDING_MODEL,
      textMode: TEXT_MODE,
      tau: TAU,
      topK: TOP_K,
      generatedAt: new Date().toISOString(),
      neighbors: table,
    };
    fs.writeFileSync(neighborsUrl, `${JSON.stringify(output, null, 1)}\n`);
    console.log(`已寫出 src/data/tagVectorNeighbors.json：${Object.keys(table).length} 個標籤有相近標籤`);
  }
}

await main();
