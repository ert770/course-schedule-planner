// Roadmap #2：前端互動事件的統一送出點。
//
// **最重要的一條規則：記錄失敗絕對不可以影響使用者的操作。** 加選、移除、
// 排課、聊天全部都必須照常完成，互動記錄只是旁路。因此這裡一律 fire-and-forget
// 並把錯誤吞在模組內——呼叫端不需要、也不應該 await 或處理錯誤路徑。
import { interactionsAPI } from './api';

export const INTERACTION_EVENT_TYPES = {
  RECOMMENDATION_EXPOSED: 'recommendation_exposed',
  COURSE_VIEWED: 'course_viewed',
  COURSE_FAVORITED: 'course_favorited',
  COURSE_UNFAVORITED: 'course_unfavorited',
  COURSE_SELECTED: 'course_selected',
  COURSE_DESELECTED: 'course_deselected',
  RECOMMENDATION_ACCEPTED: 'recommendation_accepted',
  COURSE_WITHDRAWN: 'course_withdrawn',
  SCHEDULE_REGENERATED: 'schedule_regenerated',
};

export const INTERACTION_SOURCES = {
  EXPLICIT_SELECTION: 'explicit_selection',
  REQUIRED: 'required',
  SYSTEM_RECOMMENDATION: 'system_recommendation',
  EXPLORATION: 'exploration',
};

// 與後端 `interactionEventSchema.js` 的 `INTERACTION_FEEDBACK_REASONS` 一一對應。
// 中文只是顯示文字，送出的一律是 enum 值，不收自由文字。
export const REMOVAL_REASONS = [
  { value: 'time', label: '時間衝突／時段不合' },
  { value: 'content', label: '課程內容不感興趣' },
  { value: 'instructor', label: '授課教師因素' },
  { value: 'workload', label: '課業負擔太重' },
  { value: 'full', label: '人數已滿' },
  { value: 'eligibility', label: '不符修課資格' },
  { value: 'other', label: '其他原因' },
];

export const INTERACTION_SURFACES = {
  DASHBOARD: 'dashboard',
  SCHEDULE: 'schedule',
  SEARCH: 'search',
  CHAT: 'chat',
};

export const INTERACTION_TRIGGERS = {
  INITIAL_LOAD: 'initial_load',
  MANUAL_GENERATE: 'manual_generate',
  PREFERENCE_REGENERATE: 'preference_regenerate',
  CHAT_TOOL: 'chat_tool',
  COURSE_SEARCH: 'course_search',
};

export function newUuid() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // 舊瀏覽器或非安全環境沒有 randomUUID。退回 v4 形狀的隨機值，格式與後端
  // validator 相同；只是識別碼，不是加密用途。
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/gu, char => {
    const random = Math.floor(Math.random() * 16);
    const value = char === 'x' ? random : (random % 4) + 8;
    return value.toString(16);
  });
}

// 一次 logical UI action 一個 ID。React 重送同一個操作時要沿用同一個值，
// 後端才能以 `(subject, idempotencyKey)` 判為 duplicate 而不是兩次操作。
export const newActionId = newUuid;

export function hasPersonalizationConsent(privacyStatus) {
  return privacyStatus?.consents?.personalization_learning?.granted === true;
}

// 課程物件 → #29 的 course ref。缺任一項就回 null，讓呼叫端知道這筆事件
// 不該送出，而不是送一個補了空值的假資料上去。
export function courseRef(course) {
  const sectionId = Number(course?.sectionId ?? course?.id);
  const catalogCourseCode = course?.catalogCourseCode;
  if (!Number.isInteger(sectionId) || sectionId <= 0) return null;
  if (typeof catalogCourseCode !== 'string' || !catalogCourseCode.trim()) return null;
  return { catalogCourseCode, sectionId };
}

// 課程的學年學期。後端 `mapCourseRow()` 用 `course.year`；`annotateTerm()` 會另外
// 附上 `course.term`。兩者都讀，都沒有就回 null（缺資料不猜）。
export function courseTerm(course) {
  const academicYear = Number(course?.term?.academicYear ?? course?.year ?? course?.academicYear);
  const semester = course?.term?.semester ?? course?.semester ?? null;
  if (!Number.isInteger(academicYear) || academicYear <= 0 || !semester) return null;
  return { academicYear, semester };
}

