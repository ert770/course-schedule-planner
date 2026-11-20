// 「課程主題選擇結果」（`interestSelections`）對照標籤目錄的解析。
//
// 形狀正規化在 `interestPreferences.js`（它不能 import 標籤目錄，否則循環 import：
// 標籤目錄本身就 import `interestPreferences.js`）。這裡才讀目錄，回答三個問題：
//   1. 這個分類 ID 在目錄裡存在嗎？是大類別還是子類別？
//   2. 這個標籤 ID 在目錄裡存在嗎？可選嗎（可學習且可跨課配對）？
//   3. 這個標籤真的屬於使用者當時選的分類嗎？
//
// 不合格的項目不會丟例外，而是原樣列在 `ignored`、附上原因，呼叫端決定要不要警告使用者。
// **這裡只對照目錄，不對照候選池**：標籤是否屬於「這位學生這學期、這一組」的候選課程，
// 要有學生的班級才判斷得了，由保存驗證處理。

import { interestTagCatalog } from './interestTagCatalog.js';
import { isSelectableInterestTag } from './interestTagEligibility.js';

export const SELECTION_IGNORE_REASON = Object.freeze({
  UNKNOWN_CATEGORY: 'unknown_category',
  UNKNOWN_TAG: 'unknown_tag',
  TAG_NOT_SELECTABLE: 'tag_not_selectable',
  TAG_NOT_IN_CATEGORY: 'tag_not_in_category',
});

const mainById = new Map(interestTagCatalog.mainCategories.map(item => [item.id, item]));
const subById = new Map(interestTagCatalog.subcategories.map(item => [item.id, item]));
const tagById = new Map(interestTagCatalog.canonicalTags.map(item => [item.id, item]));

/** 分類 ID → `{ type: 'main' | 'subcategory', ... }`；目錄裡沒有就回 null。 */
export function lookupInterestCategory(categoryId) {
  const id = String(categoryId ?? '').trim();
  const main = mainById.get(id);
  if (main) {
    return { type: 'main', mainCategoryId: main.id, subcategoryId: null, name: main.name };
  }
  const sub = subById.get(id);
  if (sub) {
    return {
      type: 'subcategory', mainCategoryId: sub.mainCategoryId, subcategoryId: sub.id, name: sub.name,
    };
  }
  return null;
}

function tagBelongsToCategory(tag, category) {
  return (tag.categoryAssignments ?? []).some(assignment => (
    category.type === 'main'
      ? assignment.mainCategoryId === category.mainCategoryId
      : assignment.subcategoryId === category.subcategoryId
  ));
}

/**
 * @param selections `normalizeInterestSelections()` 的結果。
 * @returns {{
 *   categories: Array,              // 目錄裡存在的分類，去重；不含底下的標籤
 *   tags: Array<{ tag, from: Array<{ group, categoryId }> }>, // 合格標籤，依 ID 去重
 *   ignored: Array<{ group, categoryId, tagId?, reason }>,
 * }}
 */
export function resolveInterestSelections(selections = []) {
  const categories = new Map();
  const tags = new Map();
  const ignored = [];

  for (const selection of Array.isArray(selections) ? selections : []) {
    const { group, categoryId } = selection ?? {};
    const category = lookupInterestCategory(categoryId);
    if (!category) {
      ignored.push({ group, categoryId, reason: SELECTION_IGNORE_REASON.UNKNOWN_CATEGORY });
      continue;
    }
    const categoryKey = `${category.type}:${category.subcategoryId ?? category.mainCategoryId}`;
    if (!categories.has(categoryKey)) categories.set(categoryKey, category);

    for (const tagId of Array.isArray(selection.tagIds) ? selection.tagIds : []) {
      const tag = tagById.get(String(tagId ?? '').trim());
      if (!tag) {
        ignored.push({ group, categoryId, tagId, reason: SELECTION_IGNORE_REASON.UNKNOWN_TAG });
      } else if (!isSelectableInterestTag(tag)) {
        ignored.push({ group, categoryId, tagId, reason: SELECTION_IGNORE_REASON.TAG_NOT_SELECTABLE });
      } else if (!tagBelongsToCategory(tag, category)) {
        ignored.push({ group, categoryId, tagId, reason: SELECTION_IGNORE_REASON.TAG_NOT_IN_CATEGORY });
      } else {
        if (!tags.has(tag.id)) tags.set(tag.id, { tag, from: [] });
        tags.get(tag.id).from.push({ group, categoryId });
      }
    }
  }

  return { categories: [...categories.values()], tags: [...tags.values()], ignored };
}

export default { SELECTION_IGNORE_REASON, lookupInterestCategory, resolveInterestSelections };
