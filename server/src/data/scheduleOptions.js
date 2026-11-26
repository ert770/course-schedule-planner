import { normalizeBlockedPeriods } from '../utils/periods.js';
import { normalizePreferencesJson } from './interestPreferences.js';

export const SCHEDULE_CATEGORIES = Object.freeze(['必修', '核心選修', '一般選修', '通識', '系外選修']);
const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const int = (value, min = 0, max = 30) => Number.isInteger(value) && value >= min && value <= max;
const instructor = value => typeof value === 'string' && value.trim().length > 0 && value.trim().length <= 80;
const names = values => values.filter(instructor).map(value => value.trim());
const categories = values => values.filter(value => SCHEDULE_CATEGORIES.includes(value));
const periods = values => normalizeBlockedPeriods(values);
const ids = values => values.filter(value => Number.isSafeInteger(value) && value > 0);
const timePriority = ['NO_MORNING_CLASSES', 'LUNCH_BREAK_FREE', 'AVOID_INSTRUCTOR', 'NO_EVENING_CLASSES'];

const listRules = {
  allowedPeriods: periods, preferredPeriods: periods,
  preferredInstructors: names, avoidInstructors: names, includeInstructors: names,
  includeCategories: categories, excludeCategories: categories, preferCategories: categories,
  requiredSectionIds: ids, excludedSectionIds: ids,
  timePreferencePriority: values => values.filter(value => timePriority.includes(value)),
};

export function normalizeScheduleOptions(source) {
  if (!isRecord(source)) return {};
  const options = {};
  for (const key of ['minCredits', 'maxCredits', 'maxCoursesPerDay', 'courseCredits', 'preferredCourseCredits']) {
    if (source[key] === null || int(source[key], key === 'minCredits' || key === 'courseCredits' || key === 'preferredCourseCredits' ? 0 : 1)) {
      options[key] = source[key];
    }
  }
  if (source.noEveningClasses === null || typeof source.noEveningClasses === 'boolean') {
    options.noEveningClasses = source.noEveningClasses;
  }
  if ([null, 'English', '中文 (Chinese)'].includes(source.language)) options.language = source.language;
  for (const [key, normalize] of Object.entries(listRules)) {
    if (!Array.isArray(source[key])) continue;
    const values = [...new Set(normalize(source[key]))];
    if (!source[key].length || values.length) options[key] = values;
  }
  if (Array.isArray(source.categoryQuotas)) {
    const quotas = new Map();
    for (const item of source.categoryQuotas) {
      if (!isRecord(item) || !SCHEDULE_CATEGORIES.includes(item.category)) continue;
      const bounds = Object.fromEntries(['minCourses', 'maxCourses', 'minCredits', 'maxCredits']
        .filter(key => int(item[key])).map(key => [key, item[key]]));
      if (Object.keys(bounds).length) {
        quotas.set(item.category, { ...quotas.get(item.category), category: item.category, ...bounds });
      }
    }
    if (!source.categoryQuotas.length || quotas.size) options.categoryQuotas = [...quotas.values()];
  }
  return options;
}

export function readScheduleOptions(profile = {}) {
  const { values } = normalizePreferencesJson(profile?.preferencesJson);
  return normalizeScheduleOptions(profile?.scheduleOptions ?? values.scheduleOptions);
}

export function mergeScheduleOptions(preferencesJson, updates) {
  const current = normalizePreferencesJson(preferencesJson);
  return {
    ...current,
    values: {
      ...current.values,
      scheduleOptions: { ...readScheduleOptions({ preferencesJson: current }), ...normalizeScheduleOptions(updates) },
    },
  };
}

const normalizedName = value => String(value ?? '').trim().toLocaleLowerCase();
export const scheduleCategory = course => course.category === '選修' ? '一般選修' : course.category;
export const matchesScheduleInstructor = (course, instructors) => instructors.some(name =>
  normalizedName(name) === normalizedName(course.instructor ?? course.teacher));

function matchesPeriods(blocks, periods, every = true) {
  if (!blocks.length) return false;
  const matchesBlock = ({ dayOfWeek, startPeriod, endPeriod }) => {
    for (let period = startPeriod; period <= (endPeriod ?? startPeriod); period++) {
      if (!periods.some(slot => slot.day === Number(dayOfWeek) && slot.period === Number(period))) return false;
    }
    return true;
  };
  return every ? blocks.every(matchesBlock) : blocks.some(matchesBlock);
}

export function scheduleOptionCourseViolation(course, options = {}, blocks = [], required = false) {
  if (options.excludedSectionIds?.includes(Number(course.sectionId ?? course.id))) return '該班次已指定不排';
  if (options.allowedPeriods?.length && !matchesPeriods(blocks, options.allowedPeriods)) return '上課時間不在指定時段';
  if (required && options.excludeCategories?.includes('必修')) return '必修課與指定避開的類別衝突';
  if (required) return null;
  const category = scheduleCategory(course);
  if (options.includeCategories?.length && !options.includeCategories.includes(category)) return '課程類別不在指定範圍';
  if (options.excludeCategories?.includes(category)) return '課程類別已指定不排';
  if (options.includeInstructors?.length && !matchesScheduleInstructor(course, options.includeInstructors)) return '授課教師不在指定範圍';
  if (Number.isInteger(options.courseCredits) && Number(course.credits) !== options.courseCredits) return '課程學分不符';
  if (options.language === 'English' && !/english|英語|英文/u.test(String(course.language ?? '').toLowerCase())) return '課程授課語言不符';
  if (options.language === '中文 (Chinese)' && !/chinese|中文|華語/u.test(String(course.language ?? '').toLowerCase())) return '課程授課語言不符';
  return null;
}

export const SCHEDULE_OPTION_SCORE = 600;

export function scheduleOptionRankingCount(options = {}) {
  return [options.preferCategories?.length, options.preferredInstructors?.length, options.preferredPeriods?.length,
    Number.isInteger(options.preferredCourseCredits)].filter(Boolean).length;
}

export function scheduleOptionScore(course, options = {}, blocks = []) {
  return SCHEDULE_OPTION_SCORE * [
    options.preferCategories?.includes(scheduleCategory(course)),
    matchesScheduleInstructor(course, options.preferredInstructors ?? []),
    Number.isInteger(options.preferredCourseCredits) && Number(course.credits) === options.preferredCourseCredits,
    options.preferredPeriods?.length && matchesPeriods(blocks, options.preferredPeriods),
  ].filter(Boolean).length;
}

export function categoryQuotaStatus(courses, quotas = []) {
  return quotas.map(quota => {
    const selected = courses.filter(course => scheduleCategory(course) === quota.category && course.scheduleState !== 'watching');
    return {
      ...quota, courses: selected.length,
      credits: selected.reduce((sum, course) => sum + (Number(course.credits) || 0), 0),
    };
  });
}

export function categoryQuotaViolations(courses, quotas, { checkMinimum = true } = {}) {
  return categoryQuotaStatus(courses, quotas).flatMap(quota =>
    [['courses', 'Courses', '門'], ['credits', 'Credits', '學分']].flatMap(([actual, suffix, unit]) => {
      const minimum = quota['min' + suffix];
      const maximum = quota['max' + suffix];
      if (checkMinimum && quota[actual] < minimum) return [`${quota.category}需要至少 ${minimum} ${unit}，目前只有 ${quota[actual]}`];
      if (quota[actual] > maximum) return [`${quota.category}最多 ${maximum} ${unit}，目前有 ${quota[actual]}`];
      return [];
    }));
}
