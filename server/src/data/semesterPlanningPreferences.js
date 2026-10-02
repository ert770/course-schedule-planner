import { normalizePreferencesJson } from './interestPreferences.js';

export const MIN_REMAINING_SEMESTERS = 1;
export const MAX_REMAINING_SEMESTERS = 8;

export function normalizeRemainingSemesters(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  if (!Number.isInteger(number)
    || number < MIN_REMAINING_SEMESTERS
    || number > MAX_REMAINING_SEMESTERS) return null;
  return number;
}

export function readSemesterPlanningPreferences(source = {}) {
  const { values } = normalizePreferencesJson(source?.preferencesJson);
  return {
    remainingSemesters: normalizeRemainingSemesters(
      source?.remainingSemesters ?? values.remainingSemesters
    ),
  };
}

export function mergeSemesterPlanningPreferences(preferencesJson, updates = {}) {
  const next = normalizePreferencesJson(preferencesJson);
  if (!Object.hasOwn(updates, 'remainingSemesters')) return next;

  const values = { ...next.values };
  const normalized = normalizeRemainingSemesters(updates.remainingSemesters);
  if (normalized === null) delete values.remainingSemesters;
  else values.remainingSemesters = normalized;
  return { ...next, values };
}

export const SEMESTER_PLANNING_PREFERENCE_FIELDS = Object.freeze(['remainingSemesters']);

export default {
  MIN_REMAINING_SEMESTERS,
  MAX_REMAINING_SEMESTERS,
  normalizeRemainingSemesters,
  readSemesterPlanningPreferences,
  mergeSemesterPlanningPreferences,
  SEMESTER_PLANNING_PREFERENCE_FIELDS,
};
