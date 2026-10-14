// 同義詞合併候選清單：找出應該併成同一個標準標籤的標籤，供人工審核後寫入 interestTagAliases.json，
// 再依既有流程重建 interestTagCatalog.json（與 2026-10-08 的 13 組語意別名同一套機制）。
//
// 1. 全部標準標籤（含只出現在一門課的）以 text-embedding-3-large 計算名稱向量，
//    與 tagEmbeddingStage2.js 共用快取（server/simulation-runs/tag-embeddings/，不進版控）。
// 2. 候選配對 = 名稱相似度 ≥ MIN_SIMILARITY 的前 TOP_K 名，加上字面規則
//    （英語／英文、智能／智慧、網絡／網路、軟件／軟體、信息／資訊、變換／轉換、器械／器材、
//    「批判性思維／批判思維」、空白與標點差異）。
// 3. 每組配對問 LLM 兩次：「兩者是否為可互換的同義詞（不是上下位或只是相關）」。
//    兩票都同意才列為「建議合併」，一票同意列為「需人工判斷」。
// 4. 以聯集合併成群組；群組內出現課數最多的標籤當標準標籤（同數時取已是別名目標或較短的名稱）。
//
// **只送標籤名稱，不含任何使用者資料。** 對資料庫不讀也不寫。結果與 LLM 投票快取在
// `server/simulation-runs/<out>/`；審核用活頁簿由 scripts/lib/writeReviewWorkbook.py 寫出。
//
// 用法：node scripts/tagSynonymCandidates.js --out=tag-synonym-candidates

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(scriptDir, '..', '.env'), quiet: true });
dotenv.config({ path: path.resolve(scriptDir, '..', '..', '.env'), quiet: true });

const { interestTagCatalog, interestTagAliases } = await import('../src/data/interestTagCatalog.js');
const { isVectorEligibleTag } = await import('../src/skills/tagVectorSpace.js');
const downweighted = new Set(Object.keys(JSON.parse(
  fs.readFileSync(new URL('../src/data/tagVectorDownweights.json', import.meta.url), 'utf8'),
).tags));

const args = process.argv.slice(2);
const argValue = name => args.find(arg => arg.startsWith(`--${name}=`))?.split('=')[1];
const outName = argValue('out');
if (!outName) { console.error('請指定 --out=<名稱>'); process.exit(1); }
const outDir = path.resolve(scriptDir, '..', 'simulation-runs', outName);
const cacheDir = path.resolve(scriptDir, '..', 'simulation-runs', 'tag-embeddings');
const EMBEDDING_MODEL = 'text-embedding-3-large';
const CHAT_MODEL = process.env.OPENAI_MODEL || 'gpt-5.6-luna';
const MIN_SIMILARITY = Number(argValue('min-similarity') ?? 0.8);
const TOP_K = 10;
const EMBED_BATCH = 256;
const PAIR_BATCH = Number(argValue('batch') ?? 40);
const CONCURRENCY = Number(argValue('concurrency') ?? 3);
const VOTES = 2;

// 字面規則：兩個名稱經這些替換後相同，就列為候選（仍要經 LLM 確認）。
const SURFACE_RULES = [
  [/英語/gu, '英文'], [/智能/gu, '智慧'], [/網絡/gu, '網路'], [/軟件/gu, '軟體'], [/信息/gu, '資訊'],
  [/數據/gu, '資料'], [/變換/gu, '轉換'], [/器械/gu, '器材'], [/性(思維|思考)/gu, '$1'], [/[\s\-_.·・/]/gu, ''],
];
const surfaceKey = name => SURFACE_RULES.reduce(
  (text, [pattern, replacement]) => text.replace(pattern, replacement),
  String(name).normalize('NFKC').toLocaleLowerCase('zh-Hant'),
);

