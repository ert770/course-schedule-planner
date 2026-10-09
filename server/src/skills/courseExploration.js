// Roadmap #10 任務 4：系外與通識探索的文字相似度與挑選。
//
// 依據 Pardos & Jiang, "Designing for Serendipity in a University Course Recommendation
// System" (LAK '20)。這裡實作的是論文的兩個部分：
//   - §3.3 的 bag-of-words 表示法（tf-idf）；
//   - §3.4 式 (4) 的挑選：對使用者喜歡的課 cᵢ，每個 department 只取 cosine 最大的一門，
//     再把這些課依 cosine 排序。
//
// 與論文的差異（完整說明在 docs/SCHEDULING_LOGIC.md）：
//   - 沒有 course2vec：那需要大量修課序列，本系統沒有。
//   - 論文對英文做 lemmatization／stemming。中文沒有對應物，這裡用字元 bigram，
//     會產生跨詞邊界的雜訊 term，是近似。
//   - 論文用人工停用詞表；這裡以「出現在太多課程說明裡的 term 不計」取代。
//
// 純函式：不碰 I/O，不知道學期、資格或使用者。
const CJK_RUN = /[一-鿿]+/gu;
const ASCII_TERM = /[a-z][a-z0-9+#]*/gu;

// 課程說明是由同一個模板產生的，開頭固定是「課程：<課名>。」。
// 對應論文 §4.1 的「removing generic, often-seen sentences」。
const BOILERPLATE_PREFIX = /^\s*課程[:：][^。]*。/u;

// 出現在超過這個比例的課程說明裡的 term 視為停用詞（「本課」「學生」這一類）。
export const STOP_TERM_DOCUMENT_RATIO = 0.2;
// 顯示「共同字詞」時，出現在超過這個比例課程裡的片語視為通用句型，不列出。
export const COMMON_PHRASE_DOCUMENT_RATIO = 0.12;

// 中文虛詞。含有這些字的 bigram 幾乎都是跨詞邊界的碎片（「及企」「的能」「並掌」），
// 對應論文 §4.1 的停用詞移除。只列語法功能字，不列有實義的字。
const STOP_CHARACTERS = new Set(
  '的了及與和或並且而但也都就才又再還很更最將會能可要應須被把讓使對於在為是有無不沒之其此這那各每本該等如何以由從到向至於中上下內外前後時所者們個種項些也則即若雖因故乃'
);

function isContentBigram(bigram) {
  return !STOP_CHARACTERS.has(bigram[0]) && !STOP_CHARACTERS.has(bigram[1]);
}

export function tokenizeDescription(text) {
  const cleaned = String(text ?? '').replace(BOILERPLATE_PREFIX, '').toLowerCase();
  const terms = [];
  for (const match of cleaned.matchAll(ASCII_TERM)) terms.push(match[0]);
  for (const match of cleaned.matchAll(CJK_RUN)) {
    const run = match[0];
    for (let index = 0; index + 1 < run.length; index += 1) {
      const bigram = run.slice(index, index + 2);
      if (isContentBigram(bigram)) terms.push(bigram);
    }
  }
  return terms;
}

function normalizeCode(value) {
  return String(value ?? '').trim().toUpperCase();
}

/**
 * 以**不重複課號**為文件建立 tf-idf 索引。同課號多個班次只算一份文件
 * （取說明最長的那一份），開班多的課不會因此佔更多權重。
 *
 * @param courses `[{ catalogCourseCode, description }]`
 * @returns `{ vectors: Map<courseCode, { weights: Map<term, number>, norm }>, documentCount,
 *            descriptions: Map<courseCode, string> }`
 */
export function buildTfIdfIndex(courses = []) {
  const descriptions = new Map();
  for (const course of courses) {
    const code = normalizeCode(course?.catalogCourseCode);
    const description = String(course?.description ?? '').trim();
    if (!code || !description) continue;
    const existing = descriptions.get(code);
    if (existing === undefined || description.length > existing.length) descriptions.set(code, description);
  }

  const termFrequencies = new Map();
  const documentFrequency = new Map();
  for (const [code, description] of descriptions) {
    const frequency = new Map();
    for (const term of tokenizeDescription(description)) frequency.set(term, (frequency.get(term) || 0) + 1);
    termFrequencies.set(code, frequency);
    for (const term of frequency.keys()) documentFrequency.set(term, (documentFrequency.get(term) || 0) + 1);
  }

  const documentCount = descriptions.size;
  const vectors = new Map();
  for (const [code, frequency] of termFrequencies) {
    const weights = new Map();
    let squared = 0;
    for (const [term, count] of frequency) {
      const df = documentFrequency.get(term);
      if (df / documentCount > STOP_TERM_DOCUMENT_RATIO) continue;
      // tf × idf（論文 §3.3 的第三種權重）。只出現在單一文件的 term idf 最大。
      const weight = count * Math.log(documentCount / df);
      if (weight <= 0) continue;
      weights.set(term, weight);
      squared += weight * weight;
    }
    vectors.set(code, { weights, norm: Math.sqrt(squared) });
  }
  // 一個片語出現在多少比例的課程說明裡（子字串比對）。只用於顯示，結果快取。
  const lowered = [...descriptions.values()].map(text => text.toLowerCase());
  const ratioCache = new Map();
  const phraseDocumentRatio = phrase => {
    if (!ratioCache.has(phrase)) {
      ratioCache.set(phrase, lowered.filter(text => text.includes(phrase)).length / documentCount);
    }
    return ratioCache.get(phrase);
  };
  return { vectors, documentCount, descriptions, phraseDocumentRatio };
}

export function cosineSimilarity(left, right) {
  if (!left || !right || !left.norm || !right.norm) return 0;
  const [small, large] = left.weights.size <= right.weights.size
    ? [left.weights, right.weights]
    : [right.weights, left.weights];
  let dot = 0;
  for (const [term, weight] of small) {
    const other = large.get(term);
    if (other) dot += weight * other;
  }
  return dot / (left.norm * right.norm);
}

// 兩門課共同出現、對相似度貢獻最大的 term。這是**字面重疊**，不是語意解釋。
export function sharedTerms(left, right, limit = 5) {
  if (!left || !right) return [];
  const shared = [];
  for (const [term, weight] of left.weights) {
    const other = right.weights.get(term);
    if (other) shared.push({ term, contribution: weight * other });
  }
  return shared
    .sort((a, b) => b.contribution - a.contribution || (a.term < b.term ? -1 : a.term > b.term ? 1 : 0))
    .slice(0, limit)
    .map(item => item.term);
}

// 把共同的 bigram 還原成兩份說明裡**都真的出現過**的較長字串，給人看的。
// 「人工」「工智」「智慧」→「人工智慧」；「式設」→「程式設計」。
//
// 做法：從貢獻最大的共同 bigram 出發，在原文裡一次往左右延伸一個字。每一步都要求
// 兩份原文同時包含延伸後的字串，所以結果一定是兩邊共有的字面片段，不會拼出原文沒有的詞。
// 仍然只是字面重疊，不是語意解釋。這只影響顯示，不影響相似度。
export function sharedPhrases(left, right, {
  leftText = '', rightText = '', limit = 5, isCommonPhrase = () => false,
} = {}) {
  if (!left || !right) return [];
  const contribution = new Map();
  for (const [term, weight] of left.weights) {
    const other = right.weights.get(term);
    if (other) contribution.set(term, weight * other);
  }
  const seeds = [...contribution.entries()]
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([term]) => term);

  const a = String(leftText).toLowerCase();
  const b = String(rightText).toLowerCase();
  const inBoth = phrase => a.includes(phrase) && b.includes(phrase);
  const isContentChar = char => /^[一-鿿]$/u.test(char ?? '') && !STOP_CHARACTERS.has(char);

  // 延伸時跨過的那個 bigram 要嘛是到處都有而被當成停用詞的常見詞（「程式」「設計」，
  // 不在向量裡），要嘛本身貢獻夠大。貢獻很小的共同 bigram 多半是跨詞碎片
  // （「了解人工智慧」裡的「解人」），不讓它把片語往外拉。
  const bridges = (bigram, seedContribution) => {
    const value = contribution.get(bigram);
    if (value === undefined) return !left.weights.has(bigram) && !right.weights.has(bigram);
    return value >= seedContribution * 0.25;
  };

  const phrases = [];
  for (const seed of seeds) {
    if (phrases.length >= limit) break;
    if (phrases.some(phrase => phrase.includes(seed))) continue;
    let phrase = seed;
    if (/^[一-鿿]{2}$/u.test(seed)) {
      const seedContribution = contribution.get(seed);
      let extended = true;
      while (extended && phrase.length < 8) {
        extended = false;
        const position = a.indexOf(phrase);
        if (position < 0) break;
        const next = a[position + phrase.length];
        if (isContentChar(next) && inBoth(phrase + next) && bridges(phrase.at(-1) + next, seedContribution)) {
          phrase += next;
          extended = true;
          continue;
        }
        const previous = a[position - 1];
        if (isContentChar(previous) && inBoth(previous + phrase) && bridges(previous + phrase[0], seedContribution)) {
          phrase = previous + phrase;
          extended = true;
        }
      }
    }
    // 「學生掌握」「課程適合」這種到處都有的句型不說明任何關聯。
    if (isCommonPhrase(phrase)) continue;
    if (phrases.some(existing => existing.includes(phrase))) continue;
    for (let index = phrases.length - 1; index >= 0; index -= 1) {
      if (phrase.includes(phrases[index])) phrases.splice(index, 1);
    }
    phrases.push(phrase);
  }
  return phrases;
}

