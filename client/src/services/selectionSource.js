// 加入課表時，事件的 `source` 要記成什麼。
//
// 預設由 `interactionLog.js` 的 `courseSource()` 依課程本身判定（必修／系統推薦／使用者自選）。
// 探索頁需要把「從探索清單加入」標成 `exploration`，所以 `addCourse()` 接受一個覆寫值——
// 但**只接受 `exploration` 這一個**。頁面不能藉此把課標成必修或系統推薦；
// 排課引擎判定為本人必修的課也不會被改標。
//
// 獨立成檔是為了能用 node 直接測試（`interactionLog.js` 會 import 瀏覽器端的 API 模組）。
export const EXPLORATION_SOURCE = 'exploration';
const REQUIRED_SOURCE = 'required';

export function resolveSelectionSource(defaultSource, override) {
  if (override !== EXPLORATION_SOURCE) return defaultSource;
  if (defaultSource === REQUIRED_SOURCE) return defaultSource;
  return EXPLORATION_SOURCE;
}

export default { resolveSelectionSource, EXPLORATION_SOURCE };
