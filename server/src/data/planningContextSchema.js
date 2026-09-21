// Chat 的「目前規劃狀態」：使用者畫面上留著哪些課、本次移除了哪些課、原因是什麼。
//
// **這個模組是純函式，不碰資料庫。** 需要查 `Courses` 或曝光紀錄的來源驗證放在
// `services/planningContextService.js`——形狀檢查與來源驗證混在一起，前者就沒辦法
// 用一般單元測試釘住（與 `profileUpdateValidation.js` 抽出來的理由相同）。
//
// **這份資料能變成什麼、不能變成什麼**（實作與審查都要守住）：
//   可以 → (a) 本次排課的 request-scoped 限制；(b) system prompt 裡的事實敘述。
//   不可以 → 寫入 `Interaction_Events`、當成曝光證明、放寬 `record_schedule_feedback`
//            的來源驗證（那條仍由 `scheduleFeedbackService` 對照真實曝光紀錄）。
import { INTERACTION_FEEDBACK_REASONS } from './interactionEventSchema.js';

// 沿用 `interactionEventSchema.js` 的同一份值域，不另立一套——退課原因在事件表、
// 前端對話框（`REMOVAL_REASONS`）與這裡必須永遠是同一組字串。
const FEEDBACK_REASON_SET = new Set(Object.values(INTERACTION_FEEDBACK_REASONS));

export const AVOIDANCE_SCOPES = Object.freeze({
  SECTION: 'section',
  CATALOG_COURSE: 'catalog_course',
  INSTRUCTOR: 'instructor',
});

// 一次能帶多少課。上限存在的理由是這份資料會進 system prompt：沒有上限的話，
// 一個壞掉（或惡意）的 client 可以用課號把 prompt 撐爆。25 學分的課表
// 實務上不會超過 15 門，兩倍餘裕已經足夠。
const MAX_COURSES = 30;

/**
 * `reason` → 避開範圍。**保守優先**：只有明確指向「這門課本身」或「這位教師」的
 * 原因才放大範圍，其餘一律只排除那一個班次。
 *
 * - `content`／`workload`：不滿意的是課程本身，換班次沒有意義 → 整個課號。
 * - `instructor`：換教師就解決了 → 只避開該教師。
 * - `time`／`full`／`eligibility`：這些對「課程內容偏好」是中性的（見
 *   `RemoveReasonDialog.jsx` 的說明），同一門課的其他班次仍然合理 → 只排除該班次。
 * - `other`／`null`：沒有可據以放大的資訊 → 只排除該班次。
 */
export function deriveAvoidanceScope(reason) {
  if (reason === INTERACTION_FEEDBACK_REASONS.CONTENT
    || reason === INTERACTION_FEEDBACK_REASONS.WORKLOAD) {
    return AVOIDANCE_SCOPES.CATALOG_COURSE;
  }
  if (reason === INTERACTION_FEEDBACK_REASONS.INSTRUCTOR) {
    return AVOIDANCE_SCOPES.INSTRUCTOR;
  }
  return AVOIDANCE_SCOPES.SECTION;
}

// 原因為 null 代表「還沒問到」，不是「使用者說沒有原因」。未同意個人化的使用者
// 移除課程時不會被問原因（`DashboardPage.jsx` 的「不同意的人不該被問」），
// 這些項目由 Chat Agent 補問，補到之前先保守地只排除該班次。
export function derivePendingReason(reason) {
  return reason === null || reason === undefined;
}

function isPositiveIntegerLike(value) {
  const num = Number(value);
  return Number.isInteger(num) && num > 0;
}

function validateCourseList(raw, field) {
  if (raw === undefined || raw === null) return { error: null, value: [] };
  if (!Array.isArray(raw)) return { error: `planningContext.${field} 必須是陣列` };
  if (raw.length > MAX_COURSES) {
    return { error: `planningContext.${field} 最多 ${MAX_COURSES} 筆` };
  }

  const value = [];
  const seen = new Set();
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      return { error: `planningContext.${field} 的每一筆必須是物件` };
    }
    if (!isPositiveIntegerLike(entry.sectionId)) {
      return { error: `planningContext.${field} 的 sectionId 必須是正整數` };
    }
    const sectionId = Number(entry.sectionId);
    // 同一個班次送兩次沒有額外意義，去重比報錯友善——這不是使用者輸入，
    // 是前端狀態序列化的結果，重覆多半只代表前端有 bug，不該讓對話中斷。
    if (seen.has(sectionId)) continue;
    seen.add(sectionId);

    if (field === 'currentCourses') {
      value.push({ sectionId });
      continue;
    }

    const reason = entry.reason ?? null;
    if (reason !== null && !FEEDBACK_REASON_SET.has(reason)) {
      return { error: `planningContext.${field} 的 reason 不在允許清單` };
    }
    // `scope` 與 `pendingReason` **刻意不從輸入讀取**：兩者都是 `reason` 的函數，
    // 由後端覆算。client 可以自己保存一份供畫面顯示，但不能決定排課範圍——
    // 否則送 `{ reason: 'time', scope: 'catalog_course' }` 就能把「時段不合」
    // 放大成排除整門課。
    value.push({ sectionId, reason, scope: deriveAvoidanceScope(reason), pendingReason: derivePendingReason(reason) });
  }

  return { error: null, value };
}

function isOptionalString(value) {
  return value === undefined || value === null || (typeof value === 'string' && value.length <= 200);
}

/**
 * `POST /api/chat` 的 `planningContext` 形狀驗證。
 *
 * @returns `{ error }` 或 `{ error: null, value }`。`error` 不為 null 時
 *          呼叫端必須**整包丟棄**——不做部分採用，因為半截的規劃狀態會讓
 *          Agent 以為它看到了完整課表。
 */
export function validatePlanningContext(input) {
  if (input === undefined || input === null) return { error: null, value: null };
  if (typeof input !== 'object' || Array.isArray(input)) {
    return { error: 'planningContext 必須是物件' };
  }

  for (const field of ['requestId', 'activePlanId', 'activeVariantId']) {
    if (!isOptionalString(input[field])) {
      return { error: `planningContext.${field} 必須是字串或 null` };
    }
  }

  const current = validateCourseList(input.currentCourses, 'currentCourses');
  if (current.error) return { error: current.error };
  const removed = validateCourseList(input.removedCourses, 'removedCourses');
  if (removed.error) return { error: removed.error };

  return {
    error: null,
    value: {
      requestId: input.requestId ?? null,
      activePlanId: input.activePlanId ?? null,
      activeVariantId: input.activeVariantId ?? null,
      currentCourses: current.value,
      removedCourses: removed.value,
    },
  };
}

export default {
  AVOIDANCE_SCOPES,
  deriveAvoidanceScope,
  derivePendingReason,
  validatePlanningContext,
};
