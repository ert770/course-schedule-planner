// Roadmap #20：系統層級的「目前學期」設定。
//
// 所有查課／排課／Agent API 必須共用同一個 term，候選課程才不會混進已經過去
// 或尚未開放的學期資料。這是**系統常數**，不接受 per-request 覆寫——
// 「所有查課與排課 API 必須使用同一 term」是 roadmap #20 的明文驗收標準，
// 不是使用者可切換的偏好。
//
// 換學期時的更新方式：改 `ACTIVE_ACADEMIC_YEAR`／`ACTIVE_SEMESTER` 兩個環境
// 變數即可，不需改程式碼。若未設定則退回下方預設值——**這兩個預設值必須與
// `server/src/data/generalEducationCatalog.js` 的
// `RECOGNIZED_GENERAL_EDUCATION_COURSES_114_2`（114 學年下學期）保持一致，
// 兩處日後須同步調整**，否則通識認列與排課候選會分別套用不同學期。

const DEFAULT_ACTIVE_ACADEMIC_YEAR = 114;
const DEFAULT_ACTIVE_SEMESTER = '下學期';

export const ACTIVE_TERM = Object.freeze({
  academicYear: Number(process.env.ACTIVE_ACADEMIC_YEAR) || DEFAULT_ACTIVE_ACADEMIC_YEAR,
  semester: process.env.ACTIVE_SEMESTER || DEFAULT_ACTIVE_SEMESTER,
});

// 學期字串可能有多種寫法（MySQL `Course_Sections.semester` 實測為中文全稱
// `上學期`／`下學期`；env 覆寫或呼叫端可能傳數字或半形字）。正規化成
// `'first' | 'second' | null`，`null` 代表無法辨識，不強行猜測。
//
// 刻意不從 `generalEducationCatalog.js` import／export 對應邏輯——該檔案的
// 定位是 #12B 通識分類專用模組，不因為本檔案需要而擴大它的公開介面。
const FIRST_SEMESTER_LABELS = new Set(['1', '上', '上學期', 'first']);
const SECOND_SEMESTER_LABELS = new Set(['2', '下', '下學期', 'second']);

export function normalizeSemesterLabel(value) {
  const text = String(value ?? '').trim().toLowerCase();
  if (!text) return null;
  if (FIRST_SEMESTER_LABELS.has(text)) return 'first';
  if (SECOND_SEMESTER_LABELS.has(text)) return 'second';
  return null;
}

// 課程物件的學年學期欄位名稱不統一：`database.js` 的 `mapCourseRow()` 用
// `course.year`；部分呼叫端／未來資料可能用 `course.academicYear`。兩者都讀，
// 但不可與 `courseHistory.js`（學生歷史修課，用 `academicYear` + 數字
// `semester` 1/2）混用——那是完全不同的資料語意，本函式只處理課程 section。
export function getCourseTerm(course) {
  const academicYearValue = Number(course?.year ?? course?.academicYear);
  const academicYear = Number.isFinite(academicYearValue) ? academicYearValue : null;
  const semester = course?.semester != null ? String(course.semester) : null;
  return { academicYear, semester };
}

// 這門課是否屬於目前的 active term。
//
// 學年、學期兩者皆缺時視為 `true`（維持可見，不新增排除）——這是刻意的
// 相容決定：既有大量測試 fixture（`makeCourse()` 系列）從未設定學年學期，
// 若在此把「缺資料」當成「不符合」，會讓所有既有候選課程被排除，
// 是資料缺口而非「已知不符合」，兩者不可混為一談。
export function isActiveTermCourse(course, activeTerm = ACTIVE_TERM) {
  const { academicYear, semester } = getCourseTerm(course);

  if (academicYear === null && semester === null) return true;
  if (academicYear !== null && academicYear !== activeTerm.academicYear) return false;

  if (semester !== null) {
    const normalized = normalizeSemesterLabel(semester);
    const activeNormalized = normalizeSemesterLabel(activeTerm.semester);
    // 學期寫法無法辨識時，不用「猜出來的正規化結果」判定不符合，
    // 只有明確正規化成功且對不上才排除。
    if (normalized !== null && normalized !== activeNormalized) return false;
  }

  return true;
}

// 附加到候選課程物件上的 `term` 欄位。`academicYear`／`semester` 是**這門課
// 自己的值**，不是 `ACTIVE_TERM` 常數——讓被排除的課仍能顯示「這門課實際
// 開在哪個學期」，供排除原因與警告文字使用。
export function annotateTerm(course, activeTerm = ACTIVE_TERM) {
  const { academicYear, semester } = getCourseTerm(course);
  return {
    academicYear,
    semester,
    isActiveTerm: isActiveTermCourse(course, activeTerm),
  };
}

export default {
  ACTIVE_TERM,
  normalizeSemesterLabel,
  getCourseTerm,
  isActiveTermCourse,
  annotateTerm,
};
