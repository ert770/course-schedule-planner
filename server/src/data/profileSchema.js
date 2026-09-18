import { normalizeBlockedPeriods } from '../utils/periods.js';
import { normalizeDepartment } from '../utils/text.js';
import { extractTags, tagsToFlags } from './preferenceTags.js';
import { normalizeAdmissionYear } from './graduationRuleVersions.js';
import { readInterestPreferences } from './interestPreferences.js';

// Profile 的 canonical shape 永遠標記為這個版本。
//
// **這不是遷移設施，是防呆。** v0→v1 的相容層已於 2026-09-13 整組退役
// （見 `docs/CHANGE_REPORTS/2026-09-13-retire-profile-v0-compatibility.md`）：
// v0 欄位名（`grade`／`maxCredits`／`avoidTime`）在這個專案裡已經沒有任何產出者，
// profile 的唯一儲存體 `User_Profiles` 用的是 `grade_level`／`max_credits`／`avoid_time`，
// 而 `mapUserProfileRow()` 輸出的一律是 v1 名稱。版本號留著的理由只有一個：
// `validateProfile()` 據此擋下「繞過 normalize 自己組一份 profile」的呼叫端。
export const PROFILE_SCHEMA_VERSION = 1;

function toFiniteNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function normalizeStringList(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(item => String(item ?? '').trim()).filter(Boolean))];
}

function normalizePreferencesJson(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { schemaVersion: 1, values: {} };
  }
  return {
    schemaVersion: Number.isInteger(Number(value.schemaVersion)) ? Number(value.schemaVersion) : 1,
    values: value.values && typeof value.values === 'object' && !Array.isArray(value.values)
      ? value.values
      : {},
  };
}

export function normalizeProfile(profile = {}) {
  const tags = extractTags(profile) ?? [];
  const interestPreferences = readInterestPreferences(profile);
  const normalized = {
    ...profile,
    schemaVersion: PROFILE_SCHEMA_VERSION,
    department: profile.department == null ? null : normalizeDepartment(profile.department),
    gradeLevel: toFiniteNumber(profile.gradeLevel, null),
    className: String(profile.className ?? '').trim() || null,
    // 入學年度（民國學年度）。決定套用哪一版畢業規則（Roadmap #23）。
    // 未提供時為 null＝未知，**不從 gradeLevel 推導**：推導值與使用者填的值
    // 一旦混在同一個欄位就再也分不出來，規則版本也就無從標示可信度。
    admissionYear: normalizeAdmissionYear(profile.admissionYear),
    targetCreditsMin: toFiniteNumber(profile.targetCreditsMin, 12),
    // 這兩個欄位曾經各帶一個 v0 別名（`?? profile.maxCredits`、`?? profile.avoidTime`）。
    // 三組別名（含 `grade`）已於 2026-09-13 一起移除：這支函式正規化的是 **profile**，
    // 而 profile 的唯一儲存體 `User_Profiles` 經 `mapUserProfileRow()` 出來一律是 v1 名稱，
    // 沒有任何產出者會送 v0 名稱進來。
    //
    // **`maxCredits` 不是單純的 v0 遺跡，要分清楚**：它同時是 constraints 命名空間裡
    // 活著的公開參數（`POST /api/schedule/generate` 與 Agent 的 `run_csp_scheduler`），
    // 兩個命名空間由 `services/constraintService.js` 銜接。移除的只是「把 constraints
    // 形狀的物件當 profile 正規化」這條沒人走的路，constraints 那邊完全不受影響。
    targetCreditsMax: toFiniteNumber(profile.targetCreditsMax, 25),
    blockedPeriods: normalizeBlockedPeriods(profile.blockedPeriods ?? []),
    preferenceTags: tags,
    selectedTags: tags,
    preferredCategories: tags,
    courseHistory: Array.isArray(profile.courseHistory) ? profile.courseHistory : [],
    // #13D 目前只接資料，不替尚未取得的正式適用規則下結論。
    programType: String(profile.programType ?? '').trim() || null,
    enrolledPrograms: normalizeStringList(profile.enrolledPrograms),
    college: String(profile.college ?? '').trim() || null,
    mustTakeCourses: Array.isArray(profile.mustTakeCourses) ? profile.mustTakeCourses : [],
    avoidInstructors: normalizeStringList(profile.avoidInstructors),
    preferencesJson: normalizePreferencesJson(profile.preferencesJson),
    ...interestPreferences,
    ...tagsToFlags(tags),
  };

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
  if (profile.programType !== null && typeof profile.programType !== 'string') {
    errors.push('programType 必須是字串或 null');
  }
  if (profile.college !== null && typeof profile.college !== 'string') {
    errors.push('college 必須是字串或 null');
  }
  if (!Array.isArray(profile.enrolledPrograms)) errors.push('enrolledPrograms 必須是陣列');
  if (!Array.isArray(profile.mustTakeCourses)) errors.push('mustTakeCourses 必須是陣列');
  if (!Array.isArray(profile.avoidInstructors)) errors.push('avoidInstructors 必須是陣列');
  if (profile.preferredTrack !== null && typeof profile.preferredTrack !== 'string') {
    errors.push('preferredTrack 必須是字串或 null');
  }
  if (!Array.isArray(profile.interests)) errors.push('interests 必須是陣列');
  if (!Array.isArray(profile.preferredKeywords)) errors.push('preferredKeywords 必須是陣列');
  if (!profile.preferencesJson || typeof profile.preferencesJson !== 'object' || Array.isArray(profile.preferencesJson)) {
    errors.push('preferencesJson 必須是物件');
  }
  return { valid: errors.length === 0, errors };
}

// `migrateProfileV0ToV1()` 已於 2026-09-13 移除。它從誕生起就沒有生產呼叫端，
// 而且輸出**恆等於** `normalizeProfile()`——`normalizeProfile()` 本來就無條件寫入
// `schemaVersion: PROFILE_SCHEMA_VERSION`，那層 spread 是多餘的。需要正規化任何
// 來源的 profile 時直接呼叫 `normalizeProfile()`。

export default {
  PROFILE_SCHEMA_VERSION,
  normalizeProfile,
  validateProfile,
};
