// 資料庫匯入時混入的多餘引號處理。
//
// D3：`User_Profiles.department` 的實際值為 `'資訊工程學系'`——**包含字面單引號字元
// 本身**（HEX 前後皆為 `27`），不是 SQL 語法上的引號。2026-08-02 掃描 `defaultdb`
// 全部 19 個文字欄位後，只有此欄位有此問題（其餘欄位前後引號數皆為 0），
// 屬單一欄位的匯入缺陷，而非全表通例。
//
// 帶引號的值會讓任何字串比對失敗：畢業建議的 `course.department === user.department`、
// 前端系所下拉選單的 value 比對、以及路線圖 `#13` 的系所對照都會靜默失效。

// 成對的引號字元。半形與全形都收，因為匯入來源不一定一致。
const QUOTE_PAIRS = new Map([
  ["'", "'"],
  ['"', '"'],
  ['`', '`'],
  ['‘', '’'], // ‘ ’
  ['“', '”'], // “ ”
  ['「', '」'], // 「 」
  ['『', '』'], // 『 』
]);

// 去除「整個字串被引號包起來」的情形，並修剪前後空白。
//
// 只有真正成對時才剝除，因此不會動到字串內部或單邊的引號：
//   "'資訊工程學系'" -> "資訊工程學系"
//   "O'Brien"        -> "O'Brien"（單邊，不成對）
//   "'甲' 與 '乙'"    -> 原樣（剝除後內部仍有引號，視為內容的一部分）
export function stripWrappingQuotes(value) {
  if (typeof value !== 'string') {
    return value;
  }

  let result = value.trim();

  // 可能被重複包裹（例如 `"'資訊工程學系'"`），因此反覆剝除到不再成對為止。
  for (;;) {
    const close = QUOTE_PAIRS.get(result[0]);
    if (!close || result.length < 2 || !result.endsWith(close)) {
      return result;
    }

    const inner = result.slice(1, -1);
    // 剝除後內部仍含同一個引號字元，代表這些引號屬於內容，不是包裹用的。
    if (inner.includes(result[0]) || inner.includes(close)) {
      return result;
    }

    result = inner.trim();
  }
}

// 系所名稱正規化。讀取與寫入兩端都要經過，避免髒值再次進入比對邏輯或資料庫。
export function normalizeDepartment(value) {
  if (value === null || value === undefined) {
    return value;
  }
  return stripWrappingQuotes(String(value));
}

export default {
  stripWrappingQuotes,
  normalizeDepartment,
};
