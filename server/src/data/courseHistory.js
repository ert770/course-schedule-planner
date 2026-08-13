// 歷史修課紀錄的派生運算。
//
// **`courseHistory` 是修課歷史的唯一來源。** 先前 `users.json` 對同一批資料
// 另外存了 `completedCourseCodes`、`completedCourseNames`、`completedCourseIds`、
// `completedCredits`、`earnedCredits` 五個欄位，全部都是 `courseHistory` 能直接
// 算出來的東西。同一份資料存多份必然漂移，那些欄位已於 2026-08-11 移除，
// 需要課號或學分的地方一律呼叫這裡的函式**當場算**。
//
// 派生結果**不得再存回 profile 物件上**——在記憶體裡留一個叫
// `completedCourseCodes` 的欄位，等於把同一份資料從檔案搬到記憶體再存一次，
// `courseHistory` 之外仍然有第二個代表。
//
// 放在 `data/` 而不是 `services/`：`skills/scheduler.js` 只 import
// `utils/`、`skills/`、`data/`，放進 services 會讓排課引擎反向相依於服務層。

// 不計入畢業學分的課程分類（體育、國防科技等）。
// 校規本來就不算，見 `docs/CHANGE_REPORTS/2026-08-06-personal-course-history-import.md`。
const NON_GRADUATION_CATEGORY = 'nonGraduation';

// 畢業學分的分類，與 `data/graduationRequirements.js` 的 breakdown 一致。
const CREDIT_CATEGORIES = ['required', 'elective', 'general', 'external', 'unspecified'];

// 已通過的課號。
//
// **未通過的課不在此列**——那是重補修的對象，不是已修。這個區分讓
// `scheduler.js` 的已修排除與 `retakeCourseIds` 天生互斥，不需要額外的豁免判斷：
// 被排除的一定是通過的，需要重補修的一定不在排除清單裡。
//
// 回傳的課號直接對應 MySQL `Courses.subid3` 映射後的 `course.catalogCourseCode`，
// 兩側皆為無空白的大寫字串，**不做正規化**（2026-08-11 實測：
// `courseHistory.courseCode` 53 筆與 MySQL `Courses.subid3` 全表 3086 筆皆無前後空白、
// 無非大寫、無空值，BINARY 精確比對與不分大小寫查詢結果相同）。
export function getPassedCourseCodes(courseHistory = []) {
  return toArray(courseHistory)
    .filter(entry => entry?.passed)
    .map(entry => entry.courseCode);
}

// 依畢業分類加總已修學分。未通過的課與 `nonGraduation` 分類都不計入。
export function getEarnedCredits(courseHistory = []) {
  const earned = Object.fromEntries(CREDIT_CATEGORIES.map(key => [key, 0]));

  for (const entry of toArray(courseHistory)) {
    if (!entry?.passed) continue;
    if (entry.graduationCategory === NON_GRADUATION_CATEGORY) continue;

    // 分類缺漏或不在已知清單時歸入 `unspecified`，不靜默丟棄學分。
    const category = CREDIT_CATEGORIES.includes(entry.graduationCategory)
      ? entry.graduationCategory
      : 'unspecified';

    earned[category] += Number(entry.credits) || 0;
  }

  return earned;
}

// 計入畢業的已修總學分。
export function getTotalEarnedCredits(courseHistory = []) {
  return Object.values(getEarnedCredits(courseHistory))
    .reduce((sum, credits) => sum + credits, 0);
}

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

export default {
  getPassedCourseCodes,
  getEarnedCredits,
  getTotalEarnedCredits,
};
