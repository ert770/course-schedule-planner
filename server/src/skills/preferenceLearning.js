import { shrinkEasiness, SHRINKAGE_PRIOR_WEIGHT } from './reviewStats.js';
import { normalizeSemesterLabel } from '../data/activeTerm.js';
import { INTERACTION_SOURCES } from '../data/interactionEventSchema.js';

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

// Roadmap #40：診斷用欄位，回答「這一軸的證據長什麼樣子」，跟「今天夠不夠格
// 套用學習值」（`sufficiency.status`）是兩個不同的問題。目前只在
// `learnPreferenceWeights()` 的回傳值裡驗證得到，不寫進 `Learned_Preference_Weights`
// 表、不影響 `scoringPolicy.js` 的排課排序——正式落地留給之後的隱私與產品決策。
export const AXIS_SIGNAL_STATUS = Object.freeze({
  // 這一軸完全沒有任何事件投票——沒有偏好，不是學不到。
  NO_EVIDENCE: 'no-evidence',
  // 行為證據真的把數值推高於顯式基準——`#31` 起「顯式基準是下限」的那種正常情況。
  LEARNED_INCREMENT: 'learned-increment',
  // 有行為證據，但顯式基準已經頂到這批證據能達到的上限（`foldAxis()` 的
  // `Math.max(shrunk, prior)`）——「沒有偏好」與「偏好已經頂到上限、且持續被
  // 證實」在 `weights` 這個最終數字上長得一模一樣，只有這裡看得出差別。
  EXPLICIT_CEILING_WITH_EVIDENCE: 'explicit-ceiling-with-evidence',
});

function classifyAxisSignal({ prior, effectiveSampleSize, rawWeight }) {
  if (effectiveSampleSize <= 0) return AXIS_SIGNAL_STATUS.NO_EVIDENCE;
  return rawWeight > prior + 1e-9
    ? AXIS_SIGNAL_STATUS.LEARNED_INCREMENT
    : AXIS_SIGNAL_STATUS.EXPLICIT_CEILING_WITH_EVIDENCE;
}

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

