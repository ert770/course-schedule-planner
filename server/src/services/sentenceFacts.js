// Roadmap #41（第二段）：句子層級、與特定課程無關的事實抽取工具。
//
// `explanationFaithfulness.js` 的事實審查與 `courseReferenceResolver.js` 的候選
// 收斂都需要同一套「這句話主張了什麼學分／教師／時間」——兩邊各寫一份遲早會
// 漂移（第一版設計就是在這裡漏掉一個守衛條件，卻只改到其中一邊）。抽成這裡，
// 兩邊 import 同一份。

// 星期＋節次的兩種常見寫法：「星期一第 3-4 節」與「(一)03-04」。回傳正規化成
// 「日:起-迄」的字串陣列，供比對用（不在乎原文寫法，只在乎日期與節次數字）。
export function extractTimeClaims(value) {
  const text = String(value ?? '').trim();
  const claims = [];
  const patterns = [
    /(?:星期|週)([一二三四五六日天])\s*(?:第)?\s*(\d{1,2})(?:\s*[-~～–—至到]\s*(\d{1,2}))?\s*節?/gu,
    /[（(]?([一二三四五六日天])[）)]?\s*(?:第)?\s*(\d{1,2})\s*[-~～–—至到]\s*(\d{1,2})/gu,
  ];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const day = match[1] === '天' ? '日' : match[1];
      const start = Number(match[2]);
      const end = Number(match[3] ?? match[2]);
      claims.push(`${day}:${start}-${end}`);
    }
  }
  return [...new Set(claims)];
}

// 「由王小明老師授課」這種明講教師的句型。沒有「由」就不算斷言——「王小明老師」
// 單獨出現（例如列點摘要）不代表句子在主張這門課的教師是誰。
export function matchAssertedTeacher(sentence) {
  const match = sentence.match(/由\s*([^，。；、\s]{1,16})\s*(?:老師|教授)(?:授課|開設)?/u);
  return match?.[1] ?? null;
}

export function extractCreditValues(sentence) {
  return [...sentence.matchAll(/(\d+(?:\.\d+)?)\s*學分/gu)].map(match => Number(match[1]));
}

// Markdown 表格列（`| 課程 | 教師 | 學分 | 時間 |`）。回傳每一格去除強調符號與
// 空白後的陣列；不是表格列就回傳 null。
export function splitTableCells(sentence) {
  if (!sentence.includes('|')) return null;
  return sentence.split('|').map(cell => cell.replace(/[*_`]/g, '').trim()).filter(Boolean);
}

// 表格列裡「課程」欄位在第幾格——用課程指涉字串（課名或課號）去找，不是靠固定
// 欄位順序，因為欄位順序不保證固定。
export function findTableColumnIndex(cells, mentionText) {
  if (!cells || !mentionText) return -1;
  return cells.findIndex(cell => cell.includes(mentionText));
}

// 假設表格列是「課程｜教師｜學分｜時間」的固定相對順序（課程欄位右邊依序是
// 教師、學分），從課程欄位的索引位置推教師與學分欄。
export function extractTableFacts(cells, columnIndex) {
  if (!cells || columnIndex < 0) return null;
  const creditText = cells[columnIndex + 2] ?? '';
  const creditMatch = creditText.match(/^\s*(\d+(?:\.\d+)?)\s*(?:學分)?\s*$/u);
  return {
    teacher: String(cells[columnIndex + 1] ?? '').trim().replace(/(?:老師|教授)$/u, '') || null,
    credits: creditMatch ? Number(creditMatch[1]) : null,
  };
}
