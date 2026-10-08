import { normalizeInterestList } from './interestPreferences.js';

export const INTEREST_TAG_MIN_COURSE_COUNT = 2;
export const INTEREST_TAG_PROPOSAL_MIN_COURSE_COUNT = 5;
export const INTEREST_TAG_MAX_COURSE_RATIO = 0.02;

// 這些標籤描述課程的一般能力或經驗，不足以區分使用者對哪個學科主題有興趣。
// 比例門檻之外，清單可以補上語意上明確通用、但尚未超過 2% 的詞。
export const GENERIC_INTEREST_TAGS = Object.freeze([
  '團隊合作',
  '專業技能',
  '就業競爭力',
  '問題解決',
  '實習',
  '研究方法',
]);

function courseKey(course) {
  const value = course?.catalogCourseCode
    ?? course?.courseCode
    ?? course?.courseId
    ?? course?.code
    ?? course?.id
    ?? course?.sectionId;
  return String(value ?? '').trim();
}

/**
 * 標籤比較鍵：全形字元正規化、去頭尾空白、英文字母不分大小寫，並忽略空白與連字號。
 * 顯示名稱仍保留原始大小寫與語言，只有比較鍵會正規化。
 */
export function normalizeInterestTag(value) {
  const source = normalizeInterestList([value])[0];
  if (!source) return '';
  return source
    .normalize('NFKC')
    .toLocaleLowerCase('en-US')
    .replace(/[\s\p{Dash_Punctuation}\u2212]+/gu, '');
}

function aliasEntries(aliases) {
  const source = aliases?.aliases ?? aliases ?? {};
  if (source instanceof Map) return [...source.entries()];
  if (!source || typeof source !== 'object' || Array.isArray(source)) return [];
  return Object.entries(source);
}

function buildAliasIndex(aliases) {
  const labelsByKey = new Map();
  for (const [alias, canonical] of aliasEntries(aliases)) {
    const aliasKey = normalizeInterestTag(alias);
    const canonicalLabel = String(canonical ?? '').trim();
    if (aliasKey && canonicalLabel) labelsByKey.set(aliasKey, canonicalLabel);
  }
  return labelsByKey;
}

function chooseDisplayLabel(surfaceCounts) {
  return [...surfaceCounts.entries()]
    .sort((left, right) => (
      right[1] - left[1]
      || left[0].localeCompare(right[0], 'zh-Hant')
    ))[0]?.[0] ?? '';
}

function percentileMedian(values) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

/**
 * 取得出現於至少指定門數課程的原始標籤，用於產生人工審查的同義詞候選。
 * 同一課號的多個班次只計一次；標籤尚未做語意合併。
 */
export function getFrequentInterestTagCandidates(courses = [], minCourseCount = INTEREST_TAG_PROPOSAL_MIN_COURSE_COUNT) {
  const tagsByCourse = new Map();
  for (const course of courses) {
    const key = courseKey(course);
    if (!key) continue;
    if (!tagsByCourse.has(key)) tagsByCourse.set(key, new Set());
    for (const tag of normalizeInterestList(course?.ragTag)) tagsByCourse.get(key).add(tag);
  }

  const courseIdsByRawTag = new Map();
  for (const [key, tags] of tagsByCourse) {
    for (const tag of tags) {
      if (!courseIdsByRawTag.has(tag)) courseIdsByRawTag.set(tag, new Set());
      courseIdsByRawTag.get(tag).add(key);
    }
  }

  return [...courseIdsByRawTag.entries()]
    .map(([tag, courseIds]) => ({ tag, courseCount: courseIds.size }))
    .filter(item => item.courseCount >= minCourseCount)
    .sort((left, right) => (
      right.courseCount - left.courseCount
      || left.tag.localeCompare(right.tag, 'zh-Hant')
    ));
}

/**
 * 將 section 課程目錄整理成標籤詞彙與每門課的標籤權重。
 *
 * @param courses 課程/班次資料，至少包含穩定課號與 ragTag 陣列。
 * @param options.aliases 人工確認的 alias -> canonical label 對照表。
 * @param options.genericTags 額外明列的通用標籤。
 * @param options.maxCourseRatio 出現在超過此比例課程時排除，預設 0.02。
 * @param options.minCourseCount 合併後至少出現在幾門課，預設 2。
 * @returns 標籤統計、合併/排除清單，以及每門課總和為 1 的保留標籤權重。
 */
