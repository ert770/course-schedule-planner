import { shrinkEasiness, SHRINKAGE_PRIOR_WEIGHT } from './reviewStats.js';
import { normalizeSemesterLabel } from '../data/activeTerm.js';

// Roadmap #30：把互動事件折成 per-user 偏好權重。
// Roadmap #31：加上時間衰減與跨學期降權（見下方 `decayFactorFor()`）。
//
// **這個模組只從事件推導，不讀資料庫、不呼叫排課**——與 #26 的
// `recommendationReason.js`、#27 的 `planComparison.js` 同一條原則。呼叫端
// （`preferenceLearningService.js`）負責取事件、檢查 consent、寫表；這裡只做
// 「一批事件 → 一組權重」這個純函式轉換。
//
// **可重播的前提從 `#31` 起變嚴格了**：同一批事件 **＋ 同一個 `options.now`
// ＋ 同一個 `options.activeTerm`** 永遠得到同一份輸出——不再是單純「不依賴
// 時間」，而是「時間必須由呼叫端明確傳入，模組自己絕不偷看時鐘」。省略
// `options.now` 代表不套用時間衰減（不是隱含現在），省略 `options.activeTerm`
// 代表不做跨學期降權；兩者都省略時，行為與 `#30` 完全相同。模組內不得出現
// `Date.now()` 或任何自行取得目前時間的呼叫。

export const PREFERENCE_LEARNING_MODEL_VERSION = 'preference-learning-v2';

export const PREFERENCE_AXES = Object.freeze(['interest', 'compact', 'easy']);

export const SUFFICIENCY_STATUS = Object.freeze({
  SUFFICIENT: 'sufficient',
  INSUFFICIENT: 'insufficient',
  NO_CONSENT: 'no-consent',
});

// 資料量門檻。今天（2026-09-03）demo 帳號的真實資料只有個位數的強訊號、
// 一個人、一段開發測試期間——那個量級拿去學就是把雜訊當成個人化。這個數字
// 刻意設在明顯高於今天真實量級的地方；等 `#38` 真的有學生開始用，
// 再用真實資料重新校準，不是現在猜一個好看的數字。
export const REQUIRED_USABLE_EVENT_COUNT = 50;

// Roadmap #31：時間衰減半衰期，約一個授課學期（18 週 = 126 天）。
//
// 搭配 `PRIVACY_RETENTION.interactionEventDays = 180` 的保存上限，衰減係數
// 被夾在 `[0.5^(180/120), 1] = [0.354, 1]`——事件在被衰減壓到接近零之前就已經
// 因保存期限到了而被刪除。整套機制因此是**有界的重新加權，不是抹除**。
export const PREFERENCE_DECAY_HALF_LIFE_DAYS = 120;

// Roadmap #31：跨學期降權係數。舊學期的行為證據乘上這個固定係數，
// 不隨學期距離複合——半衰期已經處理連續老化，這裡只表達「規劃標的換了」
// 這個離散事實：上學期選課時說的話，是在講另一批課，不該原封不動搬到這學期。
export const STALE_TERM_DECAY_FACTOR = 0.5;

// 退課原因 → 影響的軸。`feedbackReason` 只有 `course_withdrawn` 帶得到，
// 且值域已由 `interactionEventSchema.js` 的 `INTERACTION_FEEDBACK_REASONS` 鎖死。
const WITHDRAW_REASON_RULES = Object.freeze({
  time: { axis: 'compact', ruleId: 'WITHDRAW_TIME' },
  workload: { axis: 'easy', ruleId: 'WITHDRAW_WORKLOAD' },
  content: { axis: 'interest', ruleId: 'WITHDRAW_CONTENT' },
});

// 接受方案 → 影響的軸。對應 `scheduler.js` 的 `PLAN_VARIANTS` id。只有這三個
// variant 主打單一軸；`required_first`（必修優先）與 `max_credits`（學分最大化）
// 不代表任何偏好方向，接受這兩種方案說明不了使用者在乎哪個軸，因此不映射。
const VARIANT_AXIS = Object.freeze({
  compact: 'compact',
  easy_score: 'easy',
  interest: 'interest',
});

// 單一事件的投票強度。強訊號（退課原因、接受方案）都是 1；瀏覽是弱訊號，
// 真正擋住它筆數優勢的是下面的 `WEAK_VOTE_AXIS_CAP`，這個數字本身大小不重要。
const STRONG_VOTE_WEIGHT = 1;
const WEAK_VOTE_WEIGHT = 0.15;

