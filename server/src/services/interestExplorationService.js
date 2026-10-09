import { getAll } from '../db/database.js';
import { ACTIVE_TERM, normalizeSemesterLabel } from '../data/activeTerm.js';
import {
  interestTagCatalog,
  resolveInterestTags,
  isEligibleForInterestLearning,
} from '../data/interestTagCatalog.js';
import { getPassedCourseCodes } from '../data/courseHistory.js';
import { readInterestPreferences } from '../data/interestPreferences.js';
import { getUserPreferences } from './memoryService.js';
import { filterCategorizedCourses } from '../skills/courseQuery.js';
import { CATEGORY_REQUIRED } from '../skills/courseCategory.js';
import { buildStudentScope } from '../skills/courseScope.js';

export const INTEREST_EXPLORATION_CARD_LIMIT = 8;

function normalizeCode(value) {
  return String(value ?? '').trim().toUpperCase();
}

function hasSchedule(course) {
  return (Array.isArray(course.timeBlocks) && course.timeBlocks.length > 0)
    || Boolean(course.dayOfWeek);
}

function topicIntent(profile = {}) {
  const preferences = readInterestPreferences(profile);
  const terms = [...new Set([...preferences.interests, ...preferences.preferredKeywords])];
  const topicIds = new Set(resolveInterestTags(terms).tags.map(tag => tag.canonicalTagId));
  const categoryNames = new Set(terms.map(value => String(value).trim().toLocaleLowerCase()));
  return { topicIds, categoryNames, preferredTrack: preferences.preferredTrack };
}

function categoryPathKey(path) {
  return `${path.mainCategoryId ?? ''}:${path.subcategoryId ?? ''}`;
}

function publicCard(course, tags) {
  const semester = normalizeSemesterLabel(course.semester);
  return {
    courseCode: normalizeCode(course.catalogCourseCode),
    sectionId: Number(course.sectionId ?? course.id),
    name: String(course.name ?? ''),
    department: course.department ?? null,
    credits: Number(course.credits) || 0,
    instructor: course.instructor ?? course.teacher ?? null,
    schedule: course.timeStr || null,
    term: {
      academicYear: Number(course.year) || ACTIVE_TERM.academicYear,
      semester: semester ?? normalizeSemesterLabel(ACTIVE_TERM.semester),
    },
    category: course.category,
    track: course.track ?? null,
    tags: tags.map(tag => ({
      canonicalTagId: tag.canonicalTagId,
      canonicalName: tag.canonicalName,
      categoryPaths: tag.categoryPaths.map(path => ({
        mainCategoryId: path.mainCategoryId,
        mainCategory: path.mainCategory,
        subcategoryId: path.subcategoryId,
        subcategory: path.subcategory,
      })),
    })),
  };
}

/**
 * Turn an already scope- and active-term-filtered course list into a short,
 * deterministic deck of eligible, non-required courses with diverse tag paths.
 */
export function buildInterestExplorationCards(courseSections, profile = {}, options = {}) {
  const limit = Math.max(0, Number(options.limit ?? INTEREST_EXPLORATION_CARD_LIMIT) || 0);
  const passedCodes = new Set(getPassedCourseCodes(profile.courseHistory).map(normalizeCode));
  const intent = topicIntent(profile);
  const byCourse = new Map();

  const orderedSections = [...(Array.isArray(courseSections) ? courseSections : [])]
    .sort((left, right) => Number(left.sectionId ?? left.id) - Number(right.sectionId ?? right.id));

  for (const course of orderedSections) {
    const courseCode = normalizeCode(course.catalogCourseCode);
    if (!courseCode || passedCodes.has(courseCode)) continue;
    if (course.category === CATEGORY_REQUIRED || course.type === CATEGORY_REQUIRED) continue;
    if (course.eligibility === 'unknown' || course.eligibility === 'ineligible') continue;
    if (course.outsideElective?.eligible === false || !hasSchedule(course)) continue;

    const tags = resolveInterestTags(course.ragTag).tags.filter(isEligibleForInterestLearning);
    if (tags.length === 0) continue;

    const existing = byCourse.get(courseCode);
    // A stable course may have several sections. Use the section with the most
    // learning-eligible tags so the displayed evidence matches the event snapshot.
    if (!existing || tags.length > existing.tags.length) {
      const categoryPaths = [...new Map(tags.flatMap(tag => tag.categoryPaths)
        .map(path => [categoryPathKey(path), path])).values()];
      const directMatches = tags.filter(tag => intent.topicIds.has(tag.canonicalTagId)).length;
      const categoryMatches = categoryPaths.filter(path => (
        intent.categoryNames.has(String(path.mainCategory ?? '').trim().toLocaleLowerCase())
      )).length;
      byCourse.set(courseCode, {
        card: publicCard(course, tags),
        tags,
        categoryPaths,
        relevance: directMatches * 2 + categoryMatches
          + (intent.preferredTrack && course.track === intent.preferredTrack ? 1 : 0),
      });
    }
  }

  const candidates = [...byCourse.values()].sort((left, right) => (
    right.relevance - left.relevance
    || left.card.courseCode.localeCompare(right.card.courseCode)
  ));
  const selected = [];
  const selectedCodes = new Set();
  const coveredPaths = new Set();

  // First pass chooses a course only when it adds a previously unseen
  // main/subcategory path. The second pass fills remaining slots by relevance.
  for (const candidate of candidates) {
    if (selected.length >= limit) break;
    const newPaths = candidate.categoryPaths.filter(path => !coveredPaths.has(categoryPathKey(path)));
    if (newPaths.length === 0) continue;
    selected.push(candidate);
    selectedCodes.add(candidate.card.courseCode);
    for (const path of candidate.categoryPaths) coveredPaths.add(categoryPathKey(path));
  }
  for (const candidate of candidates) {
    if (selected.length >= limit) break;
    if (selectedCodes.has(candidate.card.courseCode)) continue;
    selected.push(candidate);
    selectedCodes.add(candidate.card.courseCode);
  }

  return selected.map(candidate => candidate.card);
}

