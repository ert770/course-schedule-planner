import { normalizeBlockedPeriods } from '../utils/periods.js';
import { normalizeDepartment } from '../utils/text.js';
import { extractTags, tagsToFlags } from './preferenceTags.js';
import { normalizeAdmissionYear } from './graduationRuleVersions.js';

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
    // 入學年度（民國學年度）。決定套用哪一版畢業規則（Roadmap #23）。
    // 未提供時為 null＝未知，**不從 gradeLevel 推導**：推導值與使用者填的值
    // 一旦混在同一個欄位就再也分不出來，規則版本也就無從標示可信度。
    admissionYear: normalizeAdmissionYear(profile.admissionYear),
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
  // `normalizeAdmissionYear()` 已把不合法值轉成 null，因此這裡只可能是整數或 null；
  // 仍然檢查，讓「繞過 normalize 直接組出 profile」的呼叫端也會被擋下。
  if (profile.admissionYear !== null && !Number.isInteger(profile.admissionYear)) {
    errors.push('admissionYear 必須是整數學年度或 null');
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
