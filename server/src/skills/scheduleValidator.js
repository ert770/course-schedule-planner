// Roadmap #21：與方案產生器分離的最終課表 validator。
//
// `scheduler.js` 的 `validateSchedule()` 只檢查衝堂與重複班次，是既有的
// 公開契約（`POST /api/schedule/validate` 沿用至今，`client/src` 未呼叫
// 但仍是文件記載的公開介面）——本檔案不取代它，而是新增一層檢查完整硬性
// 限制範圍的獨立 validator：`generateSchedule()` 每次成功回應前都會用它
// 對自己的主推方案做內部自我檢查（見 `scheduler.js` 的 `selfCheck`），
// `/validate` route 在請求帶有 `constraints` 時也會額外呼叫它，回應以
// 附加欄位呈現，不動既有欄位。
//
// **這裡刻意不套用 roadmap #21 的必修對時段偏好豁免**（`exemptForRequiredCourses`）
// ——那個豁免只在 `scheduler.js` 建構方案的當下才有 scope／是否為這位學生
// 必修的判斷可用；本檔案是對「字面上給定的課表」做檢查，沒有這個上下文，
// 也不該用猜的。

import {
  timeConflict,
  getCourseKey,
  hardConstraintReason,
  constraintIdForHardReason,
  collectExplicitCourseIds,
  DEFAULT_MAX_CREDITS,
  OVERLOAD_MAX_CREDITS,
} from './scheduler.js';
import { getPassedCourseCodes } from '../data/courseHistory.js';
import { CONSTRAINTS } from '../data/constraintSchema.js';

function courseRef(course) {
  return { id: course.id, name: course.name };
}

function buildViolation(constraintId, courses, reason) {
  const def = CONSTRAINTS[constraintId];
  return {
    constraintId,
    severity: 'hard',
    relaxable: def?.relaxable ?? null,
    source: def?.source ?? null,
    confidence: def?.confidence ?? null,
    courses,
    reason,
  };
}

// 兩兩比對衝堂，並偵測同一門課的重複班次——與 `validateSchedule()` 完全
// 相同的演算法，重用 `timeConflict`／`getCourseKey`，不重新實作一份。
function checkTimeConflictsAndDuplicates(schedule) {
  const violations = [];

  for (let i = 0; i < schedule.length; i += 1) {
    for (let j = i + 1; j < schedule.length; j += 1) {
      if (timeConflict(schedule[i], schedule[j])) {
        violations.push(buildViolation(
          'TIME_CONFLICT',
          [courseRef(schedule[i]), courseRef(schedule[j])],
          `「${schedule[i].name}」與「${schedule[j].name}」衝堂`
        ));
      }
    }
  }

  const seenByKey = new Map();
  for (const course of schedule) {
    const key = getCourseKey(course);
    const first = seenByKey.get(key);
    if (first) {
      violations.push(buildViolation(
        'DUPLICATE_SECTION',
        [courseRef(first), courseRef(course)],
        `「${course.name}」排入了同一門課的兩個班次`
      ));
      continue;
    }
    seenByKey.set(key, course);
  }

  return violations;
}

// 學分上限一律有預設值可用（未指定 maxCredits 時比照 scheduler.js 的
// defaultMaxCredits() 規則），因此這項檢查永遠會執行，不必列進 unchecked。
function checkCreditCeiling(schedule, constraints) {
  const maxCredits = constraints.maxCredits
    ?? (constraints.allowCreditOverload ? OVERLOAD_MAX_CREDITS : DEFAULT_MAX_CREDITS);
  const totalCredits = schedule.reduce((sum, course) => sum + (course.credits || 0), 0);

  if (totalCredits <= maxCredits) return [];

  return [buildViolation(
    'CREDIT_CEILING',
    schedule.map(courseRef),
    `課表共 ${totalCredits} 學分，超過上限 ${maxCredits} 學分`
  )];
}

