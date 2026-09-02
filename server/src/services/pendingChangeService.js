// Roadmap #24：永久寫入前的「使用者確認」閘門。
//
// **要解決的問題**：`update_preferences` 原本會在模型決定呼叫的當下就把偏好
// 寫進 MySQL（`memoryService.updateUserPreferences()` → `upsertByField()`），
// 沒有任何 staging 或確認步驟。唯一的保護是 system prompt 裡一句「只在使用者
// 明確表達要以後都這樣時才呼叫」——那是叮嚀，不是機制，模型想無視就無視。
// 這直接違反 #24 自己的範圍條文「使用者確認前不得永久更新偏好」。
//
// **作法**：模型第一次呼叫時只把變更暫存起來並拿到一個 token，必須先把內容
// 講給使用者確認；使用者同意後模型帶著 token 再呼叫一次，這時才真的寫入。
//
// **形狀比照 `privacyService.js` 的 `createDeletionIntent()`／
// `consumeDeletionIntent()`**：只存 token 的 SHA-256 雜湊而不存原文、用
// `crypto.timingSafeEqual` 比對、單次使用、10 分鐘過期。同一個 idiom 在這個
// repo 已經用來守護「刪除帳號」這種不可逆操作，偏好寫入沿用它。
//
// **狀態放行程內記憶體而不是資料庫**，比照 `utils/rateLimiter.js` 已寫明的
// 理由：這個專題是單一 Node process 部署，而這是一個 10 分鐘、單次性的暫存
// 物件。代價要誠實說：開發時 `node --watch` 重啟會讓待確認的變更失效，使用者
// 得重講一次。那是自我修復的失敗（模型會重新 stage），不會造成靜默寫錯。
import crypto from 'node:crypto';

const TTL_MS = 10 * 60 * 1000;
const SWEEP_INTERVAL_MS = TTL_MS;

// key 為 `${canonicalId}::${changeType}`，值為單一待確認變更。
// 同一個使用者對同一種變更只保留最新一筆——使用者改變主意重講一次時，
// 舊的那筆就不該還能被確認。
const pending = new Map();

let lastSweep = Date.now();

function sweepIfDue(now) {
  if (now - lastSweep < SWEEP_INTERVAL_MS) return;
  lastSweep = now;
  for (const [key, entry] of pending) {
    if (entry.expiresAt <= now) pending.delete(key);
  }
}

function keyFor(identity, changeType) {
  return `${identity?.canonicalId}::${changeType}`;
}

function hashToken(token) {
  return crypto.createHash('sha256').update(String(token ?? '')).digest('hex');
}

// 比對雜湊而不是原文，且用固定時間比較——與 `privacyService.js` 同一套作法。
function sameTokenHash(actualHash, expectedHash) {
  const left = Buffer.from(actualHash, 'hex');
  const right = Buffer.from(String(expectedHash || ''), 'hex');
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

/**
 * 暫存一筆待確認的變更，回傳要交給模型的 token。
 *
 * @param identity   `resolveIdentity()` 的結果。
 * @param changeType 變更種類（`preferences`／`profile-scope`），確認時必須一致。
 * @param changes    這次要寫入的欄位。
 * @param options    `{ now }` 可注入的時鐘，測試用。
 */
export function stagePendingChange(identity, changeType, changes, { now = () => Date.now(), turnId = null } = {}) {
  const at = now();
  sweepIfDue(at);

  const token = crypto.randomBytes(24).toString('base64url');
  const expiresAt = at + TTL_MS;
  pending.set(keyFor(identity, changeType), {
    tokenHash: hashToken(token),
    // **原始 token 也要留著**。工具結果不會跨回合保存（`saveChatExchange()` 只存
    // 使用者訊息與最終文字回覆），下一回合模型手上不會有第一回合拿到的 token
    // ——實測時模型因此又重新暫存了一次，永遠走不到寫入。伺服器必須能在下一
    // 回合的 prompt 裡把它交還給模型。
    //
    // 保留雜湊比對只是沿用 `privacyService` 的形狀；那裡的 token 會送到使用者端
    // 的外部通道，雜湊有意義，此處 token 從未離開這個行程，雜湊不是安全邊界。
    // **真正的保證是 `turnId`**：確認必須發生在另一個回合。
    token,
    turnId: turnId ?? null,
    // 深拷貝：暫存的內容不該因為呼叫端之後改動同一個物件而跟著變。
    changes: JSON.parse(JSON.stringify(changes ?? {})),
    expiresAt,
  });

  return { token, expiresAt: new Date(expiresAt).toISOString() };
}

/**
 * 查目前有沒有待確認的變更，供下一回合的 system prompt 使用。
 *
 * 回傳原始 token——模型需要它才能完成確認，而它本來就是這個行程自己發的。
 */
export function peekPendingChange(identity, changeType, { now = () => Date.now() } = {}) {
  const entry = pending.get(keyFor(identity, changeType));
  if (!entry || entry.expiresAt <= now()) return null;
  return { token: entry.token, changes: entry.changes, turnId: entry.turnId };
}

/**
 * 消耗一筆待確認的變更。
 *
 * **回傳的是當初暫存的內容**，呼叫時一併傳來的其他欄位一律忽略——否則模型可以
 * 拿一個使用者確認過的 token，夾帶使用者從沒同意過的欄位一起寫進去。同樣的
 * 防護思路已存在於 `scheduleFeedbackService`：不信模型自報的 sectionId，
 * 而是對照伺服器自己記下的曝光紀錄。
 *
 * @returns 當初暫存的 changes；token 無效、過期或已用過時回 null。
 */
export function consumePendingChange(identity, changeType, token, { now = () => Date.now(), turnId = null } = {}) {
  const at = now();
  sweepIfDue(at);

  const key = keyFor(identity, changeType);
  const entry = pending.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= at) {
    pending.delete(key);
    return null;
  }
  if (!sameTokenHash(hashToken(token), entry.tokenHash)) return null;

  // **同一回合內不得確認自己剛暫存的變更。**
  //
  // 這才是「使用者確認前不得永久寫入」真正的機制保證：模型可以在同一回合裡
  // 連續呼叫兩次工具，但使用者在那中間根本沒有機會說話。要求跨回合，等於要求
  // 使用者真的又送出了一則訊息——prompt 叮嚀擋不住的事，這裡擋得住。
  if (turnId && entry.turnId && turnId === entry.turnId) return null;

  // 單次使用：確認過就移除，重送同一個 token 不會再寫一次。
  pending.delete(key);
  return entry.changes;
}

export function resetPendingChangesForTests() {
  pending.clear();
  lastSweep = Date.now();
}

export default {
  stagePendingChange, consumePendingChange, peekPendingChange, resetPendingChangesForTests,
};
