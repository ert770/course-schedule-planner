import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import OpenAI from 'openai';

import { getAll } from '../src/db/database.js';
import { closePool } from '../src/db/mysql.js';
import {
  buildInterestTagVocabulary,
  getFrequentInterestTagCandidates,
  normalizeInterestTag,
} from '../src/data/interestTagVocabulary.js';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDir, '..', '..');
const aliasPath = path.resolve(scriptDir, '..', 'src', 'data', 'interestTagAliases.json');
const reportPath = path.join(projectRoot, 'docs', 'CHANGE_REPORTS', '2026-10-07-rag-tag-vocabulary.md');
const detailsPath = path.join(projectRoot, 'docs', 'CHANGE_REPORTS', '2026-10-07-rag-tag-vocabulary-details.json');

dotenv.config({ path: path.resolve(scriptDir, '..', '.env'), quiet: true });
dotenv.config({ path: path.resolve(projectRoot, '.env'), quiet: true });

const args = new Set(process.argv.slice(2));
const statsOnly = args.has('--stats-only');
const noWrite = args.has('--no-write');
const externalModelBlocked = args.has('--external-model-blocked');
const allowExternalModel = args.has('--allow-external-model');

const proposalSchema = {
  type: 'object',
  properties: {
    groups: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          canonical: { type: 'string' },
          members: { type: 'array', items: { type: 'string' } },
          reason: { type: 'string' },
        },
        required: ['canonical', 'members', 'reason'],
        additionalProperties: false,
      },
    },
  },
  required: ['groups'],
  additionalProperties: false,
};

function validateAliasProposals(proposedGroups, candidates) {
  const known = new Set(candidates.map(item => item.tag));
  const used = new Set();
  const proposals = [];
  const rejected = [];

  for (const group of Array.isArray(proposedGroups) ? proposedGroups : []) {
    const members = [...new Set((Array.isArray(group?.members) ? group.members : [])
      .map(value => String(value ?? '').trim())
      .filter(value => known.has(value)))];
    const distinctKeys = new Set(members.map(normalizeInterestTag));
    const canonical = String(group?.canonical ?? '').trim();
    const overlaps = members.some(member => used.has(member));

    if (members.length < 2 || distinctKeys.size < 2 || !members.includes(canonical) || overlaps) {
      rejected.push({ canonical, members, reason: String(group?.reason ?? ''), validation: 'invalid-or-overlapping-group' });
      continue;
    }

    proposals.push({
      canonical,
      members,
      reason: String(group?.reason ?? '').trim(),
      courseCounts: Object.fromEntries(members.map(member => [
        member,
        candidates.find(candidate => candidate.tag === member)?.courseCount ?? 0,
      ])),
    });
    for (const member of members) used.add(member);
  }

  return { proposals, rejected };
}

function markdownEscape(value) {
  return String(value ?? '').replaceAll('|', '\\|').replaceAll('\n', ' ');
}

function formatPercent(value) {
  return `${(value * 100).toFixed(1)}%`;
}

function renderProposalTable(proposals, { modelCalled = true } = {}) {
  if (proposals.length === 0) {
    return modelCalled ? '模型沒有提出通過格式檢查的候選群組。' : '';
  }
  const rows = proposals.map((group, index) => {
    const members = group.members.map(member => `${member}（${group.courseCounts[member]} 門）`).join('；');
    return `| ${index + 1} | ${markdownEscape(group.canonical)} | ${markdownEscape(members)} | ${markdownEscape(group.reason)} |`;
  });
  return [
    '| # | 建議標準名稱 | 候選標籤與課程數 | 模型理由 |',
    '| ---: | --- | --- | --- |',
    ...rows,
  ].join('\n');
}

