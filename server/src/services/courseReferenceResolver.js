// Roadmap #41（第二段）：把回覆句子裡的課程指涉解析到 section 實體，而不是只
// 解析到課名。
//
// 今天的比對只到 `course.name`：兩個同名不同班次的課程（例如兩門「演算法」，
// 分別是王小明老師週一 3-4 節、李大華老師週二 5-6 節），正確描述其中一個班次
// 的句子，會被另一個班次的事實判成教師或時間不一致——驗證粒度停在課名，
// 但證據來源已經是 section 級。
//
// 這裡把「同一個課名底下的所有 section」收成一個 reference（候選陣列），讓
// 後面的事實審查對整個候選集合做「有沒有任何一個真實 section 支持這整句話」
// 的一致性檢查，而不是逐一對每個同名 section 各自獨立審查、各自報一次矛盾。
import { extractTimeClaims, matchAssertedTeacher } from './sentenceFacts.js';

// 句子只用代名詞指涉前一句提到的課（「這門課」「該課」…）時，沿用前一句
// 解析出的唯一候選——沒有這層，代名詞句會被判成「提到工具結果中不存在的
// 課程」，而這個錯誤代號會原樣送進修正模型，叫它刪掉一門根本不存在的課，
// 而不是去修教師名。
const PRONOUN_CARRY_OVER = /這門課|該課|此課|它/u;

// 課名右邊界：帳本裡只有「演算法」時，捏造的「演算法導論」不能被判成同一門課
// ——只靠「長名優先＋遮蔽」不夠，因為帳本裡根本沒有「演算法導論」這個長名可
// 以優先比對，「演算法」仍然會命中「演算法導論」的前四個字。這裡在命中後檢查
// 緊接著的字元，接的是課名常見後綴就不算命中。
const NAME_SUFFIX_BOUNDARY = /^(?:導論|概論|實習|實驗|專題|（一）|（二）|\(一\)|\(二\))/u;

function mentionCandidatesFor(course) {
  const list = [];
  if (course.name) list.push(course.name);
  if (course.catalogCourseCode) list.push(course.catalogCourseCode);
  return list;
}

// 在句子裡找出所有課程指涉的出現位置：長名優先，且已經被較長名字佔用的區間
// 不再被較短名字重複比對（避免「演算法」吃掉「演算法導論」裡的子字串）。
//
// **同名不同班次的處理關鍵**：先把「同一段文字、同一個位置」的命中合併成一筆
// （記錄命中了哪些課程），再做長名優先的遮蔽判斷。順序不能反過來——如果每個
// 課程各自產生一筆命中再逐筆判斷重疊，兩個同名班次在同一位置的命中會被判成
// 互相重疊，第二個班次就被當成雜訊濾掉，等於同名的第二個 section 永遠進不了
// 候選名單。
function findMentionSpans(sentence, courses) {
  const bySpan = new Map();
  for (const course of courses) {
    for (const text of mentionCandidatesFor(course)) {
      let fromIndex = 0;
      for (;;) {
        const index = sentence.indexOf(text, fromIndex);
        if (index < 0) break;
        fromIndex = index + 1;
        const key = `${index}:${index + text.length}`;
        if (!bySpan.has(key)) {
          bySpan.set(key, { text, start: index, end: index + text.length, courses: [] });
        }
        const entry = bySpan.get(key);
        if (!entry.courses.includes(course)) entry.courses.push(course);
      }
    }
  }
  const spans = [...bySpan.values()].sort((a, b) => b.text.length - a.text.length || a.start - b.start);

  const claimed = [];
  const accepted = [];
  for (const span of spans) {
    const overlapped = claimed.some(range => span.start < range.end && span.end > range.start);
    if (overlapped) continue;
    if (NAME_SUFFIX_BOUNDARY.test(sentence.slice(span.end))) continue;
    claimed.push({ start: span.start, end: span.end });
    accepted.push(span);
  }
  return accepted.sort((a, b) => a.start - b.start);
}

// 同一個指涉字串（同名或同課號）命中的所有課程，收成一個 reference。一個
// span 本身可能已經帶著多個課程（同名不同班次於同一位置命中），這裡再依
// 文字內容把「同一句話裡出現多次的同一個名字」也收在一起。
function groupMentionsByText(spans) {
  const groups = new Map();
  for (const span of spans) {
    if (!groups.has(span.text)) {
      groups.set(span.text, { mentionText: span.text, start: span.start, candidates: [] });
    }
    const group = groups.get(span.text);
    for (const course of span.courses) {
      if (!group.candidates.includes(course)) group.candidates.push(course);
    }
  }
  return [...groups.values()].sort((a, b) => a.start - b.start);
}

function extractExplicitSectionId(sentence) {
  const match = sentence.match(/(?:section\s*id|sectionid|班次|section)\s*[:：]?\s*(\d+)/iu);
  return match ? match[1] : null;
}

// 依序嘗試三種收斂訊號：句中明寫的 sectionId、句中提到的教師名、句中提到的
// 上課時間。任一訊號能把候選收斂成唯一一個就採用；收斂不了（0 個或 2 個以上
// 符合）就換下一個訊號，全部試過仍收斂不了就維持原候選陣列，交給後面的逐
// candidate 事實一致性檢查去判斷。
function narrowCandidates(sentence, candidates) {
  if (candidates.length <= 1) return { candidates, narrowedBy: null };

  const explicitSectionId = extractExplicitSectionId(sentence);
  if (explicitSectionId) {
    const bySection = candidates.filter(c => c.sectionId === explicitSectionId);
    if (bySection.length === 1) return { candidates: bySection, narrowedBy: 'sectionId' };
  }

  const assertedTeacher = matchAssertedTeacher(sentence);
  if (assertedTeacher) {
    const byTeacher = candidates.filter(c => c.teacher === assertedTeacher);
    if (byTeacher.length === 1) return { candidates: byTeacher, narrowedBy: 'teacher' };
  }

  const assertedTimes = extractTimeClaims(sentence);
  if (assertedTimes.length > 0) {
    const byTime = candidates.filter(c => {
      const evidenceTimes = extractTimeClaims(c.timeStr);
      return assertedTimes.some(value => evidenceTimes.includes(value));
    });
    if (byTime.length === 1) return { candidates: byTime, narrowedBy: 'time' };
  }

  return { candidates, narrowedBy: null };
}

// @param carryOver 前一句解析出的唯一 reference（供代名詞句沿用），沒有就傳 null。
// @returns { references, carryOver } —— `carryOver` 是這句話結束後應該往下一句
//   帶的狀態：這句話若清楚解析到唯一一個候選就更新它，否則維持原樣（不會因為
//   這句話含糊或沒提到課就把前面建立的指涉清掉）。
export function resolveCourseReferences(sentence, courses, { carryOver = null } = {}) {
  const mentions = findMentionSpans(sentence, courses);
  const groups = groupMentionsByText(mentions);

  const references = groups.map(group => {
    const { candidates, narrowedBy } = narrowCandidates(sentence, group.candidates);
    return { mentionText: group.mentionText, candidates, narrowedBy };
  });

  if (references.length === 0 && PRONOUN_CARRY_OVER.test(sentence) && carryOver) {
    references.push({
      mentionText: carryOver.mentionText,
      candidates: carryOver.candidates,
      narrowedBy: 'carryOver',
    });
  }

  const singleClear = references.length === 1 && references[0].candidates.length === 1
    ? references[0]
    : null;

  return { references, carryOver: singleClear ?? carryOver };
}

export default { resolveCourseReferences };