// 「看了又退」判定，roadmap #40 起泛化成所有正向表態事件：同一門課如果之後被
// 退掉，先前對它的正向表態（瀏覽、手動選課、收藏）都不算數——退課本身已經由
// `WITHDRAW_*` 記了負向意見，再把它前面的正向表態算進去就是自相矛盾。收藏另外
// 多一種撤銷路徑：取消收藏不代表討厭這門課（見 `collectVotes()` 的說明），但
// 確實代表「收藏當時」的表態已經被使用者自己撤回，不該再算數。
// 用「該課**任何一次**退課／取消收藏的時間晚於這次表態」判定，不要求緊鄰。
function findExcludedPositiveEventIds(sortedEvents) {
  const withdrawTimesByCourse = new Map();
  const unfavoriteTimesByCourse = new Map();
  for (const event of sortedEvents) {
    const key = courseKey(event.course);
    if (!key) continue;
    if (event.eventType === 'course_withdrawn') {
      if (!withdrawTimesByCourse.has(key)) withdrawTimesByCourse.set(key, []);
      withdrawTimesByCourse.get(key).push(event.timestamp);
    } else if (event.eventType === 'course_unfavorited') {
      if (!unfavoriteTimesByCourse.has(key)) unfavoriteTimesByCourse.set(key, []);
      unfavoriteTimesByCourse.get(key).push(event.timestamp);
    }
  }

  const excluded = new Set();
  for (const event of sortedEvents) {
    const isPositiveEvent = event.eventType === 'course_viewed'
      || event.eventType === 'course_selected'
      || event.eventType === 'course_favorited';
    if (!isPositiveEvent) continue;
    const key = courseKey(event.course);
    const withdrawTimes = key ? withdrawTimesByCourse.get(key) : null;
    if (withdrawTimes?.some(t => t > event.timestamp)) {
      excluded.add(event.eventId);
      continue;
    }
    if (event.eventType === 'course_favorited') {
      const unfavoriteTimes = key ? unfavoriteTimesByCourse.get(key) : null;
      if (unfavoriteTimes?.some(t => t > event.timestamp)) excluded.add(event.eventId);
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

// Roadmap #40：`recommendation_accepted` 在 #7 混合權重下的對照歸因。每個
// `personalized_${axis}` 方案只有那一軸相對其他所有方案被放大（見
// `planStrategies.js` 的 `buildPlanStrategies()`），因此「這一軸的權重嚴格大於
// 這次曝光裡其他每一個方案」是唯一可靠、不會平手誤判的判定方式——恰好也代表
// 這個軸本來就不是 0（使用者已表態），跟 `scoringPolicy.js` 「boost 只能放大
// 已表態方向」的原則自然一致，不需要另外檢查。
function dominantAxes(acceptedPolicy, allPolicies) {
  const others = allPolicies.filter(policy => policy.planId !== acceptedPolicy.planId);
  if (others.length === 0) return [];
  return PREFERENCE_AXES.filter(axis => {
    const mine = Math.abs(Number(acceptedPolicy.weights?.[axis]) || 0);
    if (mine === 0) return false;
    return others.every(policy => mine > Math.abs(Number(policy.weights?.[axis]) || 0));
  });
}

function collectVotes(sortedEvents, { now, activeTerm } = {}) {
  const excludedPositiveEventIds = findExcludedPositiveEventIds(sortedEvents);
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
      const displayedCount = exposure?.exposureContext?.displayedPlanIds?.length ?? 0;
      // 只有曝光時真的有兩個以上方案可選，接受其中一個才算「看過對照組之後的
      // 選擇」；只有一個方案時，接受它說明不了使用者比較過什麼。
      if (displayedCount <= 1) continue;

      const policies = exposure?.exposureContext?.planPolicies ?? [];
      const acceptedPolicy = policies.find(policy => policy.planId === event.plan?.planId);

      if (acceptedPolicy) {
        // Roadmap #40：真的有這個方案自己的權重可比對，用對照歸因取代舊的
        // 靜態 variantId 表——見上面 `dominantAxes()` 的說明。
        for (const axis of dominantAxes(acceptedPolicy, policies)) {
          pushVote(axis, {
            ruleId: 'ACCEPT_VARIANT_CONTRAST',
            eventId: event.eventId,
            occurredAt: event.timestamp,
            strength: 'strong',
            baseWeight: STRONG_VOTE_WEIGHT,
          }, event);
        }
        continue;
      }

      // 真正的舊資料才會落到這裡：`planPolicies` 完全沒有，或曝光紀錄裡就是
      // 沒有被接受方案自己的權重（例如 #7 以前留下的事件）。現行排課引擎
      // 產生的 `personalized*` 方案一定有對應 policy，`policies.length > 0`
      // 在這裡出現代表資料本身有缺口，不是「新方案沒有 policy」，一律不猜。
      if (policies.length > 0 || event.plan?.variantId?.startsWith('personalized')) continue;
      const axis = VARIANT_AXIS[event.plan?.variantId];
      if (!axis) continue;
      pushVote(axis, {
        ruleId: 'ACCEPT_VARIANT',
        eventId: event.eventId,
        occurredAt: event.timestamp,
        strength: 'strong',
        baseWeight: STRONG_VOTE_WEIGHT,
      }, event);
      continue;
    }

    if (event.eventType === 'course_viewed') {
      if (excludedPositiveEventIds.has(event.eventId)) continue;
      pushVote('interest', {
        ruleId: 'VIEWED_WEAK',
        eventId: event.eventId,
        occurredAt: event.timestamp,
        strength: 'weak',
        baseWeight: WEAK_VOTE_WEIGHT,
      }, event);
      continue;
    }

    // Roadmap #40：收藏與手動選課都已經由 client 送到後端（`ScheduleContext.jsx`
    // 的 `toggleWatchlist()`／`addCourse()`），只是先前沒有任何學習邏輯讀過
    // 它們。兩者都是遠比「看了一眼」更明確的表態，列為強訊號，不受
    // `WEAK_VOTE_AXIS_CAP` 限制。
    if (event.eventType === 'course_favorited') {
      // 收藏當下的表態，不看 `source`——不管這門課是不是系統推薦或必修，
      // 「使用者主動點了收藏」這個動作本身就是興趣訊號。
      if (excludedPositiveEventIds.has(event.eventId)) continue;
      pushVote('interest', {
        ruleId: 'FAVORITED_STRONG',
        eventId: event.eventId,
        occurredAt: event.timestamp,
        strength: 'strong',
        baseWeight: STRONG_VOTE_WEIGHT,
      }, event);
      continue;
    }

    if (event.eventType === 'course_selected') {
      // 必修或系統已經推薦的課，被加進課表說明不了使用者在乎什麼——只有
      // `explicit_selection`（使用者自己找、自己加）才是興趣表態。
      if (event.source !== INTERACTION_SOURCES.EXPLICIT_SELECTION) continue;
      if (excludedPositiveEventIds.has(event.eventId)) continue;
      pushVote('interest', {
        ruleId: 'SELECTED_EXPLICIT_STRONG',
        eventId: event.eventId,
        occurredAt: event.timestamp,
        strength: 'strong',
        baseWeight: STRONG_VOTE_WEIGHT,
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
 *          代表這次呼叫沒有套用時間衰減。`axisSignal`（roadmap #40）逐軸回報
 *          `AXIS_SIGNAL_STATUS` 之一，獨立於 `sufficiency` 整體門檻計算。
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
  const axisSignal = {};
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
    const prior = clamp01(explicitProfile[axis] ?? 0);
    const folded = foldAxis(votes, prior);
    rawWeights[axis] = folded.weight;
    effectiveSampleSize[axis] = round3(folded.effectiveSampleSize);
    // Roadmap #40：用衰減／收縮後但**未套用** `insufficient` 回退的原始學習值
    // 分類——這裡要回答的是「這一軸的證據長什麼樣子」，跟「今天夠不夠格套用」
    // (`sufficiency.status`) 是两個不同的問題，即使整體 insufficient，個別軸
    // 只要有證據仍要如實回報。
    axisSignal[axis] = classifyAxisSignal({
      prior, effectiveSampleSize: folded.effectiveSampleSize, rawWeight: folded.weight,
    });
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
    // Roadmap #40：診斷欄位，不寫進 `Learned_Preference_Weights` 表、不影響
    // `weights` 或排課排序，見檔案頂部 `AXIS_SIGNAL_STATUS` 的說明。
    axisSignal,
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
  AXIS_SIGNAL_STATUS,
  REQUIRED_USABLE_EVENT_COUNT,
  PREFERENCE_DECAY_HALF_LIFE_DAYS,
  STALE_TERM_DECAY_FACTOR,
  learnPreferenceWeights,
  computeLearnedBoosts,
};

// ─────────────────────────────────────────────────────────────────────────────
// Roadmap #10 任務 3A：Choice Perceptron（Dragone, Teso, Passerini, AAAI 2018）
//
// **這個引擎目前只跑 shadow：不接 `learnPreferenceWeights()` 的出口、不升
// `PREFERENCE_LEARNING_MODEL_VERSION`、不寫 `Learned_Preference_Weights`。**
// 正式啟用（3B）要等部署後蒐集到真實 `plan_chosen`、重跑離線重播判定為 go 才做。
//
// 論文 Algorithm 1 與式 (1)：
//   Δ_t = φ(x_t, ȳ_t) − (1/(k−1))·Σ_{y∈Q_t, y≠ȳ_t} φ(x_t, y)
//   w_{t+1} = w_t + η·Δ_t
// 是「選中方案減去**其餘**方案的平均」，不是減整個 query 的平均，也不是減目前
// 模型的 argmax。論文 `w₁ = 0`、`η` 為固定 step-size（實驗中另以 CV 自適應調整）。
//
// 本系統對論文的四項偏離，全部在這裡發生，變更報告逐項標註：
//   1. `w₁` 取顯式偏好而非 0（`initialChoiceWeights()`）；
//   2. 每筆更新乘上時間衰減 `decay_t`（論文沒有；移除等於撤回 #31 對使用者的承諾）；
//   3. 全部累加完才把權重 clip 到 ±2 **一次**（論文沒有；逐步截斷是另一種演算法）；
//   4. 缺值逐軸遮罩（論文假設 φ 完整）。
// 因此本系統**不宣稱** Theorem 2 的 regret bound。
// ─────────────────────────────────────────────────────────────────────────────

export const CHOICE_PERCEPTRON_VERSION = 'choice-perceptron-v1';

// 權重投影上界。取 2 是因為現行 `scoringPolicy.js` 的權重絕對上界就是 2——沿用它，
// `PREFERENCE_SCALE`、#10 任務 1 剛校準的 `minGain` 與 87% 品質門檻都不必跟著動，
// `Learned_Preference_Weights` 的 `DECIMAL(4,3)`（±9.999）也永遠寫得進去。
export const CHOICE_WEIGHT_LIMIT = 2;

// `evidence[axis]` 只留最近這麼多筆更新軌跡。軌跡會經 #33 的匯出路徑出去，而 Δ
// 幾乎能反推使用者看過哪些方案的特徵，所以長度必須有界，不能讓一列 JSON 無限長。
export const EVIDENCE_TRAIL_LIMIT = 20;

// 論文實驗用的 η 候選集合（`t ≥ 3` 起每輪以 cross-validation 挑選）。這裡只當
// 3A-6 離線校準的掃描格點，執行期用單一固定值。
export const CHOICE_LEARNING_RATE_GRID = Object.freeze([0.1, 0.2, 0.5, 1, 2, 5, 10]);
export const DEFAULT_CHOICE_LEARNING_RATE = 1;

// **這個數字還沒有被校準，是暫定值。** 一次排課請求最多產生一筆 choice，所以它的
// 單位是「使用者排課並選擇過幾次」，與 v2 的 `REQUIRED_USABLE_EVENT_COUNT = 50`
// 不是同一種東西，刻意分開命名、也刻意不沿用那個數字。真正的值要由 3A-6 的離線
// 重播（「第幾次 choice 之後主推方案穩定」）決定；在那之前 `sufficiency.calibrated`
// 一律為 false，3B 不得拿未校準的門檻上線。
export const REQUIRED_CHOICE_COUNT = 10;

// 一筆 `plan_chosen` 不能用於學習的原因。全部都是「資料本身有缺口」，一律跳過
// 整筆、不做任何回退推估——沿用 `collectVotes()` 對缺 policy 的既有立場。
export const CHOICE_SKIP_REASONS = Object.freeze({
  NO_EXPOSURE: 'no-exposure',
  UNSUPPORTED_FEATURE_VERSION: 'unsupported-feature-version',
  SINGLE_PLAN: 'single-plan',
  INCOMPLETE_FEATURES: 'incomplete-features',
  CHOSEN_NOT_DISPLAYED: 'chosen-not-displayed',
});

// `w₁`。`interest` 恆為 0：它量的是「方案符合**這一次輸入**的興趣關鍵字的程度」
// （request scoped），`deriveExplicitProfile()` 沒有對應的長期欄位可以當起點；
// 把長期興趣方向持久化到 profile 是另一個題目。`compact`／`easy` 取顯式基準，
// 但一樣夾在 ±2 內，避免呼叫端傳進離譜的值。
function initialChoiceWeights(explicitProfile = {}) {
  return Object.fromEntries(PREFERENCE_AXES.map(axis => [
    axis,
    axis === 'interest' ? 0 : clipChoiceWeight(Number(explicitProfile?.[axis]) || 0),
  ]));
}

// `round3()` 會在「兩個相等的浮點數相減」時產生 -0（例如 0.4 − 0.4000000000000001）。
// -0 在 JSON 與 DECIMAL(4,3) 都等於 0，但 deepStrictEqual 分得出來，留著只會讓比對
// 與快照測試莫名其妙地失敗。統一正規化成 0。
function roundChoiceValue(value) {
  const rounded = round3(value);
  return Object.is(rounded, -0) ? 0 : rounded;
}

function clipChoiceWeight(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.min(CHOICE_WEIGHT_LIMIT, Math.max(-CHOICE_WEIGHT_LIMIT, value));
}

// 把一筆 `plan_chosen` 還原成論文的 (Q_t, ȳ_t)，或說出為什麼還原不了。
// 檢查順序與 `interactionEventService.assertProvenance()` 一致——那一層擋的是
// 「寫不寫得進去」，這一層擋的是「能不能拿來學」，兩者都必須成立。
function resolveChoiceQuery(event, exposure) {
  if (!exposure) return { reason: CHOICE_SKIP_REASONS.NO_EXPOSURE };
  const context = exposure.exposureContext || {};
  if (!context.planFeatureVersion) {
    return { reason: CHOICE_SKIP_REASONS.UNSUPPORTED_FEATURE_VERSION };
  }
  const displayedPlanIds = context.displayedPlanIds || [];
  if (displayedPlanIds.length < 2) return { reason: CHOICE_SKIP_REASONS.SINGLE_PLAN };

  const features = context.planFeatures || [];
  const byPlanId = new Map(features.map(item => [item.planId, item]));
  // 公式需要「其餘方案的平均」，所以整組方案都要有特徵，不是只有被選的那個。
  if (byPlanId.size !== displayedPlanIds.length
    || !displayedPlanIds.every(planId => byPlanId.has(planId))) {
    return { reason: CHOICE_SKIP_REASONS.INCOMPLETE_FEATURES };
  }

  const chosen = byPlanId.get(event.plan?.planId);
  if (!chosen) return { reason: CHOICE_SKIP_REASONS.CHOSEN_NOT_DISPLAYED };
  return {
    reason: null,
    chosen,
    others: features.filter(item => item.planId !== chosen.planId),
    querySize: features.length,
  };
}

// 單一軸的 Δ。**遮罩規則**：選中方案與**所有**未選方案在這一軸都要有值才更新；
// 任一方案該軸為 null 就回 null（本輪這一軸不動）。只對剩下的方案取平均等於
// 偷換 query set；補 0 則是把「查不到涼度」謊報成「完全不涼」。
function choiceAxisDelta(query, axis) {
  const chosenValue = query.chosen[axis];
  if (!Number.isFinite(chosenValue)) return null;
  const otherValues = query.others.map(item => item[axis]);
  if (otherValues.length === 0 || !otherValues.every(Number.isFinite)) return null;
  const mean = otherValues.reduce((sum, value) => sum + value, 0) / otherValues.length;
  return chosenValue - mean;
}

/**
 * Roadmap #10 任務 3A：從 `plan_chosen` 事件重播 Choice Perceptron。
 *
 * 與 `learnPreferenceWeights()` 相同的純函式紀律：不讀 DB、不呼叫排課、
 * 不取現在時間（`now` 只能由呼叫端傳入），同一批事件 ＋ 同一個 `now` ＋ 同一個
 * `activeTerm` 必須逐位元重現同一個結果。
 *
 * @param events   `getInteractionEventsForExport()` 的事件陣列（含曝光事件）。
 * @param options  `{ explicitProfile, now, activeTerm, learningRate }`。
 * @returns `{ modelVersion, learningRate, initialWeights, rawWeights, weights,
 *            sufficiency, evidence, decay, skipped }`。
 *          `rawWeights` 是未投影的累加值，`weights` 是最後 clip 一次的結果——
 *          兩者必須分開，否則讀 evidence 的人分不出哪個數字是哪一種。
 */
export function learnChoicePerceptronWeights(events = [], options = {}) {
  const {
    explicitProfile = {},
    now = null,
    activeTerm = null,
    learningRate = DEFAULT_CHOICE_LEARNING_RATE,
  } = options;

  const sorted = sortEvents(events);
  const exposures = indexExposuresByRequestId(sorted);
  const initialWeights = initialChoiceWeights(explicitProfile);
  const raw = { ...initialWeights };
  const evidence = Object.fromEntries(PREFERENCE_AXES.map(axis => [axis, []]));
  const updateCountByAxis = Object.fromEntries(PREFERENCE_AXES.map(axis => [axis, 0]));
  const skipped = [];
  let choiceCount = 0;

  for (const event of sorted) {
    if (event.eventType !== 'plan_chosen') continue;
    const query = resolveChoiceQuery(event, exposures.get(event.requestId));
    if (query.reason) {
      skipped.push({
        eventId: event.eventId ?? null,
        requestId: event.requestId ?? null,
        reason: query.reason,
      });
      continue;
    }

    choiceCount += 1;
    const { factor } = decayFactorFor(event, { now, activeTerm });
    for (const axis of PREFERENCE_AXES) {
      const delta = choiceAxisDelta(query, axis);
      if (delta === null) continue;
      raw[axis] += learningRate * factor * delta;
      updateCountByAxis[axis] += 1;
      evidence[axis].push({
        eventId: event.eventId ?? null,
        occurredAt: event.timestamp ?? null,
        requestId: event.requestId ?? null,
        chosenPlanId: event.plan?.planId ?? null,
        querySize: query.querySize,
        delta: roundChoiceValue(delta),
        decay: roundChoiceValue(factor),
        // 這一步之後的**未投影**累加值。最終存下來的值是全部累加完才 clip 的
        // `storedWeightAfterProjection`，兩者不可混用。
        rawWeightAfter: roundChoiceValue(raw[axis]),
      });
      if (evidence[axis].length > EVIDENCE_TRAIL_LIMIT) evidence[axis].shift();
    }
  }

  const rawWeights = Object.fromEntries(
    PREFERENCE_AXES.map(axis => [axis, roundChoiceValue(raw[axis])])
  );
  const weights = Object.fromEntries(
    PREFERENCE_AXES.map(axis => [axis, roundChoiceValue(clipChoiceWeight(raw[axis]))])
  );

  return {
    modelVersion: CHOICE_PERCEPTRON_VERSION,
    learningRate,
    initialWeights,
    rawWeights,
    weights,
    sufficiency: {
      status: choiceCount >= REQUIRED_CHOICE_COUNT
        ? SUFFICIENCY_STATUS.SUFFICIENT
        : SUFFICIENCY_STATUS.INSUFFICIENT,
      // 門檻尚未由真實資料校準，3B 不得據此上線。見 REQUIRED_CHOICE_COUNT。
      calibrated: false,
      choiceCount,
      requiredChoiceCount: REQUIRED_CHOICE_COUNT,
      // 逐軸更新次數。`easy` 常因缺評價被遮罩，只看 choiceCount 會把
      // 「這一軸其實一次都沒學過」誤報成資料充分。
      choiceCountByAxis: updateCountByAxis,
    },
    evidence,
    storedWeightAfterProjection: weights,
    decay: {
      halfLifeDays: PREFERENCE_DECAY_HALF_LIFE_DAYS,
      staleTermFactor: STALE_TERM_DECAY_FACTOR,
      appliedAt: now == null ? null : new Date(now).toISOString(),
      activeTerm,
    },
    skipped,
  };
}
