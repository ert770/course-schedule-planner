// Roadmap #10 任務 4：系外與通識探索的挑選規則。
//
// 依據 Pardos & Jiang, "Designing for Serendipity in a University Course Recommendation
// System" (LAK '20) §3.4 式 (4)：對使用者喜歡的課 cᵢ，每個 department 只取相似度最大的一門，
// 再把這些課依相似度排序。
//
// 相似度由呼叫端提供（explorationService：文字向量 ×0.7 ＋ 主題標籤 ×0.3，含主題門檻，見 ADR-033）。
// 原本論文 §3.3 的 bag-of-words（字元 bigram tf-idf，畫面上的「共同用詞」）已於 2026-11-23 停用並移除。
//
// 純函式：不碰 I/O，不知道學期、資格或使用者。

/**
 * 論文式 (4)：c*ⱼ = argmax_{c, d(c)=dⱼ} sim(c, cᵢ)，再依 sim(c*ⱼ, cᵢ) 排序取前 k。
 *
 * @param favoriteVector 喜歡的課的向量，原樣交給 similarityOf。
 * @param candidates `[{ courseCode, vector, ... }]`，一個課號一筆。
 * @param unitOf 回傳這門課所屬的 unit（系所或通識領域）。回傳 `null` 代表這門課
 *               不屬於任何 unit——**只要有一門回 null，整組就不做單位分散**，直接取
 *               相似度最高的 k 門（115 學年度起通識不分領域）。
 * @param similarityOf `(favoriteVector, candidate.vector, candidate) => number`，必填。
 *               回傳 ≤ 0 表示不相關或未達門檻，不列入。
 * @returns `{ diversified, items: [{ ...candidate, unit, similarity }] }`
 */
export function rankSerendipitous({ favoriteVector, candidates = [], unitOf = () => null, k = 5, similarityOf }) {
  if (typeof similarityOf !== 'function') throw new TypeError('rankSerendipitous 需要 similarityOf');
  const scored = [];
  for (const candidate of candidates) {
    const similarity = similarityOf(favoriteVector, candidate.vector, candidate);
    // 不相關或未達門檻的課不拿來湊數。
    if (!(similarity > 0)) continue;
    scored.push({ ...candidate, unit: unitOf(candidate) ?? null, similarity });
  }
  // 平手依課號，結果才不會取決於輸入順序。
  const byRank = (a, b) => (
    b.similarity - a.similarity
    || (a.courseCode < b.courseCode ? -1 : a.courseCode > b.courseCode ? 1 : 0)
  );
  scored.sort(byRank);

  const diversified = scored.length > 0 && scored.every(item => item.unit !== null);
  if (!diversified) return { diversified: false, items: scored.slice(0, k) };

  const bestPerUnit = new Map();
  for (const item of scored) {
    // scored 已排好序，每個 unit 第一個遇到的就是相似度最大者。
    if (!bestPerUnit.has(item.unit)) bestPerUnit.set(item.unit, item);
  }
  return { diversified: true, items: [...bestPerUnit.values()].sort(byRank).slice(0, k) };
}

export default { rankSerendipitous };