/** Ask which available subcategories the learner means when only a broad category was chosen. */
export function buildInterestCategoryPrompts(cards, profile = {}) {
  const preferences = readInterestPreferences(profile);
  const terms = new Set([...preferences.interests, ...preferences.preferredKeywords]
    .map(value => String(value).trim().toLocaleLowerCase()));
  const selectedMain = interestTagCatalog.mainCategories.filter(category => (
    terms.has(category.name.trim().toLocaleLowerCase())
  ));
  const selectedSubcategoryIds = new Set(interestTagCatalog.subcategories
    .filter(category => terms.has(category.name.trim().toLocaleLowerCase()))
    .map(category => category.id));
  const availableSubcategories = new Map(interestTagCatalog.subcategories
    .map(category => [category.id, category]));

  return selectedMain.flatMap(main => {
    const alreadySpecific = interestTagCatalog.subcategories.some(category => (
      category.mainCategoryId === main.id && selectedSubcategoryIds.has(category.id)
    ));
    if (alreadySpecific) return [];
    const subcategoryIds = new Set((cards ?? []).flatMap(card => card.tags ?? [])
      .flatMap(tag => tag.categoryPaths ?? [])
      .filter(path => path.mainCategoryId === main.id && path.subcategoryId)
      .map(path => path.subcategoryId));
    const subcategories = [...subcategoryIds]
      .map(id => availableSubcategories.get(id))
      .filter(Boolean)
      .sort((left, right) => left.name.localeCompare(right.name, 'zh-Hant'))
      .map(category => ({ id: category.id, name: category.name }));
    return subcategories.length > 0
      ? [{ mainCategoryId: main.id, mainCategory: main.name, subcategories }]
      : [];
  });
}

/** Build real, active-term exploration cards for the authenticated student's scope. */
export async function getInterestExplorationCards(identity, deps = {}) {
  const profile = deps.loadProfile
    ? await deps.loadProfile(identity)
    : await getUserPreferences(identity);
  const scope = buildStudentScope(profile);
  if (!scope.resolved || !scope.classSuffix) {
    return {
      term: ACTIVE_TERM,
      cards: [],
      categoryPrompts: [],
      emptyReason: 'student_scope_unavailable',
    };
  }

  const courses = deps.loadCourses ? await deps.loadCourses() : await getAll('courses');
  const eligibleSections = filterCategorizedCourses(courses, {}, scope, {
    includeGeneralEducation: true,
    schedulingPool: true,
  });
  const cards = buildInterestExplorationCards(eligibleSections, profile, deps);
  return {
    term: ACTIVE_TERM,
    cards,
    categoryPrompts: buildInterestCategoryPrompts(cards, profile),
    emptyReason: cards.length === 0 ? 'no_eligible_courses' : null,
  };
}

export default {
  INTEREST_EXPLORATION_CARD_LIMIT,
  buildInterestExplorationCards,
  buildInterestCategoryPrompts,
  getInterestExplorationCards,
};
