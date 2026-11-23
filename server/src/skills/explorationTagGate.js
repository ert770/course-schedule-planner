// 探索頁的主題配對門檻（ADR-033）。
//
// 「從一門課出發」與「依你的修課與興趣」都要求候選課和起點（或使用者）有**完全相同**的主題標籤，
// 但不是每個標籤都能拿來當「主題相同」的證據：
//   - 工具軟體（Teams、Excel、Python…）只說明上課用什麼工具，不代表內容相近。
//   - 上課方式（實作、小組討論、口頭報告、碩士班…）只說明怎麼上課或給誰上。
//   - 太常見的標籤（crossCourseMatchEligible=false，例如機器學習、資料分析）出現在太多課上，
//     「從一門課出發」不拿它當證據；「依你的修課與興趣」仍可，因為那是使用者自己的興趣。
// 另外，出現在很多系所的籠統標籤（系統設計、生成式AI、社會問題…）仍可配對，但只靠這類標籤時分數門檻較高。
import { interestTagCatalog } from '../data/interestTagCatalog.js';
import { parseClassName } from './courseScope.js';

export const EXPLORATION_DENSE_WEIGHT = 0.7;
export const EXPLORATION_MIN_SIMILARITY = 0.40;
export const EXPLORATION_GENERIC_MIN_SIMILARITY = 0.45;
// 出現在這麼多系所以上的標籤算「籠統」。13 約是可跨課配對標籤的前 10%（2026-11-23 課程資料）。
export const GENERIC_TAG_DEPARTMENT_SPREAD = 13;

export const TAG_KIND = Object.freeze({
  TOPIC: 'topic',
  TOO_COMMON: 'too_common',
  TOOL: 'tool',
  FORMAT: 'format',
  UNKNOWN: 'unknown',
});

const TOOL_SUBCATEGORIES = new Set(['具名軟體']);
const FORMAT_MAIN_CATEGORIES = new Set(['課程活動與評量', '學習階段與課程情境']);
// 標籤目錄的分類沒有歸到上面兩類、但實際上是工具或上課方式的標籤。
const TOOL_TAG_NAMES = new Set(['Microsoft Teams']);
const FORMAT_TAG_NAMES = new Set([
  '互動學習', '實作', '實驗課程', '實驗技能', '工程技術', 'PPT', '教育', '小組討論',
  '科技', '科技教育', '職場技能', '人文藝術',
]);

const mainCategoryName = new Map(interestTagCatalog.mainCategories.map(item => [item.id, item.name]));
const subcategoryName = new Map(interestTagCatalog.subcategories.map(item => [item.id, item.name]));
const tagById = new Map(interestTagCatalog.canonicalTags.map(tag => [tag.id, tag]));

function classify(tag) {
  if (!tag) return TAG_KIND.UNKNOWN;
  const assignments = tag.categoryAssignments ?? [];
  if (TOOL_TAG_NAMES.has(tag.name)
    || assignments.some(item => TOOL_SUBCATEGORIES.has(subcategoryName.get(item.subcategoryId)))) {
    return TAG_KIND.TOOL;
  }
  if (FORMAT_TAG_NAMES.has(tag.name)
    || assignments.some(item => FORMAT_MAIN_CATEGORIES.has(mainCategoryName.get(item.mainCategoryId)))) {
    return TAG_KIND.FORMAT;
  }
  if (tag.eligibility?.crossCourseMatchEligible !== true) return TAG_KIND.TOO_COMMON;
  return TAG_KIND.TOPIC;
}

const kindCache = new Map();
export function tagKind(tagId) {
  if (!kindCache.has(tagId)) kindCache.set(tagId, classify(tagById.get(tagId)));
  return kindCache.get(tagId);
}

export function tagName(tagId) {
  return tagById.get(tagId)?.name ?? tagId;
}

const normalizeCode = value => String(value ?? '').trim().toUpperCase();

/** 每個標籤出現在幾個系所（所有學期、以班級的系所名稱計）。 */
export function buildTagDepartmentSpread(courses, tagIndex) {
  const departments = new Map();
  const seen = new Set();
  for (const course of courses ?? []) {
    const code = normalizeCode(course.catalogCourseCode);
    const department = parseClassName(course.department).department || course.department;
    const key = `${code}|${department}`;
    if (!code || !department || seen.has(key)) continue;
    seen.add(key);
    for (const id of tagIndex.vectors.get(code)?.weights?.keys() ?? []) {
      if (!departments.has(id)) departments.set(id, new Set());
      departments.get(id).add(department);
    }
  }
  return new Map([...departments].map(([id, set]) => [id, set.size]));
}

const spreadCache = new WeakMap();
function spreadFor(courses, tagIndex) {
  let spread = spreadCache.get(courses);
  if (!spread) {
    spread = buildTagDepartmentSpread(courses, tagIndex);
    spreadCache.set(courses, spread);
  }
  return spread;
}

/**
 * 「從一門課出發」用的規則。
 * @returns `{ sharedTopicTags(left, right), minimumSimilarity(tagIds), isGeneric(tagId) }`
 */
export function createExplorationTagGate(courses, tagIndex) {
  const spread = Array.isArray(courses) ? spreadFor(courses, tagIndex) : new Map();
  const isGeneric = id => (spread.get(id) ?? 0) >= GENERIC_TAG_DEPARTMENT_SPREAD;
  return {
    isGeneric,
    // 兩門課都有、且是主題（非工具、非上課方式、非太常見）的標籤。
    sharedTopicTags(left, right) {
      if (!left?.size || !right?.size) return [];
      return [...left.keys()].filter(id => right.has(id) && tagKind(id) === TAG_KIND.TOPIC);
    },
    // 只靠籠統標籤配到時，門檻提高。
    minimumSimilarity(tagIds) {
      return tagIds.length > 0 && tagIds.every(isGeneric)
        ? EXPLORATION_GENERIC_MIN_SIMILARITY
        : EXPLORATION_MIN_SIMILARITY;
    },
  };
}

/** 「依你的修課與興趣」：使用者向量與課程至少有一個完全相同、且不是工具或上課方式的標籤。 */
export function profileExactTags(userWeights, courseWeights) {
  if (!userWeights?.size || !courseWeights?.size) return [];
  return [...userWeights.keys()].filter(id => (
    courseWeights.has(id) && (tagKind(id) === TAG_KIND.TOPIC || tagKind(id) === TAG_KIND.TOO_COMMON)
  ));
}

export default {
  EXPLORATION_DENSE_WEIGHT,
  EXPLORATION_MIN_SIMILARITY,
  EXPLORATION_GENERIC_MIN_SIMILARITY,
  GENERIC_TAG_DEPARTMENT_SPREAD,
  TAG_KIND,
  tagKind,
  tagName,
  buildTagDepartmentSpread,
  createExplorationTagGate,
  profileExactTags,
};