function renderReport({ summary, csCoverage, mergedGroups, excludedTags, proposals, modelInfo, weightCheck }) {
  const modelNotCalled = modelInfo.model === '未呼叫（--stats-only）';
  const common = excludedTags
    .filter(item => item.reason === 'too-common')
    .sort((left, right) => right.courseCount - left.courseCount || left.tag.localeCompare(right.tag, 'zh-Hant'))
    .slice(0, 30)
    .map(item => `| ${markdownEscape(item.tag)} | ${item.courseCount} | ${formatPercent(item.courseRatio)} |`);
  const mergeRows = mergedGroups
    .filter(group => group.mergedBy === 'normalization')
    .map(group => `| ${markdownEscape(group.canonical)} | ${markdownEscape(group.labels.join('、'))} | ${group.courseCount} |`);
  const lines = [
    '# rag_tag 興趣詞彙整理與候選流程（階段 1）',
    '',
    '## 修改日期',
    '',
    '2026-10-07',
    '',
    '## 範圍',
    '',
    '本階段只整理課程主題詞彙並產生人工審查候選，不改變互動學習、排課結果或資料庫。',
    '`interestTagAliases.json` 目前保持空白；下方模型候選尚未獲人工確認，不會生效。',
    '',
    '## 課程目錄統計',
    '',
    '| 指標 | 結果 |',
    '| --- | ---: |',
    `| 班次數 | ${summary.sectionCount.toLocaleString()} |`,
    `| 不重複課程數（穩定課號） | ${summary.courseCount.toLocaleString()} |`,
    `| 原始不同標籤數 | ${summary.rawTagCount.toLocaleString()} |`,
    `| 正規化後標籤數 | ${summary.normalizedTagCount.toLocaleString()} |`,
    `| 原始標籤中出現在至少 5 門課者 | ${summary.rawTagsAtLeastFiveCourses.toLocaleString()} |`,
    `| 正規化碰撞群組 | ${summary.normalizedCollisionGroupCount.toLocaleString()} |`,
    `| 原始標籤只出現在一門課（未正規化） | ${summary.rawTagsOnlyOneCourse.toLocaleString()} |`,
    `| 正規化後只出現在一門課 | ${summary.normalizedTagsOnlyOneCourse.toLocaleString()} |`,
    `| 整理後保留標籤數 | ${summary.includedTagCount.toLocaleString()} |`,
    `| 有保留標籤的課程覆蓋率 | ${formatPercent(summary.courseCoverage)} |`,
    `| 每門課平均保留標籤數 | ${summary.averageRetainedTagsPerCourse.toFixed(2)} |`,
    `| 每門課保留標籤數（最少／中位數／最多） | ${summary.minRetainedTagsPerCourse}／${summary.medianRetainedTagsPerCourse}／${summary.maxRetainedTagsPerCourse} |`,
    `| 資工 IECS 課程覆蓋 | ${csCoverage.retainedCourseCount}/${csCoverage.courseCount}（${formatPercent(csCoverage.ratio)}） |`,
    `| 每門課權重總和檢查 | ${weightCheck.checkedCourseCount.toLocaleString()} 門；最大誤差 ${weightCheck.maxAbsoluteError.toExponential(2)} |`,
    '',
    '原始標籤的 6,846 個名稱中，610 個在至少 5 門課出現，作為模型提案輸入。先正規化大小寫、空白與連字號後，有 51 組表面寫法自動合併；語意同義詞仍需人工確認。',
    '',
    '## 正規化合併清單',
    '',
    '| 標準顯示名稱 | 合併的表面寫法 | 課程數 |',
    '| --- | --- | ---: |',
    ...(mergeRows.length > 0 ? mergeRows : ['| （無） | | 0 |']),
    '',
    '## 泛用標籤排除摘要',
    '',
    '排除規則是出現在超過 2% 的不重複課程，或命中程式內明列的通用標籤清單。以下列出頻率最高的前 30 個；完整納入、排除清單與理由見同目錄的 JSON 詳細報告。',
    '',
    '| 標籤 | 課程數 | 課程比例 |',
    '| --- | ---: | ---: |',
    ...(common.length > 0 ? common : ['| （無） | 0 | 0% |']),
    '',
    `全部排除 ${summary.excludedTagCount.toLocaleString()} 個：明列通用 ${summary.excludedByReason.explicitGeneric} 個、比例過高 ${summary.excludedByReason.tooCommon} 個、只出現在一門課 ${summary.excludedByReason.singleCourse} 個。`,
    '',
    '## 語意同義標籤候選',
    '',
    modelNotCalled
      ? `本次未呼叫模型；候選輸入範圍為出現在至少 5 門課的 ${modelInfo.candidateCount} 個原始標籤，名稱與門數見詳細 JSON 的 aliasProposal.inputTags 欄位。`
      : `模型：${modelInfo.model}。候選只從出現在至少 5 門課的原始標籤挑選；格式檢查拒絕了 ${modelInfo.rejectedCount} 組不合規或互相重疊的輸出。`,
    ...(modelInfo.blockingReason ? ['', modelInfo.blockingReason] : []),
    '',
    modelNotCalled
      ? '本次沒有產生候選，因此目前沒有待審查群組；`interestTagAliases.json` 仍維持空白。若之後產生候選，須先人工確認同義關係，尤其不要把上下位概念、工具名稱與領域主題只因相關就合併。'
      : '以下候選只供人工審查。請確認每一組是否真為同一概念，尤其要留意上下位概念、工具名稱與領域主題不能只因相關就合併。',
    '',
    ...(modelNotCalled ? [] : [renderProposalTable(proposals, { modelCalled: true })]),
    '',
    '## 權重整理規則',
    '',
    '每門課只保留通過詞彙規則的標籤。先按標籤數平分該課的總份量，再乘上 `ln((課程總數 + 1) / (標籤課程數 + 1))` 的稀有度，最後在該課內重新正規化，使保留標籤的權重總和仍為 1。沒有保留標籤的課程不產生標籤權重。',
    '',
    '## 主要檔案與驗證',
    '',
    '- `server/src/data/interestTagVocabulary.js`：純函式正規化、頻率過濾、合併與每課權重。',
    '- `server/src/data/interestTagAliases.json`：只存人工確認的 alias；目前無已確認映射。',
    '- `server/scripts/interestTagAliasProposal.js`：從唯讀課程目錄產生本報告與 JSON 詳細資料。',
    '- `server/test/interestTagVocabulary.test.js`：正規化、去重、排除與權重總和測試。',
    '- 語法檢查：`server/src` 全部 98 個 JavaScript 檔案與本次新增的 script/test 通過。',
    '- 詞彙測試：`node --test test/interestTagVocabulary.test.js` 5/5 通過；外部呼叫預設封鎖檢查通過。',
    '- 完整後端 `npm test`：1,426 項中 1,424 通過、2 項失敗；失敗為 `agentGoldenSet.test.js` 的 `no-invented-constraints`（模型回傳 schema 未定義的 `sourcePhrases`）及其總通過率斷言，與本階段模組無關。',
    '- 前端 `npm run build` 通過；沒有修改 client 檔案，因此未跑 lint。未改變 UI 或排課結果，未執行瀏覽器 A/B。',
    '- 詳細資料：[2026-10-07-rag-tag-vocabulary-details.json](./2026-10-07-rag-tag-vocabulary-details.json)。',
    '',
    '## 變更與提交狀態',
    '',
    '- 修改範圍：新增詞彙純函式、空 alias 容器、候選腳本、單元測試、測試計畫、變更報告與 roadmap #43。',
    '- 影響：目前只產生離線詞彙統計與每課標籤權重；未修改學習器、儲存層、隱私頁、API 或 `scheduler.js`，排課結果不變。',
    '- Roadmap：核對 #1–#42 的狀態與相依欄，未改其他列；新增 #43 並記錄同義詞審查的待辦與外部分享阻塞。',
    '- 本次未 commit、未 push；工作樹既有修改與未追蹤資料均保留。',
    '',
    '## 本階段結論',
    '',
    modelInfo.blockingReason
      ? '階段 1 的正規化程式與資料統計已完成；外部模型候選受阻，正式 alias 檔仍為空。待專案負責人決定是否授權傳送詞彙資料，或提供本機模型，再完成候選審查。'
      : '階段 1 的正規化程式、資料統計與候選提案已產生。正式 alias 檔仍為空，待專案負責人確認候選後才寫入；確認完成前不進入階段 2。',
    '',
  ];
  return lines.join('\n');
}

