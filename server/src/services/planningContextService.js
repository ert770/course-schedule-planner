// Chat 的「目前規劃狀態」：把 client 送來的班次 ID 解析成可信的課程事實。
//
// **這一層做的是來源驗證，形狀驗證在 `data/planningContextSchema.js`。**
// 分開的理由與 `profileUpdateValidation.js` 相同：形狀規則是純資料判斷，混進
// 需要資料庫的驗證之後就得起一整個環境才測得動。
//
// ---------------------------------------------------------------------------
// 一條必須守住的分界線
// ---------------------------------------------------------------------------
// 這份資料只能變成兩種東西：
//   (a) 本次排課的 request-scoped 限制；
//   (b) system prompt 裡的事實敘述。
//
// 它**不得**寫入 `Interaction_Events`、不得當成曝光證明、不得放寬
// `record_schedule_feedback` 的來源驗證——那條仍由 `scheduleFeedbackService`
// 對照真實曝光紀錄。使用者的瀏覽器說「系統推薦過這門課」不構成證據。
//
// ---------------------------------------------------------------------------
// 為什麼曝光紀錄只是選用的佐證
// ---------------------------------------------------------------------------
// `recordInteractionEvents()` 在寫入**任何**事件之前先擋個人化同意，
// `recommendation_exposed` 也走那個函式——所以**未同意個人化的使用者根本沒有
// 任何曝光紀錄**。若把「requestId 對得上曝光」當成採用規劃狀態的前提，這個功能
// 對他們會完全失效，而他們正好是移除課程時不會被問原因的那一群
// （`DashboardPage.jsx` 的「不同意的人不該被問」），最需要 Agent 幫忙補原因。
//
// 因此：能不能避開，只看班次在不在 `Courses` 裡；有沒有曝光紀錄只影響**措辭**
// （能不能說「這是系統推薦給你的課」）。
import { getAll } from '../db/database.js';
import { findExposure } from './interactionEventService.js';
import { deriveAvoidanceScope, derivePendingReason } from '../data/planningContextSchema.js';
import { logger } from '../utils/logger.js';

export const PLANNING_CONTEXT_STATUS = Object.freeze({
  ACCEPTED: 'accepted',
  REJECTED_INVALID: 'rejected-invalid',
  TEMPORARILY_UNAVAILABLE: 'temporarily-unavailable',
});

function toResolvedCourse(course, sectionId) {
  return {
    sectionId,
    name: course?.name ?? null,
    catalogCourseCode: course?.catalogCourseCode ?? null,
    instructor: course?.instructor ?? course?.teacher ?? null,
  };
}

/**
 * 解析並佐證一份已通過形狀驗證的規劃狀態。
 *
 * @param identity `resolveIdentity()` 的結果。
 * @param context  `validatePlanningContext()` 的 `value`（可能是 null）。
 * @param deps     `{ loadCourses, findExposure }`，測試用；預設走真實資料來源。
 * @returns `{ status, value }`。`value` 為 null 時代表這一輪不採用規劃狀態。
 */
export async function resolvePlanningContext(identity, context, deps = {}) {
  if (!context) return { status: PLANNING_CONTEXT_STATUS.ACCEPTED, value: null };

  // 外部資料可注入，比照 `executeAgentTool(name, args, ctx, deps)` 的既有作法。
  const loadCourses = deps.loadCourses ?? (() => getAll('courses'));
  const lookupExposure = deps.findExposure ?? findExposure;

  let byId;
  try {
    const courses = await loadCourses();
    byId = new Map(courses.map(course => [String(course.id), course]));
  } catch (err) {
    // 查不到課程資料是**暫時性**問題，不是這份規劃狀態壞掉。回 `rejected-invalid`
    // 會讓前端把仍然有效的避開清單一起清掉，使用者的操作就這樣無聲消失。
    logger.warn(`規劃狀態無法解析課程資料，本回合不採用：${err.message}`, { label: 'AgentCore' });
    return { status: PLANNING_CONTEXT_STATUS.TEMPORARILY_UNAVAILABLE, value: null };
  }

  // 曝光紀錄是選用的佐證。查詢失敗時降級成「沒有佐證」而不是整包不採用——
  // 避開條件本來就不依賴它。
  let exposure = null;
  if (context.requestId) {
    try {
      exposure = await lookupExposure(identity, context.requestId);
    } catch (err) {
      logger.warn(`規劃狀態的曝光佐證查詢失敗，改以無佐證處理：${err.message}`, { label: 'AgentCore' });
    }
  }

  const currentCourses = [];
  for (const entry of context.currentCourses) {
    const course = byId.get(String(entry.sectionId));
    if (!course) continue;
    currentCourses.push(toResolvedCourse(course, entry.sectionId));
  }

  const removedCourses = [];
  for (const entry of context.removedCourses) {
    const course = byId.get(String(entry.sectionId));
    // 查不到就丟掉這一筆，其餘照常——一個無效 ID 不該讓整份規劃狀態失效。
    if (!course) continue;
    removedCourses.push({
      ...toResolvedCourse(course, entry.sectionId),
      reason: entry.reason,
      // `scope` 與 `pendingReason` 一律由 `reason` 重算，不讀 client 送的值。
      scope: deriveAvoidanceScope(entry.reason),
      pendingReason: derivePendingReason(entry.reason),
    });
  }

  // `activePlanId` 只有在曝光佐證存在時才有意義。對不上就忽略這個欄位，
  // 而不是拒絕整份規劃狀態——課表與移除清單仍然是可用的事實。
  const activePlanId = exposure && context.activePlanId
    && exposure.displayedPlanIds.includes(context.activePlanId)
    ? context.activePlanId
    : null;

  return {
    status: PLANNING_CONTEXT_STATUS.ACCEPTED,
    value: {
      requestId: context.requestId,
      activePlanId,
      activeVariantId: exposure ? context.activeVariantId : null,
      currentCourses,
      removedCourses,
      // 有曝光佐證時才能說「這是系統推薦給你的課表」。沒有的時候只能說
      // 「畫面目前的課程」——措辭的差別就是這個布林的全部用途。
      exposureBacked: Boolean(exposure),
      // 哪些班次確實出現在那一次推薦裡。沒有曝光紀錄時為空集合。
      recommendedSectionIds: exposure ? [...exposure.displayedSectionIds] : [],
    },
  };
}

/**
 * 把規劃狀態的移除清單轉成排課限制。
 *
 * 只輸出 `sectionId` 與 `reason`：`scheduleService.resolveSessionAvoidances()`
 * 會再從 `Courses` 解析一次課號與教師，範圍也在那裡依 `reason` 推導。
 * 這裡不預先展開，是為了讓「避開條件怎麼算出來的」只有一個地方說了算。
 */
export function toSessionAvoidances(resolvedContext) {
  if (!resolvedContext?.removedCourses?.length) return [];
  return resolvedContext.removedCourses.map(entry => ({
    sectionId: entry.sectionId,
    reason: entry.reason,
  }));
}

export default { PLANNING_CONTEXT_STATUS, resolvePlanningContext, toSessionAvoidances };
