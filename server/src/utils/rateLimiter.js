// Roadmap #2 對抗式審查發現的一部分：`/api/interactions` 除了 50
// 筆／請求的批次上限，完全沒有節流——任何已登入帳號都能無限次呼叫，
// 造成資料庫無界成長。這裡補上最小可行的兩層節流：
//
//   1. **每分鐘請求數**：process 內記憶體的固定視窗計數器，防止短時間灌爆。
//      不需要跨行程共享——這個專題是單一 Node process 部署，重開就重置也
//      沒關係，它的目的是擋掉突發流量，不是長期配額。
//   2. **每日事件量**：交給呼叫端對資料庫下 COUNT 查詢（見
//      `interactionEventService.js` 的 `assertUnderDailyQuota`），這個限制
//      必須在重開行程後仍然生效，所以不能只放記憶體。
//
// 沒有另外引入 Redis 或 `express-rate-limit`——專案目前的規模與部署方式
// （單一 process、沒有其他地方用到共享快取）用不到，手寫這一小段更直接。
const WINDOW_MS = 60_000;

const windows = new Map();

// 週期性清掉不再有請求的 subject，避免這個 Map 在長時間運行後無限成長。
let lastSweep = Date.now();
function sweepIfDue(now) {
  if (now - lastSweep < WINDOW_MS) return;
  lastSweep = now;
  for (const [key, entry] of windows) {
    if (now - entry.windowStart >= WINDOW_MS) windows.delete(key);
  }
}

/**
 * 固定視窗節流。同一個 key 在同一分鐘內超過 `limit` 次呼叫就回 false。
 *
 * @param key   節流對象，這裡固定用 subject_id。
 * @param limit 每個視窗允許的次數。
 */
export function checkRateLimit(key, limit) {
  const now = Date.now();
  sweepIfDue(now);

  let entry = windows.get(key);
  if (!entry || now - entry.windowStart >= WINDOW_MS) {
    entry = { windowStart: now, count: 0 };
    windows.set(key, entry);
  }
  entry.count += 1;
  return entry.count <= limit;
}

export function resetRateLimiterForTests() {
  windows.clear();
  lastSweep = Date.now();
}

export default { checkRateLimit, resetRateLimiterForTests };
