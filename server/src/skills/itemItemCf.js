// 協同過濾與 User Embedding 構想階段 7：item-item 協同過濾（構想 4.1、4.3）。
//
// 互動表：列是 subject，欄是課號，值是使用者對該課的訊號（−1～1）。
//   - 歷史修課：已通過的選修、通識、系外選修 +0.5；回答「不喜歡」的課改由回饋事件決定。
//   - 互動事件：沿用標籤興趣的事件權重（收藏、高分評價、自願加選、退選原因、歷史修課回饋…）。
//     事件快照已排除必修；探索問卷的回饋是對標籤的看法、不是對課，不列入。
// 共現只看「選了」：訊號 ≥ positiveThreshold（0.5，單純瀏覽不算）。
//
//   sim(A, B) = co / sqrt(nA × nB) × co / (co + β)        co < minCooccurrence 的配對不保留
//   s_cf(u, c) = Σ sim(c, j) × w_u(j) / max(1, Σ sim(c, j))  j 取 c 的前 K 個相近課中 u 有訊號的
//
// 分母取 max(1, …)：相近課的相似度總和不到 1 時分數跟著變小，不會因為只有一門很弱的相近課就變成 ±1。
import { collectWeightedTagInterestEvents } from './tagInterestLearning.js';
import { getPassedNonRequiredAttempts } from '../data/courseHistory.js';

export const CF_MODEL_VERSION = 'item-item-cf-v1';

export const CF_DEFAULTS = Object.freeze({
  historyWeight: 0.5,
  positiveThreshold: 0.5,
  minCooccurrence: 3,
  shrinkageBeta: 5,
  topK: 20,
});

// 構想 4.6 的啟用門檻（第三版）：只計真人，Persona／demo 不算。
export const CF_ACTIVATION_GATE = Object.freeze({
  minRealContributors: 15,
  minInteractionsPerContributor: 3,
  minCooccurrence: 3,
});

function normalizeCode(value) {
  return String(value ?? '').trim().toUpperCase();
}

const clamp = value => Math.max(-1, Math.min(1, value));

/** 一位使用者對各課的訊號（Map 課號 → −1～1）。 */
export function buildUserCourseSignals({ courseHistory = [], events = [], now = null, activeTerm = null, options = {} } = {}) {
  const settings = { ...CF_DEFAULTS, ...options };
  const weighted = collectWeightedTagInterestEvents(events, { now, activeTerm }).items
    .filter(item => item.event.eventType !== 'interest_exploration_feedback');
  const courseOf = item => normalizeCode(item.snapshot?.course?.catalogCourseCode ?? item.event?.course?.catalogCourseCode);
  const dislikedHistory = new Set(weighted
    .filter(item => item.event.eventType === 'history_course_feedback' && item.weight < 0)
    .map(courseOf));

  const totals = new Map();
  const add = (code, weight) => {
    if (!code) return;
    totals.set(code, (totals.get(code) ?? 0) + weight);
  };
  for (const entry of getPassedNonRequiredAttempts(courseHistory)) {
    const code = normalizeCode(entry.courseCode);
    if (!dislikedHistory.has(code)) add(code, settings.historyWeight);
  }
  for (const item of weighted) add(courseOf(item), item.weight);

  const signals = new Map();
  for (const [code, total] of totals) {
    if (total !== 0) signals.set(code, clamp(total));
  }
  return signals;
}

/** 有效互動數：訊號絕對值達門檻的課數（構想 4.6「每人非必修互動」）。 */
export function countEffectiveInteractions(signals, { positiveThreshold = CF_DEFAULTS.positiveThreshold } = {}) {
  let count = 0;
  for (const value of signals.values()) if (Math.abs(value) >= positiveThreshold) count += 1;
  return count;
}

/**
 * 由多位貢獻者的訊號建立相近課表。
 * @param contributors [{ signals: Map, simulated: boolean }]
 * @returns { neighbors: Map(課號 → [{ courseCode, similarity, coCount }]), stats }
 */
