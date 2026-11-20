// 設定頁「想接觸的課程主題」的追問題目。
//
// 學生勾選類別、按下「完成並保存偏好設定」之後，每個類別問一題：「這個類別裡你對哪些具體主題有興趣？」
// 學生勾的**具體標籤**才會得到 S_tag 先驗（見 `tagInterestLearning.js`），類別本身不展開。
//
// 分工（2026-11-20 使用者決定的 A＋D）：
//   - **後端掌握可選標籤**：每個類別的候選標籤來自這位學生的排課候選池（同時可學習且可跨課配對），
//     依課程數排序取前 N 個。GPT 看不到、也用不到清單以外的任何東西。
//   - **GPT 只寫問題與調整順序**：不能新增、改名、翻譯或移除標籤。回傳的編號必須在清單內，不在的丟掉，
//     漏掉的依課程數補在後面。
//   - **A**：每個選項附代表課程與課程數（前端顯示「會加分給 N 門課」），學生自己判斷。
//   - **D**：GPT 被要求把工具與軟體名稱（PowerPoint、Chat GPT）、泛用詞（科技、創新）與只是課堂附帶提到的
//     主題排在最後，這些標籤超出顯示上限就不會出現。
//   - **學生曾選過、仍然有效的答案一律重新顯示**，不受顯示上限與 GPT 排序影響，否則舊答案無法編輯。
//   - **後備**：沒有 OPENAI_API_KEY、`INTEREST_FOLLOWUP_MODE=fixed`、GPT 逾時／失敗／回傳格式不對，一律改用
//     固定問句，選項仍來自同一份後端清單，流程相同。追問失敗不能擋住保存。
//
// 隱私：送給 OpenAI 的只有**類別名稱與標籤名稱（含各標籤的課程數）**，沒有使用者 ID、Profile、歷史、
// 系所或班別。題目只依「類別＋候選標籤」決定，所以在伺服器記憶體快取、所有使用者共用。

import {
  FOLLOWUP_CACHE_TTL_MS,
  FOLLOWUP_CANDIDATE_LIMIT,
  FOLLOWUP_DISPLAY_LIMIT,
  FOLLOWUP_GPT_TIMEOUT_MS,
  FOLLOWUP_MAX_CATEGORIES,
  FOLLOWUP_QUESTION_MAX_LENGTH,
} from '../data/interestMenuConfig.js';
import { INTEREST_SELECTION_GROUPS } from '../data/interestPreferences.js';
import { getInterestCategoryCandidates } from '../data/interestTopicGroups.js';
import { logger } from '../utils/logger.js';
import { sha256Hex } from '../utils/hash.js';
import { getInterestTopicGroups } from './interestMenuService.js';
import { getOpenAIClient, getOpenAIModel } from './openaiClient.js';

const LEVEL_BY_GROUP = Object.freeze({ department: 'sub', generalEducation: 'main', outside: 'main' });
// 取完整候選清單用（驗證「以前選過的標籤是否仍有效」要看全部，不只前 N 個）。
const ALL_TAGS = 100_000;

export function resolveFollowupMode(value = process.env.INTEREST_FOLLOWUP_MODE) {
  return String(value ?? '').trim().toLowerCase() === 'fixed' ? 'fixed' : 'gpt';
}

/**
 * 請求本文驗證（純函式）。
 * @returns `{ error }` 或 `{ value: { filters, selections } }`
 */