// 對每門課已附帶的 metadata 做安全網式複查（資格、學期、系外選修認列、
// 已修過）。正常情況下這些理論上不該對 `generateSchedule()` 自己產出的
// 課表觸發——存在的目的是攔截外部提供的課表（例如經由 `/validate`）。
//
// **ELIGIBILITY_UNKNOWN／OFF_TERM／OUTSIDE_ELECTIVE_INELIGIBLE 有
// `overridableBy: USER_EXPLICIT_SELECTION`**（見 `constraintSchema.js`）：
// `prepareCandidates()` 早已把這件事當成既有、刻意的行為——使用者明確指定
// 的課即使資格未知或非本學期也會保留並排入，只附警告，不算失敗。這裡若
// 不比照跳過，會把 `generateSchedule()` 自己允許通過的正常結果誤判成
// 內部一致性錯誤（見 X12 之前一版曾經誤傷 #13B／#20 的既有測試）。
// `ALREADY_TAKEN_PASSED` 沒有 `overridableBy`，不受此豁免影響。
function checkCourseMetadata(schedule, constraints) {
  const violations = [];
  const completedCodes = new Set(getPassedCourseCodes(constraints.courseHistory));
  const explicitIds = collectExplicitCourseIds(constraints);

  for (const course of schedule) {
    const isExplicit = explicitIds.has(Number(course.id));

    if (!isExplicit && course.eligibility === 'unknown') {
      violations.push(buildViolation(
        'ELIGIBILITY_UNKNOWN',
        [courseRef(course)],
        course.eligibilityReason || `「${course.name}」資格待確認`
      ));
    }

    if (!isExplicit && course.term && course.term.isActiveTerm === false) {
      violations.push(buildViolation(
        'OFF_TERM',
        [courseRef(course)],
        course.scopeReason || `「${course.name}」非本學期開課`
      ));
    }

    if (!isExplicit && course.outsideElectiveRecognized === false) {
      violations.push(buildViolation(
        'OUTSIDE_ELECTIVE_INELIGIBLE',
        [courseRef(course)],
        (course.outsideElectiveReasons && course.outsideElectiveReasons[0])
          || `「${course.name}」不符合系外選修認列條件`
      ));
    }

    if (course.catalogCourseCode && completedCodes.has(course.catalogCourseCode)) {
      violations.push(buildViolation(
        'ALREADY_TAKEN_PASSED',
        [courseRef(course)],
        `「${course.name}」已修過並通過（課號 ${course.catalogCourseCode}）`
      ));
    }
  }

  return violations;
}

// 4 個時段類硬性限制，重用 `hardConstraintReason()`。
//
// **必修豁免只在課程物件本身已標記 `formallyRequired: true` 時才生效**——
// 這個欄位由 `addCourseToPlan()` 在排入當下寫入（見 scheduler.js），代表
// 「排課引擎當時確實依 isRequiredForStudent() 判定過，且真的套用了豁免」。
// 本檔案沒有 scope 可用，不會自己重新猜測哪些課是必修；沒有這個標記的
// 課程（包含所有外部直接提供給 `/validate` 的課表）一律照嚴格規則檢查，
// 這是刻意保守的預設值，不是遺漏。
function checkTimePreferences(schedule, constraints) {
  const violations = [];

  for (const course of schedule) {
    const skipTimePreferences = course.formallyRequired === true;
    const reason = hardConstraintReason(course, constraints, { skipTimePreferences });
    if (!reason) continue;

    const constraintId = constraintIdForHardReason(reason) || 'BLOCKED_PERIODS';
    violations.push(buildViolation(constraintId, [courseRef(course)], `「${course.name}」${reason}`));
  }

  return violations;
}

// 必修／必排課程涵蓋率只在 `constraints` 真的帶有這項資料時才檢查；
// 沒帶時不當成「已通過」，回傳 checked:false 讓呼叫端列進 unchecked。
function checkRequiredCoverage(schedule, constraints) {
  const hasRequiredIdsInfo = Array.isArray(constraints.mustTakeCourseIds)
    || Array.isArray(constraints.selectedCourseIds);
  if (!hasRequiredIdsInfo) {
    return { violations: [], checked: false };
  }

  const requiredIds = new Set([
    ...(constraints.mustTakeCourseIds || []),
    ...(constraints.selectedCourseIds || []),
  ].map(Number));
  const scheduledIds = new Set(schedule.map(course => Number(course.id)));
  const missing = [...requiredIds].filter(id => !scheduledIds.has(id));

  if (missing.length === 0) return { violations: [], checked: true };

  return {
    violations: [buildViolation(
      'REQUIRED_COURSE_COVERAGE',
      [],
      `指定必排課程 ID ${missing.join('、')} 未出現在課表中`
    )],
    checked: true,
  };
}

