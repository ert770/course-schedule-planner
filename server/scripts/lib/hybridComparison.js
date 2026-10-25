// roadmap #32／協同過濾構想階段 8 的離線比較：可單元測試的純函式（hybridComparisonStage8.js 使用）。
import { collectWeightedTagInterestEvents } from '../../src/skills/tagInterestLearning.js';
import { CF_DEFAULTS } from '../../src/skills/itemItemCf.js';

export const TEST_FRACTION = 0.3;
export const BOOTSTRAP_ROUNDS = 2000;
const OUTCOME_EXCLUDED = new Set(['history_course_feedback', 'interest_exploration_feedback']);

const code = value => String(value ?? '').trim().toUpperCase();
const round = (value, digits = 3) => (value === null || value === undefined || Number.isNaN(value) ? null : Number(value.toFixed(digits)));
const mean = values => (values.length ? values.reduce((sum, v) => sum + v, 0) / values.length : null);
const courseOf = item => code(item.snapshot?.course?.catalogCourseCode ?? item.event?.course?.catalogCourseCode);
const timeOf = event => Date.parse(event?.timestamp ?? '');

// 固定種子的亂數（mulberry32），bootstrap 可重現。
export function rng(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6D2B79F5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function bootstrapDiff(pairs, rounds = BOOTSTRAP_ROUNDS, seed = 20261015) {
  if (pairs.length < 2) return { n: pairs.length, mean: round(mean(pairs)), ci95: null };
  const random = rng(seed);
  const means = [];
  for (let r = 0; r < rounds; r += 1) {
    let sum = 0;
    for (let i = 0; i < pairs.length; i += 1) sum += pairs[Math.floor(random() * pairs.length)];
    means.push(sum / pairs.length);
  }
  means.sort((a, b) => a - b);
  return {
    n: pairs.length,
    mean: round(mean(pairs)),
    ci95: [round(means[Math.floor(rounds * 0.025)]), round(means[Math.floor(rounds * 0.975)])],
  };
}

/** 名次（1 起算；同分取平均）。 */
export function rankOf(target, codes, scoreFn) {
  const own = scoreFn(target);
  let greater = 0;
  let ties = 0;
  for (const other of codes) {
    if (other === target) continue;
    const value = scoreFn(other);
    if (value > own) greater += 1;
    else if (value === own) ties += 1;
  }
  return 1 + greater + ties / 2;
}

export function topK(codes, scoreFn, k) {
  return [...codes].sort((a, b) => scoreFn(b) - scoreFn(a) || a.localeCompare(b)).slice(0, k);
}

/** 一位 Persona 的結果事件與切點。 */
export function splitOutcomes(events, { activeTerm = null, testFraction = TEST_FRACTION } = {}) {
  const outcomes = collectWeightedTagInterestEvents(events, { now: null, activeTerm }).items
    .filter(item => item.weight >= CF_DEFAULTS.positiveThreshold && !OUTCOME_EXCLUDED.has(item.event.eventType))
    .filter(item => courseOf(item) && Number.isFinite(timeOf(item.event)))
    .sort((a, b) => timeOf(a.event) - timeOf(b.event));
  const firstSeen = new Map();
  for (const item of outcomes) if (!firstSeen.has(courseOf(item))) firstSeen.set(courseOf(item), timeOf(item.event));
  const ordered = [...firstSeen].sort((a, b) => a[1] - b[1]);
  if (ordered.length === 0) return null;
  const testCount = Math.max(1, Math.ceil(ordered.length * testFraction));
  const test = ordered.slice(-testCount);
  return { cutoff: test[0][1], testCodes: test.map(([c]) => c), outcomeCount: ordered.length };
}

