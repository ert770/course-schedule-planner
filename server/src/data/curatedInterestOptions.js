// 人工策畫的「課程主題」直接確認選項（設定見 `interestMenuConfig.js` 的 `CURATED_DIRECT_OPTIONS`，決策見 ADR-026）。
//
// 一般選項來自標籤目錄的分類，只收「可選」標籤（可學習且可跨課配對，`isSelectableInterestTag`）。策畫選項例外的地方
// 只有一個：清單裡屬於 too_common 的標籤（例如「人工智慧」「機器學習」），**使用者從策畫選項明確選擇時**也接受並計分。
//
// 為什麼只限明確選擇：too_common 的原意是「全校太多課都有，從瀏覽、收藏等行為學不出偏好」，這個理由對行為學習仍然成立，
// 所以行為學習照舊不學它們；但使用者親手勾「人工智慧」是明確意圖，在資工本系候選池裡它只出現在少數 AI 課上，鑑別度很高。
// 其他排除原因（explicit_generic、只出現在一門課）不豁免：前者是「教學」「專題」這類無意義詞，後者計分也配對不到別的課。
//
// 這裡是純函式，不碰資料庫。

import { CURATED_DIRECT_OPTIONS } from './interestMenuConfig.js';
import { interestTagCatalog, resolveInterestTags } from './interestTagCatalog.js';
import { isSelectableInterestTag } from './interestTagEligibility.js';

const SAMPLE_COURSE_COUNT = 3;
const compareText = (left, right) => String(left).localeCompare(String(right), 'zh-Hant');

const tagByName = new Map(interestTagCatalog.canonicalTags.map(tag => [tag.name, tag]));
const mainByName = new Map(interestTagCatalog.mainCategories.map(item => [item.name, item]));

function resolveOption(config) {
  const main = mainByName.get(config.mainCategory);
  const sub = interestTagCatalog.subcategories
    .find(item => item.mainCategoryId === main?.id && item.name === config.subcategory);
  // 清單裡的名稱若在目錄裡找不到（目錄更版改名），直接略過，不猜。
  const tags = config.tagNames.map(name => tagByName.get(name)).filter(Boolean);
  return Object.freeze({
    ...config,
    mainCategoryId: main?.id ?? null,
    subcategoryId: sub?.id ?? null,
    tagIds: Object.freeze(tags.map(tag => tag.id)),
  });
}

const curatedOptions = CURATED_DIRECT_OPTIONS.map(resolveOption)
  // 對應不到目錄分類的選項不啟用：categoryInterests 需要一個真實存在的分類。
  .filter(option => option.subcategoryId);
const curatedById = new Map(curatedOptions.map(option => [option.id, option]));

export function getCuratedInterestOption(categoryId) {
  return curatedById.get(String(categoryId ?? '').trim()) ?? null;
}

export function curatedOptionsForDepartment(department) {
  const name = String(department ?? '').trim();
  return curatedOptions.filter(option => option.departments.includes(name));
}

function tooCommon(tag) {
  return tag?.eligibility?.exclusionReason === 'too_common';
}

/** 這個標籤能不能從這個策畫選項被選：在清單內，且是可選標籤或 too_common。 */
export function isCuratedSelectableTag(option, tag) {
  if (!option || !tag) return false;
  const id = tag.id ?? tag.canonicalTagId;
  if (!option.tagIds.includes(id)) return false;
  return isSelectableInterestTag(tag) || tooCommon(tag);
}

/** 明確選擇後才計分的標籤：被某個策畫選項列入、但本身不是可選標籤（too_common）。 */
export function isSelectionScoringExemptTag(tag) {
  if (!tag || isSelectableInterestTag(tag) || !tooCommon(tag)) return false;
  const id = tag.id ?? tag.canonicalTagId;
  return curatedOptions.some(option => option.tagIds.includes(id));
}

function courseKeyOf(course) {
  for (const value of [course?.catalogCourseCode, course?.courseCode, course?.courseId, course?.code]) {
    const key = String(value ?? '').trim();
    if (key) return key;
  }
  return String(course?.name ?? '').trim();
}

function rawTagsOf(course) {
  const value = course?.ragTag;
  if (Array.isArray(value)) return value;
  if (typeof value !== 'string' || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) return parsed;
  } catch {
    // 不是 JSON，當成以頓號、逗號分隔的字串。
  }
  return value.split(/[,、，]/u).map(item => item.trim()).filter(Boolean);
}

/**
 * 某個策畫選項在這批課程（本系組）裡實際命中的標籤。選單與保存驗證共用。
 * @returns `{ courses: Map<課程鍵, 課名>, tags: Array<{ tagId, name, courseCount, sampleCourses }> }`
 */
export function collectCuratedOptionTags(courses = [], option) {
  const hitCourses = new Map();
  const byTag = new Map();
  if (!option) return { courses: hitCourses, tags: [] };
  for (const course of Array.isArray(courses) ? courses : []) {
    const key = courseKeyOf(course);
    if (!key) continue;
    for (const tag of resolveInterestTags(rawTagsOf(course)).tags) {
      if (!isCuratedSelectableTag(option, tag)) continue;
      if (!byTag.has(tag.canonicalTagId)) {
        byTag.set(tag.canonicalTagId, { tagId: tag.canonicalTagId, name: tag.canonicalName, courses: new Map() });
      }
      byTag.get(tag.canonicalTagId).courses.set(key, course.name ?? key);
      hitCourses.set(key, course.name ?? key);
    }
  }
  const tags = [...byTag.values()]
    .map(tag => ({
      tagId: tag.tagId,
      name: tag.name,
      courseCount: tag.courses.size,
      sampleCourses: [...tag.courses.values()].slice(0, SAMPLE_COURSE_COUNT),
    }))
    .sort((a, b) => b.courseCount - a.courseCount || compareText(a.name, b.name) || compareText(a.tagId, b.tagId));
  return { courses: hitCourses, tags };
}

/** 本系選單用：這位學生的系所適用、而且候選池裡至少命中一個標籤的策畫選項。 */
export function buildCuratedTopicOptions(departmentCourses = [], department = null) {
  return curatedOptionsForDepartment(department).map(option => {
    const { courses, tags } = collectCuratedOptionTags(departmentCourses, option);
    if (tags.length === 0) return null;
    return {
      id: option.id,
      name: option.name,
      nameSource: 'curated',
      level: 'sub',
      mainCategory: option.mainCategory,
      mainCategories: [option.mainCategory],
      mode: 'direct',
      courseCount: courses.size,
      tagCount: tags.length,
      aliasIds: [],
      sampleCourses: [...courses.values()].slice(0, SAMPLE_COURSE_COUNT),
      tags,
    };
  }).filter(Boolean);
}

export default {
  getCuratedInterestOption,
  curatedOptionsForDepartment,
  isCuratedSelectableTag,
  isSelectionScoringExemptTag,
  collectCuratedOptionTags,
  buildCuratedTopicOptions,
};
