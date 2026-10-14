// 協同過濾與 User Embedding 構想階段 1（A）：標籤空間的課程向量。
// 構想見 docs/CHANGE_REPORTS/2026-10-14-cf-user-embedding-design.md 3.2.1。
//
// 每門課（以課號為單位）是一個稀疏向量：維度是標準標籤，值是 idf = ln(課程數 / 有該標籤的課程數)。
// 兩門課的相似度是餘弦相似度，可以拆成每個共用標籤的貢獻，推薦理由因此說得出「共用了哪些標籤」。
//
// **向量用的標籤資格與標籤興趣檔案（rag-tag-interest-v1）分開**，不改動 s_tag 的行為：
//   - 納入可跨課比對的標籤；
//   - 納入 `too_common` 的標籤（機器學習、人工智慧、Python 等），由 idf 自動給低權重；
//   - 排除 `single_course`：只出現在一門課，不可能讓兩門課相近，只會稀釋該課的向量長度；
//   - 排除 `explicit_generic`（團隊合作、實習、專業技能等），它們不描述課程主題。
//
// 純函式，不碰資料庫，也還沒接進排課或探索。

import { resolveInterestTags } from '../data/interestTagCatalog.js';

export const TAG_VECTOR_MODEL_VERSION = 'tag-vector-v1';

// single_course 與 explicit_generic 的 crossCourseMatchEligible 都是 false、原因也不是 too_common，
// 所以由下面兩條規則自然排除。
export function isVectorEligibleTag(tag) {
  const eligibility = tag?.eligibility;
  if (!eligibility) return false;
  if (eligibility.crossCourseMatchEligible === true) return true;
  return eligibility.exclusionReason === 'too_common';
}

function normalizeCode(value) {
  return String(value ?? '').trim().toUpperCase();
}

/** 課程原始 rag_tag → 向量可用的標準標籤（去重）。 */
export function vectorTagsOf(rawTags) {
  const tags = new Map();
  for (const tag of resolveInterestTags(rawTags).tags) {
    if (isVectorEligibleTag(tag)) {
      tags.set(tag.canonicalTagId, tag.canonicalName);
    }
  }
  return tags;
}

/**
 * 建立課程向量索引。同一課號的多個班次取標籤聯集。
 * idf 由這批課程本身計算，所以索引只對建立它的那批課程（例如當學期）有意義。
 */
export function buildCourseTagVectors(courses = []) {
  const tagsByCode = new Map();
  const names = new Map();
  const tagNames = new Map();
  for (const course of Array.isArray(courses) ? courses : []) {
    const code = normalizeCode(course?.catalogCourseCode);
    if (!code) continue;
    const tags = tagsByCode.get(code) ?? new Set();
    for (const [id, name] of vectorTagsOf(course?.ragTag)) {
      tags.add(id);
      tagNames.set(id, name);
    }
    tagsByCode.set(code, tags);
    if (!names.has(code)) names.set(code, String(course?.name ?? ''));
  }

  const courseCount = tagsByCode.size;
  const documentFrequency = new Map();
  for (const tags of tagsByCode.values()) {
    for (const id of tags) documentFrequency.set(id, (documentFrequency.get(id) ?? 0) + 1);
  }
  const idf = new Map();
  for (const [id, df] of documentFrequency) idf.set(id, Math.log(courseCount / df));

  const vectors = new Map();
  for (const [code, tags] of tagsByCode) {
    const weights = new Map();
    for (const id of tags) {
      const value = idf.get(id);
      if (value > 0) weights.set(id, value);
    }
    const norm = Math.sqrt([...weights.values()].reduce((sum, value) => sum + value * value, 0));
    vectors.set(code, { weights, norm });
  }

  return {
    modelVersion: TAG_VECTOR_MODEL_VERSION,
    courseCount,
    idf,
    documentFrequency,
    tagNames,
    courseNames: names,
    vectors,
  };
}

/**
 * 兩個稀疏向量的餘弦相似度，並列出每個共用標籤的貢獻（加總等於 similarity）。
 * 任一向量為零向量時回傳 similarity = null，代表「無法比較」而不是「不相似」。
 */
export function cosineWithContributions(left, right) {
  if (!left || !right || !(left.norm > 0) || !(right.norm > 0)) {
    return { similarity: null, contributions: [] };
  }
  const [small, large] = left.weights.size <= right.weights.size ? [left, right] : [right, left];
  const denominator = left.norm * right.norm;
  const contributions = [];
  for (const [id, value] of small.weights) {
    const other = large.weights.get(id);
    if (other === undefined) continue;
    contributions.push({ canonicalTagId: id, contribution: (value * other) / denominator });
  }
  contributions.sort((a, b) => b.contribution - a.contribution || a.canonicalTagId.localeCompare(b.canonicalTagId));
  const similarity = contributions.reduce((sum, item) => sum + item.contribution, 0);
  return { similarity, contributions };
}

/** 找出與某課號最相近的 k 門課（不含自己；相似度為 0 的不列）。 */
export function nearestCourses(index, courseCode, { k = 5, filter = null } = {}) {
  const code = normalizeCode(courseCode);
  const source = index?.vectors?.get(code);
  if (!source || !(source.norm > 0)) return [];
  const results = [];
  for (const [otherCode, vector] of index.vectors) {
    if (otherCode === code) continue;
    if (filter && !filter(otherCode)) continue;
    const { similarity, contributions } = cosineWithContributions(source, vector);
    if (!(similarity > 0)) continue;
    results.push({
      courseCode: otherCode,
      similarity,
      sharedTags: contributions.map(item => ({
        canonicalTagId: item.canonicalTagId,
        canonicalName: index.tagNames.get(item.canonicalTagId) ?? item.canonicalTagId,
        contribution: item.contribution,
      })),
    });
  }
  results.sort((a, b) => b.similarity - a.similarity || a.courseCode.localeCompare(b.courseCode));
  return results.slice(0, Math.max(0, k));
}

export default {
  TAG_VECTOR_MODEL_VERSION,
  isVectorEligibleTag,
  vectorTagsOf,
  buildCourseTagVectors,
  cosineWithContributions,
  nearestCourses,
};
