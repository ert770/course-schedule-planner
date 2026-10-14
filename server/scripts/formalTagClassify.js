// 形式標籤候選清單（第二步）：用 LLM 把向量標籤分成「主題」與幾種非主題類型，供人工審核。
// 背景：formalTagCandidates.js 的統計指標（一致性、系所分散度）分不開形式標籤與主題標籤，
// 見 docs/CHANGE_REPORTS/2026-10-14-formal-tag-candidates.md。
//
// **只送標準標籤名稱，不含任何使用者資料**；每個標籤問兩次，兩次不同時標記為「需人工判斷」。
// 結果快取在 `server/simulation-runs/<out>/`（不進版控），重跑只送還沒分類的標籤。
// 對資料庫不讀也不寫。
//
// 用法：node scripts/formalTagClassify.js --out=formal-tag-candidates

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(scriptDir, '..', '.env'), quiet: true });
dotenv.config({ path: path.resolve(scriptDir, '..', '..', '.env'), quiet: true });

const { interestTagCatalog } = await import('../src/data/interestTagCatalog.js');
const { isVectorEligibleTag } = await import('../src/skills/tagVectorSpace.js');

const args = process.argv.slice(2);
const outName = args.find(arg => arg.startsWith('--out='))?.split('=')[1];
if (!outName) { console.error('請指定 --out=<名稱>'); process.exit(1); }
const outDir = path.resolve(scriptDir, '..', 'simulation-runs', outName);
const cacheFile = path.join(outDir, 'classification-votes.json');
const MODEL = process.env.OPENAI_MODEL || 'gpt-5.6-luna';
const BATCH = Number(args.find(arg => arg.startsWith('--batch='))?.split('=')[1] ?? 80);
const CONCURRENCY = 3;
const VOTES = 2;

export const TAG_KINDS = Object.freeze({
  topic: '主題：學科、技術、領域知識或具體內容（例：半導體、資料庫、行政法、機器學習、韓文）',
  format: '形式：教學方式、上課形式、評量或課程活動（例：互動教學、專題報告、小組討論、案例研討、實習）',
  audience: '對象：修課身分、學習階段或程度（例：研究生、博士班、初學者、中級）',
  skill: '通用能力：不屬於特定學科的能力或態度（例：批判性思維、團隊合作、問題解決、溝通能力）',
  generic: '泛用詞：範圍太大、看不出具體主題（例：資訊科技、工程、科學、人文社會科學、專業技能）',
  tool: '工具：具名軟體、平台或教學工具（例：Excel、Notion、Slido、Google Sheets）',
});

const SYSTEM = [
  '你在整理大學課程的主題標籤。每個標籤要判斷它描述的是什麼，只能從下列類型中選一個：',
  ...Object.entries(TAG_KINDS).map(([key, text]) => `- ${key}：${text}`),
  '判斷原則：只要標籤能指出學生會學到的具體內容，就是 topic；「英語」「法律」「設計」這類學科名稱是 topic。',
  '只有在無法從標籤看出學什麼時，才歸為 format、audience、skill 或 generic。',
  '只回傳 JSON：{"labels":[...]}，陣列順序與長度必須和輸入完全相同，每一項是上列的英文代號。',
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
  const labels = match ? JSON.parse(match[0]).labels : null;
  const valid = Array.isArray(labels) && labels.length === names.length && labels.every(item => Object.hasOwn(TAG_KINDS, item));
  return valid ? labels : null;
}

async function main() {
  // --reviewed=<檔案>：已審核過的標籤（readDecisions 輸出的 JSON，含 id）不再列入，只分類與輸出其餘的。
  const reviewedFile = args.find(arg => arg.startsWith('--reviewed='))?.split('=')[1];
  const reviewed = new Set(reviewedFile ? JSON.parse(fs.readFileSync(path.resolve(reviewedFile), 'utf8')).map(row => row.id) : []);
  const tags = interestTagCatalog.canonicalTags.filter(tag => isVectorEligibleTag(tag) && !reviewed.has(tag.id));
  if (reviewed.size) console.log(`排除已審核 ${reviewed.size} 個，剩 ${tags.length} 個向量標籤待分類`);
  const cache = fs.existsSync(cacheFile) ? JSON.parse(fs.readFileSync(cacheFile, 'utf8')) : {};
  fs.mkdirSync(outDir, { recursive: true });
  for (let vote = 0; vote < VOTES; vote += 1) {
    const pending = tags.filter(tag => (cache[tag.id]?.length ?? 0) <= vote);
    console.log(`第 ${vote + 1} 輪：需分類 ${pending.length} 個`);
    const batches = [];
    for (let start = 0; start < pending.length; start += BATCH) batches.push(pending.slice(start, start + BATCH));
    let done = 0;
    // 同時送 CONCURRENCY 批；每批完成就寫入快取，中斷後重跑會從快取接續。
    for (let group = 0; group < batches.length; group += CONCURRENCY) {
      await Promise.all(batches.slice(group, group + CONCURRENCY).map(async batch => {
        let labels = null;
        for (let attempt = 0; attempt < 3 && !labels; attempt += 1) {
          labels = await ask(batch.map(tag => tag.name)).catch(() => null);
        }
        if (!labels) { console.log(`  「${batch[0].name}」起的一批連續三次失敗，略過`); return; }
        batch.forEach((tag, i) => { cache[tag.id] = [...(cache[tag.id] ?? []), labels[i]]; });
        fs.writeFileSync(cacheFile, JSON.stringify(cache));
        done += batch.length;
        console.log(`  已完成 ${done} / ${pending.length}`);
      }));
    }
  }
  const counts = {};
  let disagreements = 0;
  for (const tag of tags) {
    const votes = cache[tag.id] ?? [];
    const key = votes.length === VOTES && votes.every(item => item === votes[0]) ? votes[0] : 'disagree';
    if (key === 'disagree') disagreements += 1;
    counts[key] = (counts[key] ?? 0) + 1;
  }
  console.log(JSON.stringify({ model: MODEL, tags: tags.length, counts, disagreements }, null, 2));
  writeReviewPayload(tags, cache, { model: MODEL, counts, disagreements });
}