/**
 * 論文式 (4)：c*ⱼ = argmax_{c, d(c)=dⱼ} cos(c, cᵢ)，再依 cos(c*ⱼ, cᵢ) 排序取前 k。
 *
 * @param favoriteVector 喜歡的課的向量。
 * @param candidates `[{ courseCode, vector, ... }]`，一個課號一筆。
 * @param unitOf 回傳這門課所屬的 unit（系所或通識領域）。回傳 `null` 代表這門課
 *               不屬於任何 unit——**只要有一門回 null，整組就不做單位分散**，直接取
 *               cosine 最高的 k 門（115 學年度起通識不分領域）。
 * @returns `{ diversified, items: [{ ...candidate, unit, similarity }] }`
 */
export function rankSerendipitous({ favoriteVector, candidates = [], unitOf = () => null, k = 5 }) {
  const scored = [];
  for (const candidate of candidates) {
    const similarity = cosineSimilarity(favoriteVector, candidate.vector);
    // 沒有任何共同 term 的課不算「相關」，不拿來湊數。
    if (similarity <= 0) continue;
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
    // scored 已排好序，每個 unit 第一個遇到的就是 cosine 最大者。
    if (!bestPerUnit.has(item.unit)) bestPerUnit.set(item.unit, item);
  }
  return { diversified: true, items: [...bestPerUnit.values()].sort(byRank).slice(0, k) };
}

export default {
  tokenizeDescription,
  buildTfIdfIndex,
  cosineSimilarity,
  sharedTerms,
  sharedPhrases,
  rankSerendipitous,
};
