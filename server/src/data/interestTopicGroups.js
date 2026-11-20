// 設定頁「想接觸的課程主題」選單的分組與統計（純函式，不碰資料庫）。
//
// 輸入是**已經分好組**的課程（本系／通識／系外，分組由 `interestMenuService.js` 依排課器的畢業分類桶
// 決定），輸出是三組選單。這樣統計邏輯可以用合成課程單元測試，不必連資料庫。
//
// 標籤一律先經 `resolveInterestTags()`（別名解析，「人工智能」「人工智慧」是同一個標籤），再用
// `isSelectableInterestTag()` 篩：只有同時可學習且可跨課配對的標籤才算數，選單才不會出現「點進去
// 卻沒有可計分標籤」的類別。

import { resolveInterestTags } from './interestTagCatalog.js';
import { isSelectableInterestTag } from './interestTagEligibility.js';
import {
  DIRECT_MAX_TAGS,
  DIRECT_SUBCATEGORIES,
  EXCLUDED_MAIN_CATEGORY_NAMES,
  FOLLOWUP_CANDIDATE_LIMIT,
  INTEREST_MENU_GROUPS,
  MENU_OPTION_LIMIT,
} from './interestMenuConfig.js';

const excludedMainNames = new Set(EXCLUDED_MAIN_CATEGORY_NAMES);
const directKeys = new Set(DIRECT_SUBCATEGORIES.map(item => `${item.mainCategory}/${item.subcategory}`));
const SAMPLE_COURSE_COUNT = 3;

const compareText = (left, right) => String(left).localeCompare(String(right), 'zh-Hant');

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

// 同一門課開多個班只算一次：用課程層級的代碼，沒有才退到班次代碼與課名。
function courseKeyOf(course) {
  for (const value of [course?.catalogCourseCode, course?.courseCode, course?.courseId, course?.code]) {
    const key = String(value ?? '').trim();
    if (key) return key;
  }
  return String(course?.name ?? '').trim();
}

function categoryKey(category) {
  return `${category.mainCategory}/${category.name}`;
}

/**
 * 把一批課程依「標籤所屬的分類」彙總。一個標籤可能同時屬於好幾個分類，所以一門課可能出現在多個分類裡。
 * @param level 'sub' 用子類別，'main' 用大類別。
 * @returns Array<{ id, name, mainCategory, courses: Map<課程鍵, 課名>, tags: Map<標籤 ID, {...}> }>
 */
export function aggregateInterestCategories(courses = [], level = 'main') {
  const categories = new Map();

  for (const course of Array.isArray(courses) ? courses : []) {
    const courseKey = courseKeyOf(course);
    if (!courseKey) continue;

    for (const tag of resolveInterestTags(rawTagsOf(course)).tags) {
      if (!isSelectableInterestTag(tag)) continue;
      for (const path of tag.categoryPaths) {
        if (excludedMainNames.has(path.mainCategory)) continue;
        const id = level === 'sub' ? path.subcategoryId : path.mainCategoryId;
        const name = level === 'sub' ? path.subcategory : path.mainCategory;
        if (!id || !name) continue;

        if (!categories.has(id)) {
          categories.set(id, {
            id, name, mainCategory: path.mainCategory, courses: new Map(), tags: new Map(),
          });
        }
        const category = categories.get(id);
        category.courses.set(courseKey, course.name ?? courseKey);
        if (!category.tags.has(tag.canonicalTagId)) {
          category.tags.set(tag.canonicalTagId, {
            tagId: tag.canonicalTagId, name: tag.canonicalName, courses: new Map(),
          });
        }
        category.tags.get(tag.canonicalTagId).courses.set(courseKey, course.name ?? courseKey);
      }
    }
  }

  return [...categories.values()];
}

function describeTags(category) {
  return [...category.tags.values()]
    .map(tag => ({
      tagId: tag.tagId,
      name: tag.name,
      courseCount: tag.courses.size,
      sampleCourses: [...tag.courses.values()].slice(0, SAMPLE_COURSE_COUNT),
    }))
    .sort((a, b) => b.courseCount - a.courseCount || compareText(a.name, b.name)
      || compareText(a.tagId, b.tagId));
}

