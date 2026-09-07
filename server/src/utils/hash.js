// 共用的雜湊小工具。目前有兩處各自需要「同樣輸入永遠得到同一組雜湊、且不可逆」：
//   - `scheduleFeedbackService.js` 的 idempotency key（同一份課表確認兩次不能產生兩筆事件）
//   - `agentService.js` 的 tool-call operation key（同一工具、不同參數要能區分成不同操作，
//     但參數內容本身依政策不記錄——見 `agentService.js` 的「工具參數已解析（內容不記錄）」）
// 兩處都只需要雜湊值本身，不需要雜湊回推內容，抽成這裡避免各寫一份。

import crypto from 'node:crypto';

// 物件的鍵順序不保證穩定（JSON.parse 出來的物件、或呼叫端手動組的物件都可能不同），
// 直接 JSON.stringify 會讓語意相同的物件雜湊出不同值。遞迴排序鍵之後再序列化。
function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    const keys = Object.keys(value).sort();
    return `{${keys.map(key => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

// 對任意值算 SHA-256 雜湊（16 進位字串）。物件會先做鍵序穩定化，其餘型別走
// `JSON.stringify`；字串則直接雜湊，避免多一層無意義的引號包裝。
export function sha256Hex(value) {
  const normalized = typeof value === 'string' ? value : stableStringify(value ?? null);
  return crypto.createHash('sha256').update(normalized).digest('hex');
}