// 審核用活頁簿的內容（Python 的 writeReviewWorkbook.py 只負責寫檔）。
// 合併 formalTagCandidates.js 的統計指標；沒有統計的是出現少於 3 門課的標籤。
function writeReviewPayload(tags, cache, meta) {
  const statsFile = path.join(outDir, 'candidates.json');
  const stats = fs.existsSync(statsFile)
    ? new Map(JSON.parse(fs.readFileSync(statsFile, 'utf8')).allScored.map(row => [row.canonicalTagId, row]))
    : new Map();
  const kindLabel = { topic: '主題', format: '形式', audience: '對象', skill: '通用能力', generic: '泛用詞', tool: '工具' };
  const suggestion = { format: '降權', audience: '降權', skill: '降權', generic: '降權', tool: '保留', topic: '保留' };
  const columns = ['標籤', '分類（兩次）', '建議', '你的決定', '出現課數', '系所數', '一致性', '主分類', '範例課程', '標籤 ID'];
  const rowOf = tag => {
    const votes = cache[tag.id] ?? [];
    const agreed = votes.length === VOTES && votes.every(item => item === votes[0]);
    const stat = stats.get(tag.id);
    return {
      kind: agreed ? votes[0] : 'disagree',
      cells: [
        tag.name,
        votes.map(item => kindLabel[item] ?? item).join(' / '),
        agreed ? suggestion[votes[0]] : '需人工判斷',
        '',
        stat?.courses ?? '<3',
        stat?.departments ?? '',
        stat?.coherence ?? '',
        stat?.mainCategories ?? '',
        (stat?.examples ?? []).join('；'),
        tag.id,
      ],
      courses: stat?.courses ?? 0,
    };
  };
  const rows = tags.map(rowOf).sort((a, b) => b.courses - a.courses || String(a.cells[0]).localeCompare(String(b.cells[0]), 'zh-Hant'));
  const sheet = (name, filter) => ({ name, columns, rows: rows.filter(filter).map(row => row.cells) });
  const payload = {
    output: path.resolve(scriptDir, '..', '..', 'docs', 'CHANGE_REPORTS', args.find(arg => arg.startsWith('--xlsx='))?.split('=')[1] ?? '2026-10-14-formal-tag-candidates.xlsx'),
    decisionColumn: 4,
    decisionOptions: ['降權', '保留'],
    widths: [18, 16, 10, 10, 9, 8, 9, 22, 70, 26],
    sheets: [
      {
        name: '說明',
        columns: ['項目', '內容'],
        rows: [
          ['目的', '找出描述上課形式、修課對象、通用能力或泛用詞的標籤；你核准「降權」的標籤，只在標籤空間向量中降低權重（例如乘 0.3），標籤興趣檔 s_tag 不受影響。'],
          ['分類方式', `由 ${meta.model} 依標籤名稱分類，每個標籤問兩次；兩次不同的列在「需人工判斷」。只送標籤名稱，不含使用者資料。`],
          ['類型', Object.entries(TAG_KINDS).map(([, text]) => text).join('\n')],
          ['建議', '形式、對象、通用能力、泛用詞 → 降權；主題、工具 → 保留。工具（Excel、Notion）有時代表課程內容，預設保留。'],
          ['你的決定', '請在「你的決定」欄選「降權」或「保留」；空白表示同意「建議」欄。'],
          ['統計欄位', '出現課數、系所數以當學期課程計；一致性 = 帶有此標籤的課拿掉此標籤後兩兩的平均餘弦相似度，越低代表這些課彼此越不相關。只當參考：它分不開形式標籤與主題標籤。'],
          ['分類統計', Object.entries(meta.counts).map(([key, value]) => `${kindLabel[key] ?? '需人工判斷'} ${value}`).join('、')],
        ],
      },
      sheet('建議降權', row => ['format', 'audience', 'skill', 'generic'].includes(row.kind)),
      sheet('需人工判斷', row => row.kind === 'disagree'),
      sheet('工具（建議保留）', row => row.kind === 'tool'),
      sheet('主題（抽查用）', row => row.kind === 'topic'),
    ],
  };
  fs.writeFileSync(path.join(outDir, 'review-payload.json'), JSON.stringify(payload, null, 2));
  console.log(`審核表內容已寫出：${path.join(outDir, 'review-payload.json')}`);
}

await main();