export function validateFollowupRequest(body = {}) {
  const department = typeof body.department === 'string' ? body.department.trim() : '';
  const className = typeof body.className === 'string' ? body.className.trim() : '';
  if (!department) return { error: 'department 必須是非空字串' };
  if (!className) return { error: 'className 必須是非空字串' };
  if (!Number.isInteger(body.gradeLevel) || body.gradeLevel < 1) {
    return { error: 'gradeLevel 必須是正整數' };
  }
  if (!Array.isArray(body.selections) || body.selections.length === 0) {
    return { error: 'selections 必須是非空陣列' };
  }
  if (body.selections.length > FOLLOWUP_MAX_CATEGORIES) {
    return { error: `selections 最多 ${FOLLOWUP_MAX_CATEGORIES} 筆` };
  }

  const seen = new Set();
  const selections = [];
  for (const item of body.selections) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      return { error: 'selections 的每一筆必須是物件' };
    }
    if (!INTEREST_SELECTION_GROUPS.includes(item.group)) {
      return { error: `selections.group 必須是 ${INTEREST_SELECTION_GROUPS.join('、')} 之一` };
    }
    if (typeof item.categoryId !== 'string' || !item.categoryId.trim()) {
      return { error: 'selections.categoryId 必須是非空字串' };
    }
    const key = `${item.group}\u0000${item.categoryId.trim()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    selections.push({ group: item.group, categoryId: item.categoryId.trim() });
  }
  return { value: { filters: { department, gradeLevel: body.gradeLevel, className }, selections } };
}

// ── GPT 的提示詞與輸出格式 ─────────────────────────────────────────────────────

export const FOLLOWUP_INSTRUCTIONS = [
  '你是大學選課系統設定頁的助手。使用者勾選了幾個課程主題類別，你要為每個類別寫一句問題，並替該類別的候選標籤排序。',
  '',
  '規則：',
  '1. 問題（question）：一句繁體中文，口語，不超過 40 字，問使用者想接觸這個類別裡的哪些具體主題。不要承諾任何課程、教師、學分或成績，不要提到使用者個人資料。',
  '2. 排序（orderedTagRefs）：只能使用輸入裡的 ref 編號，每個編號最多出現一次。越能代表這個類別的主題、越能讓學生分辨方向的標籤排越前面（例如語言類把不同語種排在前面）。',
  '3. 工具與軟體名稱（例如 PowerPoint、Chat GPT）、泛用詞（例如 科技、創新、案例分析），以及只是課堂附帶提到的主題，排在最後面。',
  '4. 不可新增、改名或翻譯標籤，也不可輸出輸入以外的編號。',
  '5. 輸入只含類別名稱與標籤名稱，沒有任何個人資料；不要要求使用者提供個人資料。',
].join('\n');

export const FOLLOWUP_SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: ['categories'],
  properties: {
    categories: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['categoryRef', 'question', 'orderedTagRefs'],
        properties: {
          categoryRef: { type: 'integer' },
          question: { type: 'string' },
          orderedTagRefs: { type: 'array', items: { type: 'integer' } },
        },
      },
    },
  },
});

/** 送給 GPT 的輸入：只有類別名稱、標籤名稱與課程數。編號是這次請求內的臨時編號。 */
export function buildFollowupInput(entries) {
  return JSON.stringify({
    categories: entries.map((entry, index) => ({
      categoryRef: index + 1,
      name: entry.name,
      tags: entry.candidates.map((tag, tagIndex) => ({
        ref: tagIndex + 1, name: tag.name, courseCount: tag.courseCount,
      })),
    })),
  });
}

export function fixedQuestion(categoryName) {
  return `「${categoryName}」裡你對哪些主題有興趣？`;
}

// GPT 寫的問題只當成一行純文字：壓成單行、去掉控制字元；太長、含網址或空白就視為不可用。
function sanitizeQuestion(value) {
  const text = String(value ?? '').replace(/[\u0000-\u001f\u007f]+/gu, ' ').replace(/\s+/gu, ' ').trim();
  if (!text || text.length > FOLLOWUP_QUESTION_MAX_LENGTH || /https?:|www\./iu.test(text)) return null;
  return text;
}

/**
 * 把 GPT 的輸出對回後端清單（純函式）。GPT 說的每一件事都要驗證：
 * 編號不在清單內的丟掉、重複的丟掉、漏掉的依原本順序補在後面。
 * 問題不可用，或完全沒有有效編號，該類別就回 null（呼叫端改用固定問句）。
 * @returns Map<entryIndex, { question, orderedIndexes }>
 */
export function normalizeGptFollowups(parsed, entries) {
  const result = new Map();
  const items = Array.isArray(parsed?.categories) ? parsed.categories : [];
  for (const item of items) {
    const entryIndex = Number(item?.categoryRef) - 1;
    const entry = entries[entryIndex];
    if (!entry || result.has(entryIndex)) continue;

    const question = sanitizeQuestion(item.question);
    const seen = new Set();
    const ordered = [];
    for (const ref of Array.isArray(item.orderedTagRefs) ? item.orderedTagRefs : []) {
      const index = Number(ref) - 1;
      if (!Number.isInteger(index) || index < 0 || index >= entry.candidates.length || seen.has(index)) continue;
      seen.add(index);
      ordered.push(index);
    }
    if (!question || ordered.length === 0) continue;
    for (let index = 0; index < entry.candidates.length; index += 1) {
      if (!seen.has(index)) ordered.push(index);
    }
    result.set(entryIndex, { question, orderedIndexes: ordered });
  }
  return result;
}

// ── 題目快取（所有使用者共用；內容只有類別與標籤，沒有個人資料）────────────────────

const questionCache = new Map();

export function resetFollowupCacheForTests() {
  questionCache.clear();
}

function cacheKey(entry) {
  return sha256Hex({ name: entry.name, tags: entry.candidates.map(tag => [tag.tagId, tag.name]) });
}

function readCache(entry, now) {
  const hit = questionCache.get(cacheKey(entry));
  return hit && hit.expiresAt > now ? hit : null;
}

function writeCache(entry, value, now) {
  questionCache.set(cacheKey(entry), { ...value, expiresAt: now + FOLLOWUP_CACHE_TTL_MS });
}

// ── 主流程 ────────────────────────────────────────────────────────────────────

function findMenuOption(menu, group, categoryId) {
  const options = menu.topicGroups.find(item => item.key === group)?.options ?? [];
  return options.find(option => option.id === categoryId || option.aliasIds.includes(categoryId)) ?? null;
}

async function askGpt(client, model, entries) {
  const response = await client.responses.create({
    model,
    instructions: FOLLOWUP_INSTRUCTIONS,
    input: buildFollowupInput(entries),
    text: { format: { type: 'json_schema', name: 'interest_followups', strict: true, schema: FOLLOWUP_SCHEMA } },
  }, { timeout: FOLLOWUP_GPT_TIMEOUT_MS });

  const outputText = String(response?.output_text ?? '').trim();
  if (!outputText) throw new Error('語言模型沒有回傳內容');
  return JSON.parse(outputText);
}

/**
 * @param request.filters 學生範圍 `{ department, gradeLevel, className }`
 * @param request.selections `[{ group, categoryId }]`
 * @param request.previousSelections 已保存的 `interestSelections`，用來重新顯示學生以前選過的標籤
 * @param deps 測試用注入：`{ getMenu, getClient, getModel, mode, now }`
 */
export async function getInterestFollowups({ filters, selections, previousSelections = [] }, deps = {}) {
  const getMenu = deps.getMenu ?? getInterestTopicGroups;
  const now = deps.now ?? Date.now();
  const mode = deps.mode ?? resolveFollowupMode();

  const menu = await getMenu(filters);
  if (!menu.scopeReady) return { followups: [], scopeReady: false, mode: 'fixed', fallbackReason: 'scope_not_ready' };

  const unavailable = [];
  const entries = [];
  for (const { group, categoryId } of selections) {
    const level = LEVEL_BY_GROUP[group];
    const found = getInterestCategoryCandidates(menu.grouped[group] ?? [], level, categoryId, { limit: ALL_TAGS });
    if (!found.category || found.tags.length === 0) {
      unavailable.push({ group, categoryId, unavailable: true, reason: 'category_not_in_pool' });
      continue;
    }
    const validIds = new Set(found.tags.map(tag => tag.tagId));
    const previous = previousSelections.find(item => item.group === group && item.categoryId === categoryId);
    entries.push({
      group,
      categoryId,
      // 內容命名的選項用選單上顯示的名稱，題目才問得到學生實際看到的那個選項。
      name: findMenuOption(menu, group, categoryId)?.name ?? found.category.name,
      all: found.tags,
      candidates: found.tags.slice(0, FOLLOWUP_CANDIDATE_LIMIT),
      previousTagIds: (previous?.tagIds ?? []).filter(tagId => validIds.has(tagId)),
    });
  }

  // 題目來源：快取 → GPT（一次請求處理所有尚未快取的類別）→ 固定問句。
  const planned = new Map();
  let fallbackReason = null;
  const client = mode === 'gpt' ? (deps.getClient ?? getOpenAIClient)() : null;
  if (mode !== 'gpt') fallbackReason = 'mode_fixed';
  else if (!client) fallbackReason = 'no_api_key';

  if (client) {
    const pending = [];
    entries.forEach((entry, index) => {
      const hit = readCache(entry, now);
      if (hit) planned.set(index, hit);
      else pending.push(index);
    });
    if (pending.length > 0) {
      const subset = pending.map(index => entries[index]);
      try {
        const parsed = await askGpt(client, (deps.getModel ?? getOpenAIModel)(), subset);
        const normalized = normalizeGptFollowups(parsed, subset);
        pending.forEach((entryIndex, subsetIndex) => {
          const value = normalized.get(subsetIndex);
          if (!value) return;
          const cached = {
            question: value.question,
            orderedTagIds: value.orderedIndexes.map(i => entries[entryIndex].candidates[i].tagId),
          };
          writeCache(entries[entryIndex], cached, now);
          planned.set(entryIndex, cached);
        });
        if (planned.size < entries.length) fallbackReason = 'partial_gpt_output';
      } catch (error) {
        // 失敗不快取、不擋保存：改用固定問句。只記營運中繼資料，不記提示詞與回應內容。
        fallbackReason = error?.name === 'APIConnectionTimeoutError' || /timed? ?out/iu.test(error?.message ?? '')
          ? 'gpt_timeout' : 'gpt_error';
        logger.warn(`追問題目的語言模型呼叫失敗：${fallbackReason}`, { label: 'InterestFollowup' });
      }
    }
  }

  const followups = entries.map((entry, index) => {
    const plan = planned.get(index);
    const orderedTagIds = plan?.orderedTagIds ?? entry.candidates.map(tag => tag.tagId);
    const byId = new Map(entry.all.map(tag => [tag.tagId, tag]));

    // 顯示：依序取前 N 個，再補上學生以前選過、仍然有效的標籤（不受上限限制）。
    const shownIds = orderedTagIds.slice(0, FOLLOWUP_DISPLAY_LIMIT);
    for (const tagId of entry.previousTagIds) if (!shownIds.includes(tagId)) shownIds.push(tagId);

    return {
      group: entry.group,
      categoryId: entry.categoryId,
      categoryName: entry.name,
      question: plan?.question ?? fixedQuestion(entry.name),
      source: plan ? 'gpt' : 'fixed',
      totalTagCount: entry.all.length,
      options: shownIds.map(tagId => {
        const tag = byId.get(tagId);
        return {
          tagId,
          name: tag.name,
          courseCount: tag.courseCount,
          sampleCourses: tag.sampleCourses,
          previouslySelected: entry.previousTagIds.includes(tagId),
        };
      }),
    };
  });

  return {
    followups: [...followups, ...unavailable],
    scopeReady: true,
    mode: followups.length > 0 && followups.every(item => item.source === 'gpt') ? 'gpt' : 'fixed',
    ...(fallbackReason ? { fallbackReason } : {}),
  };
}

export default {
  resolveFollowupMode,
  validateFollowupRequest,
  buildFollowupInput,
  normalizeGptFollowups,
  fixedQuestion,
  getInterestFollowups,
};