// roadmap #15：對「字面上給定的課表」複查——若某課帶 corequisiteRole，
// 其搭檔的 catalogCourseCode 必須也出現在同一張課表中，否則代表
// buildPlan() 的配對邏輯本身有 bug，或這是一份外部直接提供給 /validate
// 的不合法課表。`corequisiteRole`／`corequisiteCode` 由 `prepareCandidates()`
// 附加、經 `addCourseToPlan()` 的展開語法帶進 schedule，不需要重新推導；
// 與 checkTimePreferences() 一樣不套用必修豁免——這裡沒有 scope 可用。
//
// Codex adversarial review 修正（2026-08-20）：`corequisiteRole` 只會出現
// 在 `generateSchedule()` 自己產出、走過 `prepareCandidates()` 的課表上。
// 外部直接呼叫 `/validate` 送進來的原始課程物件（例如把 `generateSchedule()`
// 產出的一組配對課表拿掉其中一半再送回來驗證）完全沒有這個欄位可讀，
// 本函式不會、也不該憑 `catalogCourseCode` 的 `P` 後綴自行「猜」哪些課
// 應該配對——`BUS1121P`／`HY2073P` 這種找不到正課的真實例外若被猜錯，
// 反而會把合法課表誤判成違規。比照 checkRequiredCoverage() 的既有作法：
// 沒有任何一門課帶 corequisiteRole 時，回傳 checked:false，讓呼叫端把
// 這項規則列進 unchecked，誠實回報「沒有可信的配對資訊、沒有檢查」，
// 而不是悄悄回傳 valid:true 讓人誤以為配對規則有被驗證過。
function checkCorequisitePairs(schedule) {
  const hasTrustworthyAnnotations = schedule.some(course => course.corequisiteRole);
  if (!hasTrustworthyAnnotations) {
    return { violations: [], checked: false };
  }

  const violations = [];
  const codesPresent = new Set(
    schedule.map(course => String(course.catalogCourseCode || '').trim()).filter(Boolean)
  );

  for (const course of schedule) {
    if (!course.corequisiteRole || !course.corequisiteCode) continue;
    if (codesPresent.has(course.corequisiteCode)) continue;

    const missingLabel = course.corequisiteRole === 'internship' ? '正課' : '實習';
    violations.push(buildViolation(
      'COREQUISITE_PAIR_INCOMPLETE',
      [courseRef(course)],
      `「${course.name}」的對應${missingLabel}（課號 ${course.corequisiteCode}）未出現在課表中`
    ));
  }

  return { violations, checked: true };
}

// 與方案產生器分離的最終課表 validator（roadmap #21）。
//
// checks 2（學分上限）、4（時段類硬性限制）、5（必修涵蓋率）需要 `constraints`
// 才有意義；checks 1（衝堂／重複班次）與 3（資格／學期／系外選修／已修過的
// metadata 複查）只讀課程物件本身，即使 `constraints` 為 `{}` 也能運作。
export function validateScheduleAgainstConstraints(schedule = [], constraints = {}) {
  const { violations: coverageViolations, checked: coverageChecked } = checkRequiredCoverage(
    schedule, constraints
  );
  const { violations: corequisiteViolations, checked: corequisiteChecked } = checkCorequisitePairs(
    schedule
  );

  const violations = [
    ...checkTimeConflictsAndDuplicates(schedule),
    ...checkCourseMetadata(schedule, constraints),
    ...checkCreditCeiling(schedule, constraints),
    ...checkTimePreferences(schedule, constraints),
    ...corequisiteViolations,
    ...coverageViolations,
  ];

  // 先修／共修完全沒有資料來源可查（見 `constraintSchema.js` 的說明），
  // `unchecked` 從 schema 的 `enforced:false` 條目組成，而不是寫死的陣列——
  // 未來若有其他限制被標成 enforced:false，這裡會自動反映，不必回頭改。
  const unchecked = Object.values(CONSTRAINTS)
    .filter(def => def.enforced === false)
    .map(def => def.id);
  if (!coverageChecked) unchecked.push('REQUIRED_COURSE_COVERAGE');
  if (!corequisiteChecked) unchecked.push('COREQUISITE_PAIR_INCOMPLETE');

  return {
    valid: violations.length === 0,
    violations,
    unchecked,
  };
}

export default { validateScheduleAgainstConstraints };