export function buildInterestTagVocabulary(courses = [], options = {}) {
  const aliases = options.aliases ?? {};
  const genericTags = options.genericTags ?? GENERIC_INTEREST_TAGS;
  const maxCourseRatio = Number.isFinite(options.maxCourseRatio)
    ? options.maxCourseRatio
    : INTEREST_TAG_MAX_COURSE_RATIO;
  const minCourseCount = Number.isInteger(options.minCourseCount)
    ? Math.max(1, options.minCourseCount)
    : INTEREST_TAG_MIN_COURSE_COUNT;
  const aliasIndex = buildAliasIndex(aliases);
  const genericKeys = new Set(normalizeInterestList(genericTags).map(normalizeInterestTag));

  const coursesByKey = new Map();
  const rawCourseIds = new Map();
  const tagBuckets = new Map();

  for (const course of courses) {
    const key = courseKey(course);
    if (!key) continue;
    if (!coursesByKey.has(key)) coursesByKey.set(key, { key, labels: new Map() });
    const record = coursesByKey.get(key);

    for (const rawTag of normalizeInterestList(course?.ragTag)) {
      const rawKey = normalizeInterestTag(rawTag);
      if (!rawKey) continue;

      if (!rawCourseIds.has(rawTag)) rawCourseIds.set(rawTag, new Set());
      rawCourseIds.get(rawTag).add(key);

      const canonicalLabel = aliasIndex.get(rawKey) ?? rawTag;
      const canonicalKey = normalizeInterestTag(canonicalLabel);
      if (!canonicalKey) continue;
      if (!record.labels.has(canonicalKey)) record.labels.set(canonicalKey, new Set());
      record.labels.get(canonicalKey).add(rawTag);

    }
  }

  // 先把同課不同班次的標籤併到 course record，再累計標籤頻率；班次較多的課不會
  // 因為同一表面寫法重複出現而左右顯示名稱或文件頻率。
  for (const [courseId, course] of coursesByKey) {
    for (const [canonicalKey, rawLabels] of course.labels) {
      if (!tagBuckets.has(canonicalKey)) {
        tagBuckets.set(canonicalKey, {
          key: canonicalKey,
          courseIds: new Set(),
          surfaceCounts: new Map(),
          aliasCanonicalLabel: null,
          manualAliasApplied: false,
        });
      }
      const bucket = tagBuckets.get(canonicalKey);
      bucket.courseIds.add(courseId);
      for (const rawTag of rawLabels) {
        bucket.surfaceCounts.set(rawTag, (bucket.surfaceCounts.get(rawTag) ?? 0) + 1);
        if (aliasIndex.has(normalizeInterestTag(rawTag))) {
          bucket.aliasCanonicalLabel = aliasIndex.get(normalizeInterestTag(rawTag));
          bucket.manualAliasApplied = true;
        }
      }
    }
  }

  const courseCount = coursesByKey.size;
  const rawTagCount = rawCourseIds.size;
  const buckets = [...tagBuckets.values()].map(bucket => {
    const displayLabel = bucket.aliasCanonicalLabel ?? chooseDisplayLabel(bucket.surfaceCounts);
    const count = bucket.courseIds.size;
    return {
      ...bucket,
      displayLabel,
      courseCount: count,
      courseRatio: courseCount > 0 ? count / courseCount : 0,
      surfaceForms: [...bucket.surfaceCounts.keys()].sort((left, right) => left.localeCompare(right, 'zh-Hant')),
    };
  });

  const excludedTags = [];
  const includedBuckets = [];
  for (const bucket of buckets) {
    let reason = null;
    if (genericKeys.has(bucket.key)) reason = 'explicit-generic';
    else if (bucket.courseRatio > maxCourseRatio) reason = 'too-common';
    else if (bucket.courseCount < minCourseCount) reason = 'single-course';

    if (reason) {
      excludedTags.push({
        tag: bucket.displayLabel,
        courseCount: bucket.courseCount,
        courseRatio: bucket.courseRatio,
        reason,
        surfaceForms: bucket.surfaceForms,
      });
    } else {
      includedBuckets.push(bucket);
    }
  }

  const includedByKey = new Map(includedBuckets.map(bucket => [bucket.key, bucket]));
  const courseTagWeights = new Map();
  for (const [key, course] of coursesByKey) {
    const retained = [...course.labels.keys()]
      .map(tagKey => includedByKey.get(tagKey))
      .filter(Boolean);

    const rarityWeights = retained.map(bucket => Math.log((courseCount + 1) / (bucket.courseCount + 1)));
    const rarityTotal = rarityWeights.reduce((sum, value) => sum + value, 0);
    const equalWeight = retained.length > 0 ? 1 / retained.length : 0;
    const weights = retained.map((bucket, index) => ({
      tag: bucket.displayLabel,
      tagKey: bucket.key,
      courseCount: bucket.courseCount,
      rarity: rarityWeights[index],
      weight: rarityTotal > 0 ? rarityWeights[index] / rarityTotal : equalWeight,
    }));

    if (weights.length > 0) {
      courseTagWeights.set(key, weights.sort((left, right) => (
        right.weight - left.weight || left.tag.localeCompare(right.tag, 'zh-Hant')
      )));
    }
  }

  const mergedGroups = buckets
    .filter(bucket => bucket.surfaceForms.length > 1 || bucket.manualAliasApplied)
    .map(bucket => ({
      canonical: bucket.displayLabel,
      labels: bucket.surfaceForms,
      courseCount: bucket.courseCount,
      mergedBy: bucket.manualAliasApplied ? 'manual-alias' : 'normalization',
    }))
    .sort((left, right) => left.canonical.localeCompare(right.canonical, 'zh-Hant'));

  const retainedCounts = [...courseTagWeights.values()].map(items => items.length);
  const normalizedCollisionGroupCount = buckets.filter(bucket => bucket.surfaceForms.length > 1).length;
  const summary = {
    sectionCount: courses.length,
    courseCount,
    rawTagCount,
    normalizedTagCount: buckets.length,
    rawTagsAtLeastFiveCourses: getFrequentInterestTagCandidates(courses, INTEREST_TAG_PROPOSAL_MIN_COURSE_COUNT).length,
    rawTagsOnlyOneCourse: [...rawCourseIds.values()].filter(courseIds => courseIds.size === 1).length,
    normalizedTagsOnlyOneCourse: buckets.filter(bucket => bucket.courseCount === 1).length,
    normalizedCollisionGroupCount,
    mergedGroupCount: mergedGroups.length,
    includedTagCount: includedBuckets.length,
    excludedTagCount: excludedTags.length,
    excludedByReason: {
      explicitGeneric: excludedTags.filter(item => item.reason === 'explicit-generic').length,
      tooCommon: excludedTags.filter(item => item.reason === 'too-common').length,
      singleCourse: excludedTags.filter(item => item.reason === 'single-course').length,
    },
    coursesWithRetainedTags: courseTagWeights.size,
    courseCoverage: courseCount > 0 ? courseTagWeights.size / courseCount : 0,
    averageRetainedTagsPerCourse: courseCount > 0
      ? retainedCounts.reduce((sum, count) => sum + count, 0) / courseCount
      : 0,
    medianRetainedTagsPerCourse: percentileMedian(retainedCounts),
    minRetainedTagsPerCourse: retainedCounts.length > 0 ? Math.min(...retainedCounts) : 0,
    maxRetainedTagsPerCourse: retainedCounts.length > 0 ? Math.max(...retainedCounts) : 0,
    mostFrequentNormalizedTags: buckets
      .map(bucket => ({ tag: bucket.displayLabel, courseCount: bucket.courseCount }))
      .sort((left, right) => right.courseCount - left.courseCount || left.tag.localeCompare(right.tag, 'zh-Hant'))
      .slice(0, 20),
    leastFrequentIncludedTags: includedBuckets
      .map(bucket => ({ tag: bucket.displayLabel, courseCount: bucket.courseCount }))
      .sort((left, right) => left.courseCount - right.courseCount || left.tag.localeCompare(right.tag, 'zh-Hant'))
      .slice(0, 20),
  };

  return {
    summary,
    mergedGroups,
    excludedTags: excludedTags.sort((left, right) => (
      left.reason.localeCompare(right.reason)
      || right.courseCount - left.courseCount
      || left.tag.localeCompare(right.tag, 'zh-Hant')
    )),
    includedTags: includedBuckets
      .map(bucket => ({ tag: bucket.displayLabel, courseCount: bucket.courseCount }))
      .sort((left, right) => right.courseCount - left.courseCount || left.tag.localeCompare(right.tag, 'zh-Hant')),
    courseTagWeights,
  };
}

export default {
  INTEREST_TAG_MIN_COURSE_COUNT,
  INTEREST_TAG_PROPOSAL_MIN_COURSE_COUNT,
  INTEREST_TAG_MAX_COURSE_RATIO,
  GENERIC_INTEREST_TAGS,
  normalizeInterestTag,
  getFrequentInterestTagCandidates,
  buildInterestTagVocabulary,
};