const hash = text => crypto.createHash('sha256').update(text).digest('hex').slice(0, 16);
let client = null;
async function openai() {
  if (!client) {
    if (!process.env.OPENAI_API_KEY) throw new Error('未設定 OPENAI_API_KEY。');
    const { default: OpenAI } = await import('openai');
    client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return client;
}

async function embedNames(names) {
  const file = path.join(cacheDir, `${EMBEDDING_MODEL}.json`);
  const cache = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
  const missing = names.filter(name => !cache[hash(name)]);
  console.log(`名稱 ${names.length} 個，快取已有 ${names.length - missing.length} 個，需送出 ${missing.length} 個`);
  let tokens = 0;
  for (let start = 0; start < missing.length; start += EMBED_BATCH) {
    const batch = missing.slice(start, start + EMBED_BATCH);
    const response = await (await openai()).embeddings.create({ model: EMBEDDING_MODEL, input: batch });
    tokens += response.usage?.total_tokens ?? 0;
    response.data.forEach((row, offset) => { cache[hash(batch[offset])] = row.embedding; });
    fs.mkdirSync(cacheDir, { recursive: true });
    fs.writeFileSync(file, JSON.stringify(cache));
  }
  if (missing.length) console.log(`embedding 用量：${tokens} tokens`);
  return names.map(name => {
    const vector = Float32Array.from(cache[hash(name)]);
    let norm = 0;
    for (const value of vector) norm += value * value;
    norm = Math.sqrt(norm);
    for (let i = 0; i < vector.length; i += 1) vector[i] /= norm;
    return vector;
  });
}

function similarPairs(vectors) {
  const count = vectors.length;
  const dimension = vectors[0].length;
  const best = Array.from({ length: count }, () => []);
  for (let i = 0; i < count; i += 1) {
    const left = vectors[i];
    for (let j = i + 1; j < count; j += 1) {
      const right = vectors[j];
      let dot = 0;
      for (let d = 0; d < dimension; d += 1) dot += left[d] * right[d];
      if (dot < MIN_SIMILARITY) continue;
      for (const [a, b] of [[i, j], [j, i]]) {
        const list = best[a];
        if (list.length < TOP_K || dot > list[list.length - 1].similarity) {
          list.push({ index: b, similarity: dot });
          list.sort((x, y) => y.similarity - x.similarity);
          if (list.length > TOP_K) list.pop();
        }
      }
    }
  }
  return best;
}

const SYSTEM = [
  '你在整理大學課程的主題標籤，要判斷兩個標籤能不能合併成同一個標籤。',
  '只有在兩者指的是同一件事、在課程描述裡可以互相替換時才回答 yes，例如：',
  '人工智慧／人工智能、批判思維／批判性思維、商業英文／商業英語、傅立葉變換／傅立葉轉換、資訊安全／資安、Machine Learning／機器學習。',
  '以下都要回答 no：上下位關係（資料庫／資料庫設計、財務／財務管理）、只是相關（機器學習／深度學習、網站設計／網路設計）、',
  '程度或對象不同（中級英語／中高級英語）、範圍不同（電機工程／機電工程）。',
  '只回傳 JSON：{"answers":[...]}，陣列順序與長度必須和輸入完全相同，每一項是 "yes" 或 "no"。',
].join('\n');

async function askPairs(pairs) {
  const input = pairs.map((pair, i) => `${i + 1}. ${pair.left}／${pair.right}`).join('\n');
  const response = await (await openai()).responses.create({
    model: CHAT_MODEL, instructions: SYSTEM, input: [{ role: 'user', content: `共 ${pairs.length} 組：\n${input}` }],
  }, { timeout: 180000 });
  const match = String(response.output_text ?? '').match(/\{[\s\S]*\}/);
  const answers = match ? JSON.parse(match[0]).answers : null;
  return Array.isArray(answers) && answers.length === pairs.length && answers.every(item => item === 'yes' || item === 'no')
    ? answers
    : null;
}

async function votePairs(pairs) {
  const file = path.join(outDir, 'synonym-votes.json');
  const cache = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
  for (let vote = 0; vote < VOTES; vote += 1) {
    const pending = pairs.filter(pair => (cache[pair.key]?.length ?? 0) <= vote);
    console.log(`第 ${vote + 1} 輪：需判斷 ${pending.length} 組`);
    const batches = [];
    for (let start = 0; start < pending.length; start += PAIR_BATCH) batches.push(pending.slice(start, start + PAIR_BATCH));
    let done = 0;
    for (let group = 0; group < batches.length; group += CONCURRENCY) {
      await Promise.all(batches.slice(group, group + CONCURRENCY).map(async batch => {
        let answers = null;
        for (let attempt = 0; attempt < 3 && !answers; attempt += 1) answers = await askPairs(batch).catch(() => null);
        if (!answers) { console.log(`  「${batch[0].left}／${batch[0].right}」起的一批連續三次失敗，略過`); return; }
        batch.forEach((pair, i) => { cache[pair.key] = [...(cache[pair.key] ?? []), answers[i]]; });
        fs.writeFileSync(file, JSON.stringify(cache));
        done += batch.length;
        if (done % 400 < PAIR_BATCH) console.log(`  已完成 ${done} / ${pending.length}`);
      }));
    }
  }
  return cache;
}

function clusters(tags, accepted) {
  const parent = new Map(tags.map(tag => [tag.id, tag.id]));
  const find = id => (parent.get(id) === id ? id : (parent.set(id, find(parent.get(id))), parent.get(id)));
  for (const pair of accepted) parent.set(find(pair.leftId), find(pair.rightId));
  const groups = new Map();
  for (const pair of accepted) {
    for (const id of [pair.leftId, pair.rightId]) {
      const root = find(id);
      if (!groups.has(root)) groups.set(root, new Set());
      groups.get(root).add(id);
    }
  }
  return [...groups.values()].map(set => [...set]);
}

async function main() {
  fs.mkdirSync(outDir, { recursive: true });
  const tags = interestTagCatalog.canonicalTags;
  const byId = new Map(tags.map(tag => [tag.id, tag]));
  const aliasTargets = new Set(Object.values(interestTagAliases.aliases ?? {}));
  const vectors = await embedNames(tags.map(tag => tag.name));
  console.log('計算名稱相似度…');
  const neighbors = similarPairs(vectors);

  const pairMap = new Map();
  const addPair = (a, b, similarity, source) => {
    const [left, right] = a.id < b.id ? [a, b] : [b, a];
    const key = `${left.id}|${right.id}`;
    const existing = pairMap.get(key);
    if (existing) { existing.sources.add(source); return; }
    pairMap.set(key, { key, leftId: left.id, rightId: right.id, left: left.name, right: right.name, similarity, sources: new Set([source]) });
  };
  neighbors.forEach((list, i) => list.forEach(({ index, similarity }) => addPair(tags[i], tags[index], similarity, 'embedding')));
  const bySurface = new Map();
  for (const tag of tags) {
    const key = surfaceKey(tag.name);
    if (!bySurface.has(key)) bySurface.set(key, []);
    bySurface.get(key).push(tag);
  }
  const indexOf = new Map(tags.map((tag, i) => [tag.id, i]));
  for (const group of bySurface.values()) {
    for (let i = 0; i < group.length; i += 1) {
      for (let j = i + 1; j < group.length; j += 1) {
        const a = vectors[indexOf.get(group[i].id)];
        const b = vectors[indexOf.get(group[j].id)];
        let dot = 0;
        for (let d = 0; d < a.length; d += 1) dot += a[d] * b[d];
        addPair(group[i], group[j], dot, 'surface');
      }
    }
  }
  const pairs = [...pairMap.values()].sort((a, b) => b.similarity - a.similarity);
  console.log(`候選配對 ${pairs.length} 組（名稱相似 ${pairs.filter(p => p.sources.has('embedding')).length}、字面規則 ${pairs.filter(p => p.sources.has('surface')).length}）`);

  const votes = await votePairs(pairs);
  const yesCount = pair => (votes[pair.key] ?? []).filter(item => item === 'yes').length;
  const complete = pair => (votes[pair.key]?.length ?? 0) >= VOTES;
  const accepted = pairs.filter(pair => complete(pair) && yesCount(pair) === VOTES);
  const uncertain = pairs.filter(pair => complete(pair) && yesCount(pair) > 0 && yesCount(pair) < VOTES);
  const incomplete = pairs.filter(pair => !complete(pair));

  const courseCount = id => byId.get(id)?.eligibility?.courseCount ?? 0;
  const groups = clusters(tags, accepted).map(ids => {
    const sorted = [...ids].sort((a, b) => (
      courseCount(b) - courseCount(a)
      || Number(aliasTargets.has(byId.get(b).name)) - Number(aliasTargets.has(byId.get(a).name))
      || byId.get(a).name.length - byId.get(b).name.length
      || byId.get(a).name.localeCompare(byId.get(b).name, 'zh-Hant')
    ));
    return { canonical: sorted[0], members: sorted.slice(1) };
  }).sort((a, b) => courseCount(b.canonical) - courseCount(a.canonical));

  const summary = {
    embeddingModel: EMBEDDING_MODEL, chatModel: CHAT_MODEL, minSimilarity: MIN_SIMILARITY,
    tags: tags.length, candidatePairs: pairs.length, accepted: accepted.length,
    uncertain: uncertain.length, incomplete: incomplete.length,
    groups: groups.length, mergedAway: groups.reduce((sum, group) => sum + group.members.length, 0),
    largestGroup: Math.max(0, ...groups.map(group => group.members.length + 1)),
  };
  console.log(JSON.stringify(summary, null, 2));
  fs.writeFileSync(path.join(outDir, 'synonyms.json'), JSON.stringify({
    generatedAt: new Date().toISOString(), summary,
    groups: groups.map(group => ({
      canonical: { id: group.canonical, name: byId.get(group.canonical).name, courses: courseCount(group.canonical) },
      members: group.members.map(id => ({ id, name: byId.get(id).name, courses: courseCount(id) })),
    })),
    uncertain: uncertain.map(pair => ({ ...pair, sources: [...pair.sources], votes: votes[pair.key] })),
  }, null, 2));

  // 審核表：每列一個「別名 → 標準標籤」。
  const pairSimilarity = new Map(pairs.map(pair => [pair.key, pair.similarity]));
  const simOf = (a, b) => pairSimilarity.get(a < b ? `${a}|${b}` : `${b}|${a}`);
  // 向量降權名單的狀態：合併後標準標籤沿用自己的狀態，兩邊不同時要人工確認。
  // 只出現在一門課的標籤不是向量標籤，沒有經過降權審核，不算衝突。
  const status = id => (!isVectorEligibleTag(byId.get(id)) ? '非向量標籤' : downweighted.has(id) ? '降權' : '保留');
  const statusCell = (alias, canonical) => {
    const [a, c] = [status(alias), status(canonical)];
    if (a === c || a === '非向量標籤' || c === '非向量標籤') return `別名${a}／標準${c}`;
    return `衝突：別名${a}／標準${c}`;
  };
  const mergeRows = groups.flatMap(group => group.members.map(id => [
    byId.get(id).name, byId.get(group.canonical).name, '合併', '',
    courseCount(id), courseCount(group.canonical), group.members.length + 1,
    simOf(id, group.canonical) === undefined ? '（經群組內其他標籤連結）' : Number(simOf(id, group.canonical).toFixed(3)),
    group.members.map(m => byId.get(m).name).join('、'), statusCell(id, group.canonical), id, group.canonical,
  ]));
  const uncertainRows = uncertain.map(pair => {
    const [alias, canonical] = courseCount(pair.leftId) <= courseCount(pair.rightId) ? [pair.leftId, pair.rightId] : [pair.rightId, pair.leftId];
    return [
      byId.get(alias).name, byId.get(canonical).name, '需人工判斷', '',
      courseCount(alias), courseCount(canonical), 2, Number(pair.similarity.toFixed(3)), '', statusCell(alias, canonical), alias, canonical,
    ];
  });
  const columns = ['別名（併入）', '標準標籤（保留）', '建議', '你的決定', '別名課數', '標準標籤課數', '群組大小', '名稱相似度', '同群組的其他別名', '向量降權狀態', '別名 ID', '標準標籤 ID'];
  const payload = {
    output: path.resolve(scriptDir, '..', '..', 'docs', 'CHANGE_REPORTS', '2026-10-14-tag-synonym-candidates.xlsx'),
    decisionColumn: 4,
    decisionOptions: ['合併', '不合併'],
    widths: [20, 20, 10, 10, 9, 11, 9, 11, 40, 22, 26, 26],
    sheets: [
      {
        name: '說明',
        columns: ['項目', '內容'],
        rows: [
          ['目的', '找出應該併成同一個標準標籤的標籤。核准的配對會寫入 server/src/data/interestTagAliases.json（別名 → 標準標籤），再依既有流程重建 interestTagCatalog.json，標籤興趣檔 s_tag 與標籤向量 s_vec 都會用合併後的標籤。'],
          ['候選來源', `所有 ${tags.length} 個標準標籤（含只出現在一門課的）以 ${EMBEDDING_MODEL} 計算名稱相似度，取相似度 ≥ ${MIN_SIMILARITY} 的前 ${TOP_K} 名；另加字面規則（英語／英文、智能／智慧、網絡／網路、軟件／軟體、信息／資訊、變換／轉換、器械／器材、批判性思維／批判思維、空白與標點）。`],
          ['判斷方式', `每組問 ${CHAT_MODEL} 兩次「是否為可互換的同義詞」。上下位（資料庫／資料庫設計）、只是相關（機器學習／深度學習）、程度不同（中級英語／中高級英語）都算不同義。兩次都同意列在「建議合併」；只有一次同意列在「需人工判斷」。只送標籤名稱，不含使用者資料。`],
          ['標準標籤怎麼選', '群組內出現課數最多的標籤；同數時優先選已是別名目標的標籤，再選較短的名稱。若你想換成別的名稱，直接改「標準標籤（保留）」欄。'],
          ['你的決定', '選「合併」或「不合併」；空白表示同意「建議」欄。「需人工判斷」頁請逐列決定。'],
          ['課數', '目前目錄中的出現課數（合併前）。合併後要依課程重新計算，不能直接相加。'],
          ['向量降權狀態', '依 2026-10-14 審核的降權名單（tagVectorDownweights.json）。兩邊都審核過且結果不同時標「衝突」，合併後要決定標準標籤用哪一種；不處理的話沿用標準標籤自己的狀態。只出現在一門課的標籤不是向量標籤、沒有審核過，標為「非向量標籤」。'],
          ['統計', `候選配對 ${pairs.length} 組；建議合併 ${accepted.length} 組，組成 ${groups.length} 個群組、${summary.mergedAway} 個別名；需人工判斷 ${uncertain.length} 組；未完成判斷 ${incomplete.length} 組。`],
        ],
      },
      { name: '建議合併', columns, rows: mergeRows },
      { name: '需人工判斷', columns, rows: uncertainRows },
    ],
  };
  fs.writeFileSync(path.join(outDir, 'review-payload.json'), JSON.stringify(payload, null, 2));
  console.log(`審核表內容已寫出：${path.join(outDir, 'review-payload.json')}`);
}

await main();
