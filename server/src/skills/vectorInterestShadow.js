// 協同過濾與 User Embedding 構想階段 6：標籤向量相似度 s_vec 以 shadow 接進排課。
//
// shadow 照常計算、記錄，但 s_vec 以 0 計入，不改變任何排序或方案。
// 記錄的是「如果啟用，排序會差多少」：
//   - 候選池：每個決策點的候選順序、第一名是否會不同（候選分 + α_vec × 基礎分 × s_vec）。
//   - 方案：方案分 + 方案偏好分 × α_vec × 平均 s_vec 後，方案名次與推薦方案是否會不同。
//   - s_tag 與 s_vec 的相關係數：兩者都來自 rag_tag，相關太高代表同一個訊號會被算兩次。
// 階段 7 的協同過濾 s_cf 用同一套 shadow（context 結構相同，scheduler 分開記錄）。

/**
 * 從課號分數建立以班次為鍵的 context。
 * `scoredSource` 是「有分數」時的來源名稱（s_vec 或 cf）；其他來源代表整體不可用，原因即來源本身。
 */
export function buildVectorInterestContext({
  mode = 'off',
  source = 'unavailable',
  modelVersion = null,
  alpha = 0,
  candidates = [],
  scores = null,
  scoredSource = 's_vec',
  noScoreReason = 'no_similarity',
} = {}) {
  const coursesBySectionId = {};
  if (mode !== 'off') {
    for (const course of Array.isArray(candidates) ? candidates : []) {
      const sectionId = String(course?.sectionId ?? course?.id ?? '').trim();
      if (!sectionId || Object.hasOwn(coursesBySectionId, sectionId)) continue;
      const code = String(course?.catalogCourseCode ?? '').trim().toUpperCase();
      const scored = source === scoredSource ? scores?.get(code) : null;
      const score = Number.isFinite(scored?.score) ? scored.score : null;
      coursesBySectionId[sectionId] = {
        score,
        reason: source !== scoredSource ? source : score === null ? noScoreReason : 'scored',
      };
    }
  }
  return { mode, source, modelVersion, alpha, coursesBySectionId };
}

export function pearsonCorrelation(xs, ys) {
  const n = Math.min(xs.length, ys.length);
  if (n < 3) return null;
  const mean = values => values.reduce((sum, value) => sum + value, 0) / n;
  const mx = mean(xs.slice(0, n));
  const my = mean(ys.slice(0, n));
  let sxy = 0; let sxx = 0; let syy = 0;
  for (let i = 0; i < n; i += 1) {
    const dx = xs[i] - mx;
    const dy = ys[i] - my;
    sxy += dx * dy; sxx += dx * dx; syy += dy * dy;
  }
  if (sxx === 0 || syy === 0) return null;
  return sxy / Math.sqrt(sxx * syy);
}

export function createVectorInterestShadowStats(vectorContext, tagInterestContext = null) {
  if (vectorContext?.mode !== 'shadow') return null;
  const stats = {
    source: vectorContext.source,
    modelVersion: vectorContext.modelVersion,
    alphaVec: vectorContext.alpha,
    gateMet: vectorContext.gateMet ?? null,
    simulated: vectorContext.simulated === true,
    candidates: { positive: 0, neutral: 0, negative: 0, noScore: 0 },
    correlation: { pairs: 0, pearson: null },
    poolComparisons: 0,
    changedPoolComparisons: 0,
    changedTopChoices: 0,
    comparedCandidates: 0,
    plans: {
      compared: 0,
      withEvidence: 0,
      meanCoverage: null,
      changedPositions: 0,
      orderChanged: false,
      recommendedChanged: false,
    },
  };
  const tagScores = [];
  const vecScores = [];
  for (const [sectionId, entry] of Object.entries(vectorContext.coursesBySectionId || {})) {
    if (entry.score === null) stats.candidates.noScore += 1;
    else if (entry.score > 0) stats.candidates.positive += 1;
    else if (entry.score < 0) stats.candidates.negative += 1;
    else stats.candidates.neutral += 1;
    const tag = tagInterestContext?.coursesBySectionId?.[sectionId];
    if (entry.score !== null && Number.isFinite(tag?.score) && Number(tag?.evidenceTagCount) > 0) {
      tagScores.push(tag.score);
      vecScores.push(entry.score);
    }
  }
  stats.correlation = { pairs: tagScores.length, pearson: pearsonCorrelation(tagScores, vecScores) };
  return stats;
}

/** 一個決策點：實際順序 vs. 加上 s_vec 後的順序。 */
export function recordVectorShadowPoolRanking(stats, candidates, actualScore, vectorDelta) {
  if (!stats || candidates.length < 2) return;
  const scored = candidates.map(course => {
    const actual = actualScore(course);
    return { id: Number(course.id), actual, shadow: actual + vectorDelta(course) };
  });
  const order = key => [...scored]
    .sort((left, right) => right[key] - left[key] || left.id - right.id)
    .map(item => item.id);
  const actualOrder = order('actual');
  const shadowOrder = order('shadow');
  stats.poolComparisons += 1;
  stats.comparedCandidates += candidates.length;
  if (actualOrder.some((id, index) => id !== shadowOrder[index])) stats.changedPoolComparisons += 1;
  if (actualOrder[0] !== shadowOrder[0]) stats.changedTopChoices += 1;
}

/** 方案層：平均 s_vec 只計入有分數的自由選擇課，涵蓋率分開記錄。 */
export function scorePlanVectorInterest(freeChoiceCourses, vectorContext) {
  const courses = Array.isArray(freeChoiceCourses) ? freeChoiceCourses : [];
  const scores = courses
    .map(course => vectorContext?.coursesBySectionId?.[String(course?.sectionId ?? course?.id ?? '').trim()]?.score)
    .filter(Number.isFinite);
  return {
    planVecScore: scores.length > 0 ? scores.reduce((sum, value) => sum + value, 0) / scores.length : null,
    vectorInterestCoverage: courses.length > 0 ? scores.length / courses.length : null,
  };
}

export function attachVectorInterestShadowStats(result, stats, name = 'vectorInterestShadowStats') {
  if (!result || !stats) return result;
  Object.defineProperty(result, name, {
    configurable: true,
    enumerable: false,
    value: {
      ...stats,
      candidates: { ...stats.candidates },
      correlation: { ...stats.correlation },
      plans: { ...stats.plans },
    },
  });
  return result;
}

export default {
  buildVectorInterestContext,
  pearsonCorrelation,
  createVectorInterestShadowStats,
  recordVectorShadowPoolRanking,
  scorePlanVectorInterest,
  attachVectorInterestShadowStats,
};
