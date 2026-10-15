// 協同過濾與 User Embedding 構想階段 3：標籤空間的使用者向量與課程分數 s_vec。
// 構想見 docs/CHANGE_REPORTS/2026-10-14-cf-user-embedding-design.md 3.3～3.6。
//
// 使用者向量 = 明確興趣（先驗）＋ 非必修歷史修課 ＋ 互動事件，三者都換成 tagVectorSpace.js 的
// 課程標籤向量（單位長度）再加權相加。正向與負向分開存，不相減。
//
//   - 明確興趣：使用者填的興趣與關鍵字對應到向量標籤（含常見主題），單位向量 × priorMass。
//   - 歷史修課：最新一次已通過、畢業分類為選修／通識／系外；必修與不計學分課不算。
//     權重 historyWeight × historyTermDecay^(距今學期數)。歷史修課不用 120 天半衰期，
//     否則大一修的課到大四幾乎歸零。
//   - 歷史修課回饋（階段 5）：喜歡 +1、不喜歡 −1（並取消該課的 historyWeight）、普通 0。
//   - 互動事件：沿用 rag-tag-interest-v1 的權重、衰減、失效與瀏覽上限
//     （collectWeightedTagInterestEvents）。興趣探索回饋只用使用者勾選的標籤；
//     其他事件用整門課的向量。
//
// s_vec = 正向相似 − λ × 負向相似，各自以候選池內第 95 百分位縮放到 0～1（見 scoreCoursesForUser）。
// 純函式，不碰資料庫，也還沒接進排課。

import { normalizeSemesterLabel } from '../data/activeTerm.js';
import { getPassedNonRequiredAttempts } from '../data/courseHistory.js';
import { resolveInterestTags } from '../data/interestTagCatalog.js';
import { buildExplicitTagInterest, collectWeightedTagInterestEvents } from './tagInterestLearning.js';
import { isVectorEligibleTag, softCosine } from './tagVectorSpace.js';

export const USER_TAG_VECTOR_MODEL_VERSION = 'user-tag-vector-v1';
export const USER_TAG_VECTOR_DEFAULTS = Object.freeze({
  historyWeight: 0.5,
  historyTermDecay: 0.8,
  priorMass: 2,
  negativeLambda: 1,
  // 以池內正向（負向）相似度的這個百分位為 1，超過的截到 1。
  referencePercentile: 0.95,
});

function normalizeCode(value) {
  return String(value ?? '').trim().toUpperCase();
}

function unit(vector) {
  let norm = 0;
  for (const value of vector.values()) norm += value * value;
  norm = Math.sqrt(norm);
  if (!(norm > 0)) return null;
  return new Map([...vector].map(([id, value]) => [id, value / norm]));
}

function addScaled(target, vector, scale) {
  for (const [id, value] of vector) target.set(id, (target.get(id) ?? 0) + value * scale);
}

// 與課程向量同一套權重（idf × 降權係數），明確興趣與回饋標籤才不會繞過降權。
function vectorFromTagIds(tagIds, index) {
  const vector = new Map();
  for (const id of tagIds) {
    const weight = (index.tagWeights ?? index.idf).get(id);
    if (weight > 0) vector.set(id, weight);
  }
  return vector;
}

function termOrdinal(year, semester) {
  const academicYear = Number(year);
  const label = normalizeSemesterLabel(semester);
  if (!Number.isInteger(academicYear) || label === null) return null;
  return academicYear * 2 + (label === 'second' ? 1 : 0);
}

/**
 * @param input.courseHistory   使用者的 courseHistory（`User_Course_History` 映射）
 * @param input.events          已同意、未到期的互動事件（含標籤快照）
 * @param input.prefs           使用者偏好（讀興趣與關鍵字）
 * @param input.index           buildCourseTagVectors() 的結果
 * @param input.activeTerm      { academicYear, semester }
 * @param input.excludeCourseCodes  評估用：把這些課號的歷史與事件排除（留一法）
 */