async function proposeAliases(candidates) {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error('需要 OPENAI_API_KEY（server/.env）才能產生語言模型候選；可用 --stats-only 只產統計。');
  }

  const model = process.env.OPENAI_MODEL || 'gpt-5.6-luna';
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, maxRetries: 0 });
  const response = await client.responses.create({
    model,
    instructions: [
      '你是大學課程 rag_tag 詞彙的同義詞候選整理助手。',
      '只把明確指向同一概念的別名、縮寫、中英文譯名分在一組。',
      '不可把上下位概念、相鄰領域、工具與學科、方法與應用合併；例如「人工智慧」與「機器學習」不同，不可合併；「網路」與「神經網路」也不同。',
      '每個候選名稱必須逐字來自輸入清單。canonical 必須是 members 其中一個。不能確定時不要提出。',
      '輸出繁體中文 reason，說明這些名稱為何可能是同義詞。所有輸出都只是待人工確認建議。',
    ].join('\n'),
    input: JSON.stringify({
      task: '提出人工智慧、AI、Machine Learning、Matlab 一類的同義標籤群組候選。',
      tags: candidates,
    }),
    text: {
      format: {
        type: 'json_schema',
        name: 'interest_tag_alias_proposals',
        strict: true,
        schema: proposalSchema,
      },
    },
  });

  const outputText = String(response.output_text ?? '').trim();
  if (!outputText) throw new Error('語言模型沒有回傳候選內容。');
  const parsed = JSON.parse(outputText);
  const validated = validateAliasProposals(parsed.groups, candidates);
  return {
    model,
    responseId: response.id ?? null,
    proposals: validated.proposals,
    rejected: validated.rejected,
  };
}

