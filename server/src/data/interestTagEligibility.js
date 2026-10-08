import {
  GENERIC_INTEREST_TAGS,
  INTEREST_TAG_MAX_COURSE_RATIO,
  INTEREST_TAG_MIN_COURSE_COUNT,
  normalizeInterestTag,
} from './interestTagVocabulary.js';
import { resolveInterestTags, interestTagCatalog } from './interestTagCatalog.js';

function stableCourseKey(course) {
  for (const value of [
    course?.catalogCourseCode,
    course?.courseCode,
    course?.courseId,
    course?.code,
  ]) {
    const key = String(value ?? '').trim();
    if (key) return key;
  }
  return '';
}

function compareText(left, right) {
  return String(left).localeCompare(String(right), 'zh-Hant');
}

/**
 * Count canonical tags across distinct catalog courses, merging sections before
 * counting. This function only computes an eligibility proposal; it never
 * modifies the catalog or persists the result.
 */
export function buildInterestTagEligibility(courses = [], options = {}) {
  const maxCourseRatio = Number.isFinite(options.maxCourseRatio)
    ? options.maxCourseRatio
    : INTEREST_TAG_MAX_COURSE_RATIO;
  const minCourseCount = Number.isInteger(options.minCourseCount)
    ? Math.max(1, options.minCourseCount)
    : INTEREST_TAG_MIN_COURSE_COUNT;
  const genericKeys = new Set(
    (options.genericTags ?? GENERIC_INTEREST_TAGS).map(normalizeInterestTag),
  );
  const resolver = options.resolveTags ?? resolveInterestTags;
  const coursesByKey = new Map();
  const unknownByKey = new Map();
  let skippedSectionCount = 0;

  for (const section of courses) {
    const courseKey = stableCourseKey(section);
    if (!courseKey) {
      skippedSectionCount += 1;
      continue;
    }

    if (!coursesByKey.has(courseKey)) {
      coursesByKey.set(courseKey, {
        courseKey,
        name: section?.name ?? null,
        sectionCount: 0,
        tags: new Map(),
      });
    }
    const course = coursesByKey.get(courseKey);
    course.sectionCount += 1;

    const { tags = [], unknownTags = [] } = resolver(section?.ragTag);
    for (const tag of tags) {
      if (!tag?.canonicalTagId) continue;
      if (!course.tags.has(tag.canonicalTagId)) {
        course.tags.set(tag.canonicalTagId, {
          canonicalTagId: tag.canonicalTagId,
          canonicalName: tag.canonicalName,
          categoryPaths: tag.categoryPaths ?? [],
          rawTags: new Set(),
        });
      }
      const courseTag = course.tags.get(tag.canonicalTagId);
      for (const rawTag of tag.matchedRawTags ?? [tag.rawTag]) {
        if (rawTag) courseTag.rawTags.add(rawTag);
      }
    }

    for (const tag of unknownTags) {
      const rawTag = String(tag?.rawTag ?? '').trim();
      if (!rawTag) continue;
      const unknownKey = `${courseKey}\u0000${rawTag}`;
      if (!unknownByKey.has(unknownKey)) {
        unknownByKey.set(unknownKey, {
          courseKey,
          rawTag,
          status: tag.status ?? 'unmapped',
        });
      }
    }
  }

  const courseCount = coursesByKey.size;
  const tagBuckets = new Map();
  for (const course of coursesByKey.values()) {
    for (const courseTag of course.tags.values()) {
      if (!tagBuckets.has(courseTag.canonicalTagId)) {
        tagBuckets.set(courseTag.canonicalTagId, {
          canonicalTagId: courseTag.canonicalTagId,
          canonicalName: courseTag.canonicalName,
          categoryPaths: courseTag.categoryPaths,
          courseKeys: new Set(),
          rawTags: new Set(),
        });
      }
      const bucket = tagBuckets.get(courseTag.canonicalTagId);
      bucket.courseKeys.add(course.courseKey);
      for (const rawTag of courseTag.rawTags) bucket.rawTags.add(rawTag);
    }
  }

  const tags = [...tagBuckets.values()].map(bucket => {
    const courseTagCount = bucket.courseKeys.size;
    const courseRatio = courseCount > 0 ? courseTagCount / courseCount : 0;
    const isGeneric = genericKeys.has(normalizeInterestTag(bucket.canonicalName));
    let exclusionReason = null;
    if (isGeneric) exclusionReason = 'explicit_generic';
    else if (courseRatio > maxCourseRatio) exclusionReason = 'too_common';
    else if (courseTagCount < minCourseCount) exclusionReason = 'single_course';

    return {
      canonicalTagId: bucket.canonicalTagId,
      canonicalName: bucket.canonicalName,
      categoryPaths: bucket.categoryPaths,
      courseCount: courseTagCount,
      courseRatio,
      interestLearningEligible: exclusionReason !== 'explicit_generic'
        && exclusionReason !== 'too_common',
      crossCourseMatchEligible: exclusionReason === null,
      exclusionReason,
      rawTags: [...bucket.rawTags].sort(compareText),
    };
  }).sort((left, right) => (
    right.courseCount - left.courseCount
    || compareText(left.canonicalName, right.canonicalName)
    || compareText(left.canonicalTagId, right.canonicalTagId)
  ));

  const courseMembership = [...coursesByKey.values()]
    .map(course => ({
      courseKey: course.courseKey,
      name: course.name,
      sectionCount: course.sectionCount,
      canonicalTagIds: [...course.tags.keys()].sort(compareText),
    }))
    .sort((left, right) => compareText(left.courseKey, right.courseKey));

  const reasonCounts = {
    explicit_generic: tags.filter(tag => tag.exclusionReason === 'explicit_generic').length,
    too_common: tags.filter(tag => tag.exclusionReason === 'too_common').length,
    single_course: tags.filter(tag => tag.exclusionReason === 'single_course').length,
  };
  const summary = {
    catalogVersion: interestTagCatalog.catalogVersion,
    sectionCount: courses.length,
    skippedSectionCount,
    courseCount,
    canonicalTagCount: tags.length,
    interestLearningEligibleCount: tags.filter(tag => tag.interestLearningEligible).length,
    crossCourseMatchEligibleCount: tags.filter(tag => tag.crossCourseMatchEligible).length,
    ineligibleReasonCounts: reasonCounts,
    unknownCourseTagCount: unknownByKey.size,
    thresholds: { minCourseCount, maxCourseRatio },
  };

  return {
    summary,
    tags,
    courses: courseMembership,
    unknownTags: [...unknownByKey.values()].sort((left, right) => (
      compareText(left.courseKey, right.courseKey) || compareText(left.rawTag, right.rawTag)
    )),
  };
}

export default { buildInterestTagEligibility };