export function buildUserTagVector({
  courseHistory = [], events = [], prefs = {}, index, activeTerm, now = null,
  excludeCourseCodes = [], options = {},
} = {}) {
  const settings = { ...USER_TAG_VECTOR_DEFAULTS, ...options };
  const excluded = new Set(excludeCourseCodes.map(normalizeCode));
  const positive = new Map();
  const negative = new Map();
  const evidence = [];
  // 使用者明確拒絕過的課（探索卡沒興趣、因內容退選、不喜歡的修過課…）。探索頁不再推薦它們：
  // 探索卡的沒興趣只把選到的標籤放進負向向量，課的其他標籤仍可能讓它排在前面（2026-10-15 Persona 實測）。
  const rejectedCourseCodes = new Set();
  const sources = {
    explicitTags: 0, unmappedTopics: [], historyCourses: 0, historyWithoutVector: 0, historyDisliked: 0,
    positiveEvents: 0, negativeEvents: 0,
  };

  // 明確興趣：與標籤興趣檔不同，常見主題（機器學習等）在向量裡可以用。
  const explicit = buildExplicitTagInterest(prefs);
  const explicitIds = new Set();
  for (const topic of explicit.explicitTopics) {
    const tags = resolveInterestTags([topic]).tags.filter(isVectorEligibleTag);
    if (tags.length === 0) sources.unmappedTopics.push(topic);
    tags.forEach(tag => explicitIds.add(tag.canonicalTagId));
  }
  const explicitVector = unit(vectorFromTagIds(explicitIds, index));
  if (explicitVector) {
    addScaled(positive, explicitVector, settings.priorMass);
    sources.explicitTags = explicitVector.size;
  }

  // 互動事件（含歷史修課回饋）先算好：回答「不喜歡」的歷史課不再給 +historyWeight。
  const weightedEvents = collectWeightedTagInterestEvents(events, { now, activeTerm }).items;
  const dislikedHistory = new Set(weightedEvents
    .filter(item => item.event.eventType === 'history_course_feedback' && item.weight < 0)
    .map(item => normalizeCode(item.snapshot?.course?.catalogCourseCode ?? item.event?.course?.catalogCourseCode)));

  // 歷史修課。
  const activeOrdinal = termOrdinal(activeTerm?.academicYear, activeTerm?.semester);
  for (const entry of getPassedNonRequiredAttempts(courseHistory)) {
    const code = normalizeCode(entry.courseCode);
    if (excluded.has(code)) continue;
    if (dislikedHistory.has(code)) { sources.historyDisliked += 1; continue; }
    const vector = unit(index.vectors.get(code)?.weights ?? new Map());
    if (!vector) {
      sources.historyWithoutVector += 1;
      continue;
    }
    const ordinal = termOrdinal(entry.academicYear, entry.semester);
    const termsAgo = activeOrdinal !== null && ordinal !== null ? Math.max(0, activeOrdinal - ordinal) : 0;
    const weight = settings.historyWeight * Math.pow(settings.historyTermDecay, termsAgo);
    addScaled(positive, vector, weight);
    sources.historyCourses += 1;
    evidence.push({ source: 'history', courseCode: code, name: entry.courseName ?? '', weight, vector });
  }

  // 互動事件。
  for (const item of weightedEvents) {
    const code = normalizeCode(item.snapshot?.course?.catalogCourseCode ?? item.event?.course?.catalogCourseCode);
    if (code && excluded.has(code)) continue;
    if (code && item.weight < 0) rejectedCourseCodes.add(code);
    const courseVector = item.event.eventType === 'interest_exploration_feedback'
      ? null
      : index.vectors.get(code)?.weights;
    const vector = unit(courseVector?.size ? courseVector : vectorFromTagIds(item.tagIds, index));
    if (!vector) continue;
    if (item.weight > 0) {
      addScaled(positive, vector, item.weight);
      sources.positiveEvents += 1;
      evidence.push({ source: item.event.eventType, courseCode: code, name: index.courseNames?.get(code) ?? '', weight: item.weight, vector });
    } else {
      addScaled(negative, vector, Math.abs(item.weight));
      sources.negativeEvents += 1;
    }
  }

  return { modelVersion: USER_TAG_VECTOR_MODEL_VERSION, positive, negative, evidence, sources, settings, rejectedCourseCodes };
}