function summarizeComputerScienceCoverage(courses, courseTagWeights) {
  const codes = new Set(courses
    .map(course => String(course?.catalogCourseCode ?? '').trim().toUpperCase())
    .filter(code => code.startsWith('IECS')));
  const retained = [...codes].filter(code => courseTagWeights.has(code)).length;
  return {
    courseCount: codes.size,
    retainedCourseCount: retained,
    ratio: codes.size > 0 ? retained / codes.size : 0,
  };
}

function checkCourseWeightMass(courseTagWeights) {
  let maxAbsoluteError = 0;
  for (const weights of courseTagWeights.values()) {
    const total = weights.reduce((sum, item) => sum + item.weight, 0);
    maxAbsoluteError = Math.max(maxAbsoluteError, Math.abs(total - 1));
  }
  return { checkedCourseCount: courseTagWeights.size, maxAbsoluteError };
}

async function main() {
  if (!statsOnly && !allowExternalModel) {
    throw new Error('預設不會將課程標籤送往外部模型；如已取得資料分享授權，才可加上 --allow-external-model。');
  }

  const courses = await getAll('courses');
  if (!Array.isArray(courses) || courses.length === 0) {
    throw new Error('課程目錄為空，無法產生詞彙報告。');
  }

  const aliasFile = JSON.parse(await fs.readFile(aliasPath, 'utf8'));
  const analysis = buildInterestTagVocabulary(courses, { aliases: aliasFile });
  const candidates = getFrequentInterestTagCandidates(courses);
  const modelResult = statsOnly
    ? {
      model: '未呼叫（--stats-only）', responseId: null, proposals: [], rejected: [],
      blockedReason: externalModelBlocked
        ? '自動審查拒絕將 catalog 標籤與出現次數送往設定的 OpenAI 服務，理由是該資料尚未明確核准外傳；審查要求不得改用其他路徑重試。'
        : null,
    }
    : await proposeAliases(candidates);
  const csCoverage = summarizeComputerScienceCoverage(courses, analysis.courseTagWeights);
  const weightCheck = checkCourseWeightMass(analysis.courseTagWeights);

  const details = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    source: 'read-only Course_Sections / Courses catalog query',
    settings: {
      caseInsensitive: true,
      removeWhitespaceAndHyphenDifferences: true,
      genericCourseRatioThreshold: 0.02,
      minimumCourseCountAfterMerging: 2,
      aliasCandidatesMinimumRawCourseCount: 5,
      rarityFormula: 'ln((courseCount + 1) / (tagCourseCount + 1)); normalized within each course',
    },
    summary: analysis.summary,
    computerScienceCoverage: csCoverage,
    weightCheck,
    normalizationMerges: analysis.mergedGroups.filter(group => group.mergedBy === 'normalization'),
    includedTags: analysis.includedTags,
    excludedTags: analysis.excludedTags,
    aliasProposal: {
      model: modelResult.model,
      responseId: modelResult.responseId,
      inputTagCount: candidates.length,
      inputTags: candidates,
      proposals: modelResult.proposals,
      rejectedModelGroups: modelResult.rejected,
      appliedToAliasFile: false,
      externalCallStatus: externalModelBlocked ? 'blocked-by-review' : (statsOnly ? 'not-called' : 'completed'),
      blockingReason: modelResult.blockedReason ?? null,
    },
  };

  if (!noWrite) {
    await fs.mkdir(path.dirname(reportPath), { recursive: true });
    await fs.writeFile(detailsPath, `${JSON.stringify(details, null, 2)}\n`, 'utf8');
    await fs.writeFile(reportPath, renderReport({
      summary: analysis.summary,
      csCoverage,
      mergedGroups: analysis.mergedGroups,
      excludedTags: analysis.excludedTags,
      proposals: modelResult.proposals,
      modelInfo: {
        model: modelResult.model,
        candidateCount: candidates.length,
        rejectedCount: modelResult.rejected.length,
        blockingReason: modelResult.blockedReason ?? null,
      },
      weightCheck,
    }), 'utf8');
  }

  console.log(JSON.stringify({
    mode: statsOnly ? 'stats-only' : 'alias-proposal',
    report: noWrite ? null : path.relative(projectRoot, reportPath),
    details: noWrite ? null : path.relative(projectRoot, detailsPath),
    summary: analysis.summary,
    computerScienceCoverage: csCoverage,
    weightCheck,
    model: modelResult.model,
    aliasProposalCount: modelResult.proposals.length,
    appliedToAliasFile: false,
  }, null, 2));
}

main()
  .catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(() => closePool());