export function buildCourseNeighbors(contributors = [], options = {}) {
  const settings = { ...CF_DEFAULTS, ...options };
  const counts = new Map();
  const pairCounts = new Map();
  const pairKey = (a, b) => (a < b ? `${a}\u0000${b}` : `${b}\u0000${a}`);
  let usedContributors = 0;

  for (const contributor of contributors) {
    const chosen = [...(contributor.signals ?? new Map())]
      .filter(([, value]) => value >= settings.positiveThreshold)
      .map(([code]) => code)
      .sort();
    if (chosen.length === 0) continue;
    usedContributors += 1;
    for (const code of chosen) counts.set(code, (counts.get(code) ?? 0) + 1);
    for (let i = 0; i < chosen.length; i += 1) {
      for (let j = i + 1; j < chosen.length; j += 1) {
        const key = pairKey(chosen[i], chosen[j]);
        pairCounts.set(key, (pairCounts.get(key) ?? 0) + 1);
      }
    }
  }

  const neighbors = new Map();
  let keptPairs = 0;
  let droppedPairs = 0;
  for (const [key, coCount] of pairCounts) {
    if (coCount < settings.minCooccurrence) { droppedPairs += 1; continue; }
    keptPairs += 1;
    const [a, b] = key.split('\u0000');
    const similarity = coCount / Math.sqrt(counts.get(a) * counts.get(b))
      * (coCount / (coCount + settings.shrinkageBeta));
    for (const [from, to] of [[a, b], [b, a]]) {
      const list = neighbors.get(from) ?? [];
      list.push({ courseCode: to, similarity, coCount });
      neighbors.set(from, list);
    }
  }
  for (const [code, list] of neighbors) {
    list.sort((x, y) => y.similarity - x.similarity || x.courseCode.localeCompare(y.courseCode));
    neighbors.set(code, list.slice(0, settings.topK));
  }
  return {
    neighbors,
    stats: {
      contributors: contributors.length,
      usedContributors,
      courses: counts.size,
      keptPairs,
      droppedPairs,
      neighborRows: [...neighbors.values()].reduce((sum, list) => sum + list.length, 0),
    },
  };
}

/** 構想 4.6 門檻是否達到。貢獻者需標記 simulated；只算真人。 */
export function evaluateCfActivationGate(contributors = [], keptPairs = 0, gate = CF_ACTIVATION_GATE) {
  const real = contributors.filter(item => !item.simulated);
  const eligibleReal = real.filter(item => countEffectiveInteractions(item.signals ?? new Map())
    >= gate.minInteractionsPerContributor);
  return {
    realContributors: real.length,
    eligibleRealContributors: eligibleReal.length,
    simulatedContributors: contributors.length - real.length,
    keptPairs,
    met: eligibleReal.length >= gate.minRealContributors && keptPairs > 0,
    gate: { ...gate },
  };
}

/** s_cf(u, c)：使用者訊號 × 相近課表。沒有任何相近課與使用者訊號重疊時為 null。 */
export function scoreCoursesWithCf(signals, neighbors, courseCodes = []) {
  const results = new Map();
  for (const code of new Set(courseCodes.map(normalizeCode))) {
    if (!code) continue;
    let weighted = 0;
    let mass = 0;
    let matched = 0;
    for (const neighbor of neighbors?.get(code) ?? []) {
      const signal = signals?.get(neighbor.courseCode);
      if (signal === undefined) continue;
      weighted += neighbor.similarity * signal;
      mass += neighbor.similarity;
      matched += 1;
    }
    results.set(code, matched === 0
      ? { score: null, matched: 0 }
      : { score: clamp(weighted / Math.max(1, mass)), matched });
  }
  return results;
}

export default {
  CF_MODEL_VERSION,
  CF_DEFAULTS,
  CF_ACTIVATION_GATE,
  buildUserCourseSignals,
  countEffectiveInteractions,
  buildCourseNeighbors,
  evaluateCfActivationGate,
  scoreCoursesWithCf,
};