function percentile(values, q) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
}

/**
 * 候選課的 s_vec。回傳 Map：課號 → { raw, score, positive, negative }。
 *
 * score = min(1, 正向相似 ÷ 池內正向相似的第 95 百分位) − λ × min(1, 負向相似 ÷ 負向的第 95 百分位)。
 * **與使用者完全沒有相似（正負都是 0）的課 score 為 null**，與標籤興趣檔的 no_user_signal 一致：
 * 沒有證據不等於不喜歡，不扣分。（構想原本用池內平均／標準差，實測會讓六成以上的課只因為
 * 沒有共用標籤就變成負分，見階段 3 報告。）
 */
export function scoreCoursesForUser(user, index, courseCodes, { similarity = null } = {}) {
  const settings = user?.settings ?? USER_TAG_VECTOR_DEFAULTS;
  const results = new Map();
  for (const code of new Set(courseCodes.map(normalizeCode))) {
    const vector = index.vectors.get(code)?.weights;
    const positive = softCosine(user.positive, vector, similarity).similarity;
    const negative = softCosine(user.negative, vector, similarity).similarity;
    const raw = positive === null && negative === null
      ? null
      : (positive ?? 0) - settings.negativeLambda * (negative ?? 0);
    results.set(code, { raw, score: null, positive, negative });
  }
  const reference = key => percentile(
    [...results.values()].map(item => item[key]).filter(value => value > 0),
    settings.referencePercentile,
  );
  const positiveRef = reference('positive');
  const negativeRef = reference('negative');
  for (const item of results.values()) {
    const p = item.positive > 0 && positiveRef > 0 ? Math.min(1, item.positive / positiveRef) : 0;
    const n = item.negative > 0 && negativeRef > 0 ? Math.min(1, item.negative / negativeRef) : 0;
    if (p === 0 && n === 0) continue;
    item.score = Math.max(-1, Math.min(1, p - settings.negativeLambda * n));
  }
  return results;
}

/** 推薦理由：貢獻最大的標籤配對，以及使用者證據中與這門課最接近的一門。 */
export function explainCourseForUser(user, index, courseCode, { similarity = null, topTags = 3 } = {}) {
  const vector = index.vectors.get(normalizeCode(courseCode))?.weights;
  const { contributions } = softCosine(user.positive, vector, similarity, { withContributions: true });
  const name = id => index.tagNames.get(id) ?? id;
  let closest = null;
  const target = normalizeCode(courseCode);
  for (const item of user.evidence) {
    // 「和你收藏的這門課很像」對同一門課沒有資訊量，理由只引用其他課。
    if (item.courseCode === target) continue;
    const value = softCosine(item.vector, vector, similarity).similarity;
    if (value !== null && (!closest || value > closest.similarity)) {
      closest = { source: item.source, courseCode: item.courseCode, name: item.name, similarity: value };
    }
  }
  return {
    // 同一個課程標籤可能和使用者的好幾個標籤相近；理由只列一次，取貢獻最大的那組配對
    // （contributions 已依貢獻由大到小排序）。
    tags: contributions
      .filter((item, i) => contributions.findIndex(other => other.right === item.right) === i)
      .slice(0, topTags)
      .map(item => ({
        userTag: name(item.left),
        courseTag: name(item.right),
        viaNeighbor: item.left !== item.right,
        contribution: item.contribution,
      })),
    closestEvidence: closest,
  };
}

export default {
  USER_TAG_VECTOR_MODEL_VERSION,
  USER_TAG_VECTOR_DEFAULTS,
  buildUserTagVector,
  scoreCoursesForUser,
  explainCourseForUser,
};