// 弱訊號的累計上限：不管一個人瀏覽了幾次，`course_viewed` 這條規則對單一軸的
// 總貢獻不得超過**一筆強訊號的份量**。「看了很多次」最多等於「明確表態過一次」，
// 不會因為筆數多就贏過使用者退課、接受方案這種明確行為。這個上限套在**衰減
// 之後**——衰減只會把弱訊號往下壓，永遠不會讓它超過 cap。
const WEAK_VOTE_AXIS_CAP = STRONG_VOTE_WEIGHT;

function clamp01(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function round3(value) {
  return Math.round(value * 1000) / 1000;
}

function courseKey(course) {
  if (!course) return null;
  if (course.catalogCourseCode) return `code:${course.catalogCourseCode}`;
  if (course.sectionId !== null && course.sectionId !== undefined) return `section:${course.sectionId}`;
  return null;
}

// 事件排序：先 `timestamp`（ISO 字串，字典序即時間序），同秒再用 `eventId` 當
// 決勝——事件表沒有次毫秒序號，兩個同秒事件要有穩定的排序才談得上可重播。
// `getInteractionEventsForExport()` 的記憶體 store 分支沒有 `ORDER BY`，
// 所以排序必須在這裡自己做，不能相信輸入已經排好。
function sortEvents(events) {
  return [...events].sort((a, b) => {
    const ta = a.timestamp ?? '';
    const tb = b.timestamp ?? '';
    if (ta !== tb) return ta < tb ? -1 : 1;
    return String(a.eventId ?? '').localeCompare(String(b.eventId ?? ''));
  });
}

// 「看了又退」判定：同一門課如果之後被退掉，那次瀏覽不算正向表態
// ——退課本身已經由 `WITHDRAW_*` 記了負向意見，再把它前面的瀏覽算成正向就是
// 自相矛盾。用「該課**任何一次**退課的時間晚於這次瀏覽」判定，不要求緊鄰。
function findExcludedViewEventIds(sortedEvents) {
  const withdrawTimesByCourse = new Map();
  for (const event of sortedEvents) {
    if (event.eventType !== 'course_withdrawn') continue;
    const key = courseKey(event.course);
    if (!key) continue;
    if (!withdrawTimesByCourse.has(key)) withdrawTimesByCourse.set(key, []);
    withdrawTimesByCourse.get(key).push(event.timestamp);
  }

  const excluded = new Set();
  for (const event of sortedEvents) {
    if (event.eventType !== 'course_viewed') continue;
    const key = courseKey(event.course);
    const withdrawTimes = key ? withdrawTimesByCourse.get(key) : null;
    if (withdrawTimes?.some(t => t > event.timestamp)) {
      excluded.add(event.eventId);
    }
  }
  return excluded;
}

// `recommendation_accepted` 要知道「當時還有哪些方案可選」才分得出這是不是
// 一次有對照組的表態，這個資訊只在同一次請求的 `recommendation_exposed` 裡。
function indexExposuresByRequestId(sortedEvents) {
  const map = new Map();
  for (const event of sortedEvents) {
    if (event.eventType === 'recommendation_exposed' && event.requestId) {
      map.set(event.requestId, event);
    }
  }
  return map;
}

// 學期序數：`academicYear * 2 + (下學期 ? 1 : 0)`，讓兩個學期可以直接比大小。
// 任一邊無法辨識（年份非正整數、學期字串辨識不出來）都回 null——不猜測。
function termOrdinal(term) {
  if (!term) return null;
  const year = Number(term.academicYear);
  if (!Number.isInteger(year) || year <= 0) return null;
  const semester = normalizeSemesterLabel(term.semester);
  if (semester === null) return null;
  return year * 2 + (semester === 'second' ? 1 : 0);
}

// 這筆事件的學期是否**明確早於** active term。`activeTerm` 未提供、或任一邊
// 學期無法辨識，一律回 false（不降權）——沿用 `activeTerm.js` 既有的立場：
// 缺資料不等於已知不符合。事件學期比 active 新（理論上不該發生）也回 false，
// 只有「確定比較舊」才降權。
function isStaleTerm(term, activeTerm) {
  if (!activeTerm) return false;
  const eventOrdinal = termOrdinal(term);
  const activeOrdinal = termOrdinal(activeTerm);
  if (eventOrdinal === null || activeOrdinal === null) return false;
  return eventOrdinal < activeOrdinal;
}

// 單一事件的衰減係數 = 半衰期衰減 × 學期降權。純函式，時鐘只能從 `now` 傳入。
//
// `now` 為 null（呼叫端沒給）時，年齡固定視為 0——即「不衰減」，不是「偷看
// 現在時間」。年齡用 `Math.max(0, …)` 夾住下限：事件時間戳理論上不該晚於
// `now`（由伺服器寫入），但防禦性地擋住「未來時間戳讓衰減係數大於 1，
// 也就是比新鮮事件更有份量」這個荒謬結果。
function decayFactorFor(event, { now, activeTerm }) {
  const ageDays = now == null ? 0 : Math.max(0, (now - Date.parse(event.timestamp)) / 86400000);
  const recency = Number.isFinite(ageDays)
    ? Math.pow(0.5, ageDays / PREFERENCE_DECAY_HALF_LIFE_DAYS)
    : 1; // 時間戳無法解析 → 不猜測，不衰減
  const stale = isStaleTerm(event.term, activeTerm);
  const termFactor = stale ? STALE_TERM_DECAY_FACTOR : 1;
  return { factor: recency * termFactor, isStaleTerm: stale };
}

function collectVotes(sortedEvents, { now, activeTerm } = {}) {
  const excludedViewEventIds = findExcludedViewEventIds(sortedEvents);
  const exposureByRequestId = indexExposuresByRequestId(sortedEvents);
  const votesByAxis = { interest: [], compact: [], easy: [] };
  let staleTermEventCount = 0;

  const pushVote = (axis, base, event) => {
    const { factor, isStaleTerm: eventIsStale } = decayFactorFor(event, { now, activeTerm });
    if (eventIsStale) staleTermEventCount += 1;
    votesByAxis[axis].push({
      ...base,
      decay: round3(factor),
      weight: base.baseWeight * factor,
    });
  };

  for (const event of sortedEvents) {
    if (event.eventType === 'course_withdrawn') {
      const rule = WITHDRAW_REASON_RULES[event.feedbackReason];
      if (rule) {
        pushVote(rule.axis, {
          ruleId: rule.ruleId,
          eventId: event.eventId,
          occurredAt: event.timestamp,
          strength: 'strong',
          baseWeight: STRONG_VOTE_WEIGHT,
        }, event);
      }
      continue;
    }

    if (event.eventType === 'recommendation_accepted') {
      const exposure = exposureByRequestId.get(event.requestId);
      // #7 的混合權重無法單憑「接受方案」判定是哪一軸造成的。舊事件維持原有
      // 重播語意；新方案不得從 strategy ID 憑空製造單軸投票。
      if (exposure?.exposureContext?.planPolicies?.length
        || event.plan?.variantId?.startsWith('personalized')) continue;
      const axis = VARIANT_AXIS[event.plan?.variantId];
      if (!axis) continue;
      const displayedCount = exposure?.exposureContext?.displayedPlanIds?.length ?? 0;
      // 只有曝光時真的有兩個以上方案可選，接受其中一個才算「看過對照組之後的
      // 選擇」；只有一個方案時，接受它說明不了使用者比較過什麼。
      if (displayedCount > 1) {
        pushVote(axis, {
          ruleId: 'ACCEPT_VARIANT',
          eventId: event.eventId,
          occurredAt: event.timestamp,
          strength: 'strong',
          baseWeight: STRONG_VOTE_WEIGHT,
        }, event);
      }
      continue;
    }

    if (event.eventType === 'course_viewed') {
      if (excludedViewEventIds.has(event.eventId)) continue;
      pushVote('interest', {
        ruleId: 'VIEWED_WEAK',
        eventId: event.eventId,
        occurredAt: event.timestamp,
        strength: 'weak',
        baseWeight: WEAK_VOTE_WEIGHT,
      }, event);
    }
  }

  return { votesByAxis, staleTermEventCount };
}

// 單一軸：把投票折成一個 [0,1] 的權重。
//
// Roadmap #31 改寫成「證據總量」語意（原本的寫法有單調性 bug：見下方）。
// 弱訊號先各自加總（衰減後）再整體 cap 在一筆強訊號的份量，接著把
// 「強訊號 + capped 弱訊號」的**衰減後總量**當成樣本數，用
// `reviewStats.js` 既有的 m-estimate 往顯式基準收縮——不另發明一套數學。
// 每一票都指向同一個方向（「這個人在乎這個軸」），因此折疊的是**證據總量**，
// 不是方向平均：raw value 恆為 1，樣本數才是衰減與筆數真正作用的地方。
//
// **這個寫法同時修掉一個 bug**：`#30` 原本的版本裡，弱訊號通道不管衰減與否，
// 都在 `sampleSize` 上固定貢獻整數 1，但在 `rawSum` 上只貢獻它衰減後的實際值
// ——分子被稀釋、分母卻整數增加，導致「多一筆支持性弱證據，權重反而下降」。
// 例如 `1 筆強訊號` 算出 0.16667，但 `1 筆強訊號 + 1 筆未飽和的弱訊號` 只有
// 0.16429，比什麼弱訊號都沒有還低——這違反直覺，而且時間衰減會讓小數樣本
// 變得常態化，把這個邊緣個案放大成系統性問題。改成「樣本數 = 衰減後總量」
// 之後，`10 筆衰減 0.5 的證據` 與 `5 筆全新證據` 產生完全相同的結果，
// 而且「多一筆同軸弱訊號，權重永遠不會下降」——單調性成立。
//
// 最後用 `Math.max` 頂住下限，比照 `scheduler.js` 的
// `compactWeight = Math.max(weights.compact, ...)`——顯式設定只能被行為
// 加強，不能被行為推翻。
function foldAxis(votes, explicitBaseline) {
  const prior = clamp01(explicitBaseline);
  if (votes.length === 0) {
    return { weight: prior, effectiveSampleSize: 0 };
  }

  const strongMass = votes
    .filter(vote => vote.strength === 'strong')
    .reduce((sum, vote) => sum + vote.weight, 0);
  const weakMassRaw = votes
    .filter(vote => vote.strength === 'weak')
    .reduce((sum, vote) => sum + vote.weight, 0);
  const weakMass = Math.min(weakMassRaw, WEAK_VOTE_AXIS_CAP);

  const effectiveSampleSize = strongMass + weakMass;
  const shrunk = shrinkEasiness(1, effectiveSampleSize, prior, SHRINKAGE_PRIOR_WEIGHT);
  const weight = Math.max(clamp01(shrunk ?? prior), prior);

  return { weight, effectiveSampleSize };
}

/**
 * 把一批互動事件折成一組偏好權重。
 *
 * @param events          `getInteractionEventsForExport()` 的輸出（或同形狀的
 *                         事件陣列），不需事先排序。
 * @param options.explicitProfile  使用者目前的顯式設定，形狀同
 *                         `buildPreferenceProfile()` 的回傳：
 *                         `{ interest, compact, easy }`，每個為 0 或 1。
 *                         省略時視為三軸都沒有顯式設定（全 0）。
 * @param options.now     `Date` | ISO 字串 | epoch 毫秒數。用來計算時間衰減。
 *                         **省略時完全不套用時間衰減**（不是隱含現在時間）。
 * @param options.activeTerm  `{ academicYear, semester }`，通常就是
 *                         `data/activeTerm.js` 的 `ACTIVE_TERM`。用來判定
 *                         哪些事件屬於舊學期並降權。**省略時不做學期降權**。
 * @returns 見檔案頂部註解的回傳形狀；`weights` 在 `insufficient` 時等於
 *          （clamp 過的）`explicitProfile`，不是半調子的學習值。`decay`
 *          欄位記錄本次計算實際套用了什麼衰減參數，`appliedAt` 為 null
 *          代表這次呼叫沒有套用時間衰減。
 */
export function learnPreferenceWeights(events = [], options = {}) {
  const explicitProfile = options.explicitProfile ?? {};
  const now = options.now == null ? null : new Date(options.now).getTime();
  const activeTerm = options.activeTerm ?? null;

  const sorted = sortEvents(events);
  const { votesByAxis, staleTermEventCount } = collectVotes(sorted, { now, activeTerm });

  const rawWeights = {};
  const evidence = {};
  const effectiveSampleSize = {};
  let usableEventCount = 0;
  const missingAxes = [];

  for (const axis of PREFERENCE_AXES) {
    const votes = votesByAxis[axis];
    // `usableEventCount` 是「資料量夠不夠格開始學」的量閘，永遠是整數、
    // 不受衰減影響——衰減回答的是「每一筆該算多重」，是不同的問題。
    // 若讓它衰減，使用者會在沒有任何新操作下看到「還差 N 筆」倒著數。
    usableEventCount += votes.length;
    if (votes.length === 0) missingAxes.push(axis);

    evidence[axis] = votes.map(({ ruleId, eventId, occurredAt, decay }) => ({ ruleId, eventId, occurredAt, decay }));
    const folded = foldAxis(votes, explicitProfile[axis] ?? 0);
    rawWeights[axis] = folded.weight;
    effectiveSampleSize[axis] = round3(folded.effectiveSampleSize);
  }

  const sufficient = usableEventCount >= REQUIRED_USABLE_EVENT_COUNT;
  const weights = sufficient
    ? rawWeights
    : Object.fromEntries(PREFERENCE_AXES.map(axis => [axis, clamp01(explicitProfile[axis] ?? 0)]));

  return {
    modelVersion: PREFERENCE_LEARNING_MODEL_VERSION,
    weights,
    sufficiency: {
      status: sufficient ? SUFFICIENCY_STATUS.SUFFICIENT : SUFFICIENCY_STATUS.INSUFFICIENT,
      usableEventCount,
      requiredEventCount: REQUIRED_USABLE_EVENT_COUNT,
      missingAxes,
    },
    evidence,
    // Roadmap #31：這次計算實際用了什麼衰減參數，供偵錯與變更報告核對——
    // 不是使用者導向的欄位，`preferenceLearningService.js` 也不強制回傳它。
    decay: {
      halfLifeDays: PREFERENCE_DECAY_HALF_LIFE_DAYS,
      staleTermFactor: STALE_TERM_DECAY_FACTOR,
      appliedAt: now == null ? null : new Date(now).toISOString(),
      activeTerm,
      effectiveSampleSize,
      staleTermEventCount,
      oldestEventAt: sorted.length > 0 ? sorted[0].timestamp : null,
      newestEventAt: sorted.length > 0 ? sorted[sorted.length - 1].timestamp : null,
    },
  };
}

/**
 * Roadmap #5B：學到的權重超出顯式基準的部分，恆 `>= 0`。
 *
 * **這是「顯式設定只能被行為加強、不能被推翻」在型別上的保證**，不只是
 * 口頭約定。`foldAxis()` 已經把 `weights[axis]` 壓在
 * `Math.max(clamp01(shrunk), prior)`——對一個顯式已經勾到底（`prior = 1`）
 * 的軸，學到的值恆等於 1，若排課端直接拿這個原值當強度，會讓所有這類使用者
 * 在功能上線當天無證據地被加重權重。取超出量則這種情況下 `boost = 0`，
 * 零回歸；也讓 `scheduler.js` 的 `axisWeight()` 不必知道 `foldAxis` 的內部
 * 細節，只要相信「boost 恆為 [0,1] 且代表額外證據」。
 *
 * @param weights          `learnPreferenceWeights()` 或已存列的 `weights`
 *                         （`{ interest, compact, easy }`）。`null` 時整個
 *                         回傳 `null`——沒有學到的權重就沒有 boost，不是 0
 *                         這種看起來像「學到了但沒差異」的假訊號。
 * @param explicitProfile  同一批使用者的顯式基準（`deriveExplicitProfile()`
 *                         的回傳形狀），省略時視為三軸皆為 0。
 */
export function computeLearnedBoosts(weights, explicitProfile = {}) {
  if (!weights) return null;
  return Object.fromEntries(PREFERENCE_AXES.map(axis => [
    axis,
    round3(clamp01(Number(weights[axis] ?? 0) - clamp01(explicitProfile[axis] ?? 0))),
  ]));
}

export default {
  PREFERENCE_LEARNING_MODEL_VERSION,
  PREFERENCE_AXES,
  SUFFICIENCY_STATUS,
  REQUIRED_USABLE_EVENT_COUNT,
  PREFERENCE_DECAY_HALF_LIFE_DAYS,
  STALE_TERM_DECAY_FACTOR,
  learnPreferenceWeights,
  computeLearnedBoosts,
};
