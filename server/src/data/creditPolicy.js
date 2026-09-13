// 校規學分下限（見 docs/COURSE_SELECTION_RULES.md 第一節）。
//
// 抽成獨立模組，讓「四年級下限 9」這條規則只有一份實作。2026-09-10 抓到的
// 真實 bug：`scheduler.js` 一直都有年級判斷（`defaultMinCredits()`），但
// `database.js` 的 `mapUserProfileRow()` 把 `targetCreditsMin` 寫死成 12，
// 這個值會沿著 `constraintService.js` 的 `input.minCredits ?? prefs.targetCreditsMin`
// 一路流進 `generateSchedule()`，變成明確存在的 `constraints.minCredits`——
// `scheduler.js` 的 `?? defaultMinCredits(constraints)` 因此永遠不會被呼叫到，
// 四年級下限從未在真實請求中生效過。既有測試 `C3 四年級下限為 9 學分`
// 只直接呼叫 `generateSchedule()`，繞過了 profile 這一層，所以沒抓到。
//
// 修法：`scheduler.js` 與 `database.js` 改成呼叫同一個 `resolveMinCredits()`，
// 不再各自維護一份「4 年級以上是 9」的判斷式。
export const DEFAULT_MIN_CREDITS = 12;
export const FINAL_YEAR_MIN_CREDITS = 9;
export const FINAL_YEAR = 4;

export function resolveMinCredits(gradeLevel) {
  return Number(gradeLevel) >= FINAL_YEAR ? FINAL_YEAR_MIN_CREDITS : DEFAULT_MIN_CREDITS;
}
