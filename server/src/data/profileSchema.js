import { normalizeBlockedPeriods } from '../utils/periods.js';
import { normalizeDepartment } from '../utils/text.js';
import { extractTags, tagsToFlags } from './preferenceTags.js';

export const PROFILE_SCHEMA_VERSION = 1;

function toFiniteNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

export function normalizeProfile(profile = {}) {
  const tags = extractTags(profile) ?? [];
  const normalized = {
    ...profile,
    schemaVersion: PROFILE_SCHEMA_VERSION,
    department: profile.department == null ? null : normalizeDepartment(profile.department),
    gradeLevel: toFiniteNumber(profile.gradeLevel ?? profile.grade, null),
    className: String(profile.className ?? '').trim() || null,
    targetCreditsMin: toFiniteNumber(profile.targetCreditsMin, 12),
    targetCreditsMax: toFiniteNumber(profile.targetCreditsMax ?? profile.maxCredits, 25),
    blockedPeriods: normalizeBlockedPeriods(profile.blockedPeriods ?? profile.avoidTime ?? []),
    preferenceTags: tags,
    selectedTags: tags,
    preferredCategories: tags,
    courseHistory: Array.isArray(profile.courseHistory) ? profile.courseHistory : [],
    ...tagsToFlags(tags),
  };

  delete normalized.grade;
  delete normalized.avoidTime;
  return normalized;
}

export function validateProfile(profile) {
  const errors = [];
  if (!profile || typeof profile !== 'object' || Array.isArray(profile)) {
    return { valid: false, errors: ['Profile 必須是物件'] };
  }
  if (profile.schemaVersion !== PROFILE_SCHEMA_VERSION) {
    errors.push(`schemaVersion 必須是 ${PROFILE_SCHEMA_VERSION}`);
  }
  if (profile.department !== null && typeof profile.department !== 'string') {
    errors.push('department 必須是字串或 null');
  }
  if (profile.gradeLevel !== null && !Number.isFinite(profile.gradeLevel)) {
    errors.push('gradeLevel 必須是數字或 null');
  }
  if (!Array.isArray(profile.courseHistory)) errors.push('courseHistory 必須是陣列');
  if (!Array.isArray(profile.blockedPeriods)) errors.push('blockedPeriods 必須是陣列');
  return { valid: errors.length === 0, errors };
}

export function migrateProfileV0ToV1(profile = {}) {
  return normalizeProfile({ ...profile, schemaVersion: PROFILE_SCHEMA_VERSION });
}

export default {
  PROFILE_SCHEMA_VERSION,
  normalizeProfile,
  validateProfile,
  migrateProfileV0ToV1,
};