// 這門課在課表裡是「系統推薦」「使用者自己加的」還是「必修」。
// 標錯就等於 label 錯，#30 會往相反方向學。
//
// 對抗式審查發現：原本用 `course.category === '必修'` 判定，但那個欄位代表
// 「某個系所的必修」，不是「這位學生的必修」——`server/src/skills/scheduler.js`
// 自己就有 `isRequiredForStudent()` 這道判定，並在 `CATEGORY_PRIORITY` 那裡
// 明講：非本人系所年級的必修要降級成一般選修。跨系必修、或使用者手動加選的
// 課，只因為 catalog 分類剛好是「必修」就被誤標成 `source=required`，會把
// 不是「不得不接受」的課也算進必修訊號，正是 #29 驗收標準要避免的那種混淆。
//
// 改讀 `course.formallyRequired`——這是 `scheduler.js` 的 `addCourseToPlan()`
// 已經算好、隨每門排入課表的課一起回傳的欄位，值就是 `isRequiredForStudent()`
// 的結果。只有排課引擎親自產生的課表才有這個欄位；使用者從搜尋手動加入的課
// 沒有（`undefined`），自然落到後面的判定，不會被誤標。
export function courseSource(course, { systemRecommendedIds } = {}) {
  if (course?.formallyRequired === true) return INTERACTION_SOURCES.REQUIRED;
  const id = String(course?.sectionId ?? course?.id ?? '');
  if (systemRecommendedIds?.has(id)) return INTERACTION_SOURCES.SYSTEM_RECOMMENDATION;
  return INTERACTION_SOURCES.EXPLICIT_SELECTION;
}

// 把一次排課回應整理成「這一次推薦」的描述，供後續事件引用。
// `systemRecommendedIds` 是判斷 source 的依據——同一門課由系統排入與由使用者
// 手動加入，對 #30 是完全不同的訊號。
export function buildRecommendation(result) {
  if (!result?.requestId) return null;
  const primary = Array.isArray(result.plans) ? result.plans[0] : null;
  return {
    requestId: result.requestId,
    planId: primary?.planId ?? null,
    variantId: primary?.variantId ?? null,
    systemRecommendedIds: new Set(
      (result.schedule || []).map(course => String(course?.id ?? course?.sectionId ?? ''))
    ),
  };
}

// 回傳值**永不 reject**，讓不在意結果的呼叫端可以直接忽略（fire-and-forget）。
//
// 但「忽略結果」不等於「可以假設寫入成功」。確認列會用這個結果決定要對使用者
// 說什麼——未同意個人化時根本不會發出請求、寫入失敗時錯誤被吞掉，兩種情況下
// 都宣稱「已記錄，未來推薦會參考」就是騙人。
export function logInteraction(events, privacyStatus) {
  if (!hasPersonalizationConsent(privacyStatus)) {
    return Promise.resolve({ recorded: false, reason: 'CONSENT_OFF' });
  }
  const payload = (Array.isArray(events) ? events : [events]).filter(Boolean);
  if (payload.length === 0) {
    return Promise.resolve({ recorded: false, reason: 'NOTHING_TO_SEND' });
  }

  return interactionsAPI.record(payload).catch(err => {
    // 刻意只留下 console 訊息。互動記錄是旁路，不該讓使用者看到錯誤，
    // 更不該讓主要操作失敗。
    console.warn('互動記錄未送出（不影響操作）:', err.message);
    return { recorded: false, reason: 'FAILED', message: err.message };
  });
}

// 這批事件是否真的寫進去了。`duplicate` 也算——那代表同一個操作先前已經記錄過。
export function wasRecorded(result) {
  if (!result || result.recorded === false) return false;
  if (typeof result.recorded === 'number') return result.recorded > 0;
  return (result.results || []).some(item => item.status === 'append' || item.status === 'duplicate');
}

// 確認列要對使用者說的話。
//
// **文案必須反映實際發生的事。** 未同意「從互動持續改善個人化」時前端根本不會
// 發出請求；寫入失敗時錯誤被刻意吞掉。這兩種情況下仍宣稱「已記錄，後續推薦會
// 參考這個回饋」就是說了不實的話——旁路可以不擋操作，但不能謊報結果。
export function describeAcceptOutcome(outcome) {
  if (wasRecorded(outcome)) {
    return '已記錄這份課表符合你的需求，後續推薦會參考這個回饋。';
  }
  switch (outcome?.reason) {
    case 'CONSENT_OFF':
      return '已在畫面上標記。你尚未開啟「從互動持續改善個人化」，因此這個回饋不會被儲存，也不會影響後續推薦。';
    case 'NO_PLAN':
      return '已在畫面上標記。這份課表不是這次推薦產生的，沒有可記錄的方案。';
    default:
      return '已在畫面上標記，但回饋沒有送出成功，不會影響後續推薦。';
  }
}

export default { describeAcceptOutcome, logInteraction, newActionId, newUuid, wasRecorded };