/**
 * 追問與保存驗證用：某個分類在這批課程裡有哪些可選標籤。
 * 用**未去重**的彙總找分類，所以重複子類別的任何一個 ID 都找得到。
 */
export function getInterestCategoryCandidates(courses, level, categoryId, {
  limit = FOLLOWUP_CANDIDATE_LIMIT,
} = {}) {
  const category = aggregateInterestCategories(courses, level)
    .find(item => item.id === String(categoryId ?? '').trim());
  if (!category) return { category: null, tags: [], totalTagCount: 0 };

  const all = describeTags(category);
  return {
    category: {
      id: category.id, name: category.name, mainCategory: category.mainCategory,
      courseCount: category.courses.size,
    },
    tags: all.slice(0, Math.max(0, Number(limit) || 0)),
    totalTagCount: all.length,
  };
}

// 同一組「池內可選標籤集合」完全相同的子類別併成一個選項。標籤集合相同代表命中的課程也相同，
// 留著只會讓學生看到好幾個內容一樣的選項。
//
// 名稱一律用目錄原名，不另做顯示名稱對照（使用者 2026-11-20 決定不做）。代表者的選法：白名單優先，
// 其次是名稱較長的（較長的名稱通常較具體，例如「資料與資訊系統」比「AI」「程式」更貼近內容），
// 最後以 ID 排序讓結果可重現。
function mergeIdenticalCategories(categories) {
  const bySignature = new Map();
  for (const category of categories) {
    const signature = [...category.tags.keys()].sort().join('|');
    if (!bySignature.has(signature)) bySignature.set(signature, []);
    bySignature.get(signature).push(category);
  }

  return [...bySignature.values()].map(members => {
    const ranked = [...members].sort((a, b) => (
      Number(directKeys.has(categoryKey(b))) - Number(directKeys.has(categoryKey(a)))
      || b.name.length - a.name.length
      || compareText(a.id, b.id)
    ));
    const [representative, ...aliases] = ranked;
    return {
      ...representative,
      aliasIds: aliases.map(member => member.id),
      isDirectListed: ranked.some(member => directKeys.has(categoryKey(member))),
    };
  });
}

function toOption(category, { group, level }) {
  const tags = describeTags(category);
  const direct = group.key === 'department'
    && category.isDirectListed === true
    && tags.length >= 1
    && tags.length <= DIRECT_MAX_TAGS;

  return {
    id: category.id,
    name: category.name,
    level,
    mainCategory: category.mainCategory,
    mode: direct ? 'direct' : 'followup',
    courseCount: category.courses.size,
    tagCount: tags.length,
    aliasIds: category.aliasIds ?? [],
    sampleCourses: [...category.courses.values()].slice(0, SAMPLE_COURSE_COUNT),
    // 直接確認的選項要把展開的標籤交給前端顯示；追問的標籤由追問服務另外準備。
    ...(direct ? { tags } : {}),
  };
}

/**
 * @param groupedCourses `{ department, generalEducation, outside }`，各是課程陣列。
 * @returns Array<{ key, label, level, options }>；沒有任何選項的組不回傳。
 */
export function buildInterestTopicGroups(groupedCourses = {}, { limit = MENU_OPTION_LIMIT } = {}) {
  const groups = [];
  for (const group of INTEREST_MENU_GROUPS) {
    const categories = aggregateInterestCategories(groupedCourses[group.key] ?? [], group.level);
    const merged = group.level === 'sub'
      ? mergeIdenticalCategories(categories)
      : categories;

    const options = merged
      .map(category => toOption(category, { group, level: group.level }))
      .sort((a, b) => b.courseCount - a.courseCount || b.tagCount - a.tagCount
        || compareText(a.name, b.name))
      .slice(0, Math.max(0, Number(limit) || 0));

    if (options.length > 0) {
      groups.push({ key: group.key, label: group.label, level: group.level, options });
    }
  }
  return groups;
}

export default { aggregateInterestCategories, getInterestCategoryCandidates, buildInterestTopicGroups };
