// 保存「課程主題選擇結果」（`interestSelections`）前的驗證。
//
// `profileUpdateValidation.js` 只驗形狀；`interestSelections.js` 只對照標籤目錄（標籤存在、可選、屬於所選
// 分類）。這裡才對照**這位學生的排課候選池**：標籤必須真的屬於「這一組、這個分類」在他的候選課程裡
// 出現的可選標籤。單查「ID 存在」不夠——使用者（或被竄改的請求）可以送一個存在於目錄、卻跟他的選單
// 完全無關的標籤，存進去之後它會悄悄改變排課。
//
// 原則（沿用「失敗不擋保存、但不接受無法驗證的新資料」）：
//   - **沒變的選擇不重驗**：與已保存的某一筆完全相同（同組、同分類、同標籤集合）就原樣保留。新學期候選池
//     變了、舊答案對不上，不能因為這樣就把使用者以前的選擇默默刪掉。
//   - **變動或新增的選擇才驗**：分類必須存在、層級與組別相符（本系用子類別、通識與系外用大類別）、在候選池裡
//     有這個分類；標籤不在候選池內的丟掉並回報。
//   - **候選池載入失敗、或學生範圍不完整（缺班別）時，不接受新的標籤**：變動的選擇保留已保存的標籤（沒有就
//     是空的，只記類別），回報 `unverified`，**不擋住其他欄位保存**。

import { getInterestCategoryCandidates } from '../data/interestTopicGroups.js';
import { lookupInterestCategory } from '../data/interestSelections.js';
import { normalizeInterestSelections } from '../data/interestPreferences.js';
import { logger } from '../utils/logger.js';
import { getInterestTopicGroups } from './interestMenuService.js';

const LEVEL_BY_GROUP = Object.freeze({ department: 'sub', generalEducation: 'main', outside: 'main' });
const EXPECTED_TYPE = Object.freeze({ sub: 'subcategory', main: 'main' });
const ALL_TAGS = 100_000;

export const SELECTION_WARNING = Object.freeze({
  UNKNOWN_CATEGORY: 'unknown_category',
  WRONG_LEVEL: 'wrong_level',
  CATEGORY_NOT_IN_POOL: 'category_not_in_pool',
  TAG_NOT_IN_POOL: 'tag_not_in_pool',
  VERIFICATION_UNAVAILABLE: 'verification_unavailable',
});

const keyOf = item => `${item.group}\u0000${item.categoryId}`;
const sameTagSet = (left, right) => (
  left.length === right.length && [...left].sort().join('|') === [...right].sort().join('|')
);

/**
 * @param input.selections 使用者這次送來的完整清單（形狀已由 `validateProfileUpdate` 驗過）
 * @param input.previousSelections 已保存的清單
 * @param input.filters 學生範圍 `{ department, gradeLevel, className }`
 * @param deps 測試用注入：`{ getMenu }`
 * @returns `{ selections, status, warnings }`；status 是 `unchanged`、`verified` 或 `unverified`。
 */
export async function sanitizeInterestSelectionsForSave(
  { selections, previousSelections = [], filters },
  deps = {},
) {
  const incoming = normalizeInterestSelections(selections);
  const previous = new Map(normalizeInterestSelections(previousSelections).map(item => [keyOf(item), item]));
  const warnings = [];

  const isUnchanged = item => {
    const old = previous.get(keyOf(item));
    return Boolean(old) && sameTagSet(old.tagIds, item.tagIds);
  };
  if (incoming.every(isUnchanged)) return { selections: incoming, status: 'unchanged', warnings };

  // 池載入失敗，或學生範圍不完整（缺班別）：不接受新的標籤。
  let menu = null;
  try {
    menu = await (deps.getMenu ?? getInterestTopicGroups)(filters);
    if (!menu.scopeReady) menu = null;
  } catch (error) {
    logger.warn(`保存主題選擇時無法載入候選池：${error?.message ?? '未知錯誤'}`, { label: 'InterestSelection' });
  }

  if (!menu) {
    const kept = incoming.map(item => {
      if (isUnchanged(item)) return item;
      warnings.push({ group: item.group, categoryId: item.categoryId, reason: SELECTION_WARNING.VERIFICATION_UNAVAILABLE });
      // 類別仍要存在於目錄才保留；標籤退回已保存的（沒有就空）。
      if (!lookupInterestCategory(item.categoryId)) return null;
      return { ...item, tagIds: previous.get(keyOf(item))?.tagIds ?? [] };
    }).filter(Boolean);
    return { selections: kept, status: 'unverified', warnings };
  }

  const verified = [];
  for (const item of incoming) {
    if (isUnchanged(item)) {
      verified.push(item);
      continue;
    }
    const category = lookupInterestCategory(item.categoryId);
    if (!category) {
      warnings.push({ group: item.group, categoryId: item.categoryId, reason: SELECTION_WARNING.UNKNOWN_CATEGORY });
      continue;
    }
    const level = LEVEL_BY_GROUP[item.group];
    if (category.type !== EXPECTED_TYPE[level]) {
      warnings.push({ group: item.group, categoryId: item.categoryId, reason: SELECTION_WARNING.WRONG_LEVEL });
      continue;
    }
    const found = getInterestCategoryCandidates(menu.grouped[item.group] ?? [], level, item.categoryId, { limit: ALL_TAGS });
    if (!found.category) {
      warnings.push({ group: item.group, categoryId: item.categoryId, reason: SELECTION_WARNING.CATEGORY_NOT_IN_POOL });
      continue;
    }
    const valid = new Set(found.tags.map(tag => tag.tagId));
    const tagIds = [];
    for (const tagId of item.tagIds) {
      if (valid.has(tagId)) tagIds.push(tagId);
      else warnings.push({ group: item.group, categoryId: item.categoryId, tagId, reason: SELECTION_WARNING.TAG_NOT_IN_POOL });
    }
    verified.push({ ...item, tagIds });
  }
  return { selections: verified, status: 'verified', warnings };
}

export default { SELECTION_WARNING, sanitizeInterestSelectionsForSave };
