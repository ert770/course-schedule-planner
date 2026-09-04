import { shrinkEasiness, SHRINKAGE_PRIOR_WEIGHT } from './reviewStats.js';

// Roadmap #30：把互動事件折成 per-user 偏好權重。
//
// **這個模組只從事件推導，不讀資料庫、不呼叫排課**——與 #26 的
// `recommendationReason.js`、#27 的 `planComparison.js` 同一條原則。呼叫端
// （`preferenceLearningService.js`）負責取事件、檢查 consent、寫表；這裡只做
// 「一批事件 → 一組權重」這個純函式轉換，因此**可重播**是自動成立的：同一份
// 輸入永遠得到同一份輸出，不依賴時間、不依賴呼叫順序、不讀任何外部狀態。

export const PREFERENCE_LEARNING_MODEL_VERSION = 'preference-learning-v1';

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
// 不會因為筆數多就贏過使用者退課、接受方案這種明確行為。
const WEAK_VOTE_AXIS_CAP = STRONG_VOTE_WEIGHT;

function clamp01(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
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

function collectVotes(sortedEvents) {
  const excludedViewEventIds = findExcludedViewEventIds(sortedEvents);
  const exposureByRequestId = indexExposuresByRequestId(sortedEvents);
  const votesByAxis = { interest: [], compact: [], easy: [] };

  const pushVote = (axis, vote) => {
    votesByAxis[axis].push(vote);
  };

  for (const event of sortedEvents) {
    if (event.eventType === 'course_withdrawn') {
      const rule = WITHDRAW_REASON_RULES[event.feedbackReason];
      if (rule) {
        pushVote(rule.axis, {
          ruleId: rule.ruleId,
          eventId: event.eventId,
          occurredAt: event.timestamp,
          weight: STRONG_VOTE_WEIGHT,
        });
      }
      continue;
    }

    if (event.eventType === 'recommendation_accepted') {
      const axis = VARIANT_AXIS[event.plan?.variantId];
      if (!axis) continue;
      const exposure = exposureByRequestId.get(event.requestId);
      const displayedCount = exposure?.exposureContext?.displayedPlanIds?.length ?? 0;
      // 只有曝光時真的有兩個以上方案可選，接受其中一個才算「看過對照組之後的
      // 選擇」；只有一個方案時，接受它說明不了使用者比較過什麼。
      if (displayedCount > 1) {
        pushVote(axis, {
          ruleId: 'ACCEPT_VARIANT',
          eventId: event.eventId,
          occurredAt: event.timestamp,
          weight: STRONG_VOTE_WEIGHT,
        });
      }
      continue;
    }

    if (event.eventType === 'course_viewed') {
      if (excludedViewEventIds.has(event.eventId)) continue;
      pushVote('interest', {
        ruleId: 'VIEWED_WEAK',
        eventId: event.eventId,
        occurredAt: event.timestamp,
        weight: WEAK_VOTE_WEIGHT,
      });
    }
  }

  return votesByAxis;
}

// 單一軸：把投票折成一個 [0,1] 的權重。
//
// 弱訊號先各自加總再整體 cap 在一筆強訊號的份量，接著把「強訊號 + capped 弱
// 訊號」當成一組樣本，用 `reviewStats.js` 既有的 m-estimate 往顯式基準收縮
// ——不另發明一套數學，語意也一致：樣本少（n 小）就更靠近使用者原本設定的
// 值，樣本多就更靠近行為顯示的方向。最後用 `Math.max` 頂住下限，
// 比照 `scheduler.js` 的 `compactWeight = Math.max(weights.compact, ...)`
// ——顯式設定只能被行為加強，不能被行為推翻。
function foldAxis(votes, explicitBaseline) {
  const prior = clamp01(explicitBaseline);
  if (votes.length === 0) {
    return { weight: prior, rawValue: 0, sampleSize: 0 };
  }

  const strongVotes = votes.filter(vote => vote.weight >= STRONG_VOTE_WEIGHT);
  const weakVotes = votes.filter(vote => vote.weight < STRONG_VOTE_WEIGHT);

  const strongSum = strongVotes.length * STRONG_VOTE_WEIGHT;
  const weakRawSum = weakVotes.reduce((sum, vote) => sum + vote.weight, 0);
  const weakCapped = Math.min(weakRawSum, WEAK_VOTE_AXIS_CAP);

  const rawSum = strongSum + weakCapped;
  // capped 弱訊號整組算一個樣本——它的總效果已經被鎖在「一筆強訊號」以內，
  // 用一個樣本代表它，量再多也不會在 n 上取得優勢。
  const sampleSize = strongVotes.length + (weakCapped > 0 ? 1 : 0);
  const rawValue = sampleSize > 0 ? rawSum / sampleSize : 0;

  const shrunk = shrinkEasiness(rawValue, sampleSize, prior, SHRINKAGE_PRIOR_WEIGHT);
  const weight = Math.max(clamp01(shrunk ?? prior), prior);

  return { weight, rawValue, sampleSize };
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
 * @returns 見檔案頂部註解的回傳形狀；`weights` 在 `insufficient` 時等於
 *          （clamp 過的）`explicitProfile`，不是半調子的學習值。
 */
export function learnPreferenceWeights(events = [], options = {}) {
  const explicitProfile = options.explicitProfile ?? {};
  const sorted = sortEvents(events);
  const votesByAxis = collectVotes(sorted);

  const rawWeights = {};
  const evidence = {};
  let usableEventCount = 0;
  const missingAxes = [];

  for (const axis of PREFERENCE_AXES) {
    const votes = votesByAxis[axis];
    usableEventCount += votes.length;
    if (votes.length === 0) missingAxes.push(axis);

    evidence[axis] = votes.map(({ ruleId, eventId, occurredAt }) => ({ ruleId, eventId, occurredAt }));
    rawWeights[axis] = foldAxis(votes, explicitProfile[axis] ?? 0).weight;
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
  };
}

export default {
  PREFERENCE_LEARNING_MODEL_VERSION,
  PREFERENCE_AXES,
  SUFFICIENCY_STATUS,
  REQUIRED_USABLE_EVENT_COUNT,
  learnPreferenceWeights,
};
