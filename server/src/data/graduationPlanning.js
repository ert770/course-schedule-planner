import { ACTIVE_TERM, normalizeSemesterLabel } from './activeTerm.js';
import { getEarnedCredits, getTotalEarnedCredits } from './courseHistory.js';
import { resolveGraduationRule } from './graduationRuleVersions.js';
import { normalizeRemainingSemesters } from './semesterPlanningPreferences.js';

export const GRADUATION_BUCKETS = Object.freeze([
  'required', 'elective', 'general', 'external', 'unspecified',
]);

export function toCreditBreakdown(requirement) {
  if (!requirement) return null;
  return {
    required: Number(requirement.deptRequired) || 0,
    elective: Number(requirement.deptElective) || 0,
    general: (Number(requirement.generalBasic) || 0) + (Number(requirement.generalElective) || 0),
    external: Number(requirement.outsideElective) || 0,
    unspecified: Number(requirement.unspecified) || 0,
  };
}

export function resolveRequiredCredits(requirement) {
  if (!requirement) {
    return { required: null, totalRequired: null, warning: '此系所不存在，請檢查是否輸入錯誤' };
  }
  return {
    required: toCreditBreakdown(requirement),
    totalRequired: requirement.total ?? null,
    warning: null,
  };
}

export function inferRemainingSemesters(profile = {}, activeTerm = ACTIVE_TERM) {
  const explicit = normalizeRemainingSemesters(profile.remainingSemesters);
  if (explicit !== null) return { value: explicit, source: 'profile' };

  const gradeLevel = Number(profile.gradeLevel);
  const semester = normalizeSemesterLabel(activeTerm?.semester);
  if (!Number.isInteger(gradeLevel) || gradeLevel < 1 || gradeLevel > 4 || semester === null) {
    return { value: null, source: 'unknown' };
  }

  const value = Math.max(1, (4 - gradeLevel) * 2 + (semester === 'first' ? 2 : 1));
  return { value, source: 'grade-and-active-term' };
}

export function buildGraduationPlanning(profile = {}, activeTerm = ACTIVE_TERM) {
  const rule = resolveGraduationRule({
    program: profile.department,
    admissionYear: profile.admissionYear ?? null,
  });
  const { required, totalRequired, warning } = resolveRequiredCredits(rule.requirement);
  const courseHistoryAvailable = Array.isArray(profile.courseHistory) && profile.courseHistory.length > 0;
  const earned = courseHistoryAvailable ? getEarnedCredits(profile.courseHistory) : null;
  const totalEarned = courseHistoryAvailable ? getTotalEarnedCredits(profile.courseHistory) : null;
  const gaps = courseHistoryAvailable && required
    ? Object.fromEntries(Object.entries(required).map(([key, value]) => [
      key, Math.max(0, Number(value || 0) - Number(earned[key] || 0)),
    ]))
    : null;
  const remaining = inferRemainingSemesters(profile, activeTerm);
  const enabled = Boolean(gaps && remaining.value);
  const semesterTargets = enabled
    ? Object.fromEntries(['elective', 'general', 'external'].map(key => [
      key, Number(gaps[key] || 0) / remaining.value,
    ]))
    : null;
  const warnings = [];
  if (warning) warnings.push(warning);
  if (!courseHistoryAvailable) warnings.push('缺少歷史修課資料，無法依畢業缺口分配本學期課程。');
  if (remaining.value === null) warnings.push('剩餘學期數無法判定，未啟用畢業缺口配額。');
  if (rule.appliedFallbackVersion && rule.fallbackReason) warnings.push(rule.fallbackReason);

  return {
    enabled,
    rule,
    ruleVersion: rule.ruleVersion,
    ruleSource: rule.ruleSource,
    appliedFallbackVersion: rule.appliedFallbackVersion,
    courseHistoryAvailable,
    totalRequired,
    totalEarned,
    required,
    earned,
    gaps,
    remainingSemesters: remaining.value,
    remainingSemestersSource: remaining.source,
    semesterTargets,
    warnings,
  };
}

export default {
  GRADUATION_BUCKETS,
  toCreditBreakdown,
  resolveRequiredCredits,
  inferRemainingSemesters,
  buildGraduationPlanning,
};
