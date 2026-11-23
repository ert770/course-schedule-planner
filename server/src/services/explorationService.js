// Roadmap #10 任務 4：系外與通識探索清單。
//
// 使用者從已修課程中挑一門喜歡的課，系統列出內容最相近的系外選修與通識，
// 每個系所／通識領域只出一門（Pardos & Jiang 2020 的式 (4)，見 skills/courseExploration.js）。
//
// 這條路徑**不影響自動排課**，也**不寫任何互動事件**——它只是一份清單。
//
// 兩個集合刻意分開處理：
//   - 起點（喜歡的課）：只要課程資料裡**任何學期**有文字向量與主題標籤就能用，本學期沒開也可以。
//   - 推薦候選：只取當學期、資格確定的班次。這是本系統自己的安全規則（roadmap #9：
//     探索不得作用於資格不確定的課程），不是論文驗證過的做法——論文的推薦不限當學期。
//
// 2026-11-23 起（ADR-033）只剩一種比較方式：文字向量 ×0.7 ＋ 主題標籤 ×0.3，並且
// 至少要有一個相同的主題標籤、分數達門檻才列出；寧可少列或不列，也不拿不相干的課湊滿 5 門。
// 原本的「共同用詞」（字元 bigram TF-IDF）已停用：它沒有下限，會靠「網站」「理學」這類片段湊滿名額。
import { getAll } from '../db/database.js';
import { ACTIVE_TERM } from '../data/activeTerm.js';
import { getLatestAttemptsByCourseCode, getPassedCourseCodes } from '../data/courseHistory.js';
import { isSeriesLevelReachable, passedSeriesLevels } from '../data/courseSeries.js';
import { buildStudentScope, parseClassName } from '../skills/courseScope.js';
import { filterCategorizedCourses } from '../skills/courseQuery.js';
import {
  CATEGORY_GENERAL_EDUCATION,
  CATEGORY_OUTSIDE_ELECTIVE,
} from '../skills/courseCategory.js';
import { rankSerendipitous } from '../skills/courseExploration.js';
import { getUserPreferences } from './memoryService.js';
import { getCourseTagIndex, getTagSimilarity, loadUserTagVectorContext } from './userTagVectorService.js';
import { softCosine } from '../skills/tagVectorSpace.js';
import { scoreCoursesForUser, explainCourseForUser } from '../skills/userTagVector.js';
import { loadCourseTextEmbeddingIndex } from './courseTextEmbeddingService.js';
import { denseCosine } from '../skills/courseTextVector.js';
import {
  createExplorationTagGate,
  EXPLORATION_DENSE_WEIGHT,
  EXPLORATION_GENERIC_MIN_SIMILARITY,
  EXPLORATION_MIN_SIMILARITY,
  GENERIC_TAG_DEPARTMENT_SPREAD,
  profileExactTags,
  tagName,
} from '../skills/explorationTagGate.js';

export const EXPLORATION_RESULT_LIMIT = 5;
export const EXPLORATION_CACHE_TTL_MS = 10 * 60 * 1000;
export const EXPLORATION_REPRESENTATION = 'embedding';

// 「依你的修課與興趣」模式：標籤空間使用者向量（階段 3）＋標籤相近表（階段 2）。
export const PROFILE_EXPLORATION_METHOD = Object.freeze({
  representation: 'user-tag-vector-v1',
  selection: 'one-per-unit-svec',
  k: EXPLORATION_RESULT_LIMIT,
  // 至少一個完全相同、且不是工具軟體或上課方式的標籤（ADR-033）；只靠相近標籤配到的課不列。
  requireExactTag: true,
});

export const FAVORITE_SOURCE = Object.freeze({ USER: 'user', SYSTEM_DEFAULT: 'system-default' });
export const RECOGNITION_STATUS = Object.freeze({
  NEEDS_OFFICE_CONFIRMATION: 'needs-office-confirmation',
  UNCHECKED: 'unchecked',
  GENERAL_EDUCATION: 'general-education',
});

function explorationError(message, code, status = 400) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

function normalizeCode(value) {
  return String(value ?? '').trim().toUpperCase();
}

// `getAll('courses')` 每次都重新查詢（實測 1.4～2.7 秒）並回傳新陣列，陣列身分不能當快取鍵。
// 這裡用 TTL：學期內課程資料不會變，過期資料的代價只是新匯入的課晚幾分鐘出現。
let cache = null;

export function resetExplorationCache() {
  cache = null;
}

function termKey(term = ACTIVE_TERM) {
  return `${term?.academicYear ?? ''}:${term?.semester ?? ''}`;
}

async function loadCatalog({ loadCourses = () => getAll('courses'), now = Date.now } = {}) {
  const key = termKey();
  if (cache && cache.key === key && cache.expiresAt > now()) return cache.value;
  const courses = await loadCourses();
  const value = { courses };
  cache = { key, expiresAt: now() + EXPLORATION_CACHE_TTL_MS, value };
  return value;
}

const hasVector = vector => Boolean(vector && (vector.norm > 0 || (ArrayBuffer.isView(vector) && vector.length > 0)));

// 課程資料中這個課號的學分（任何學期取第一筆）。
function creditsByCode(courses) {
  const credits = new Map();
  for (const course of courses) {
    const code = normalizeCode(course.catalogCourseCode);
    if (code && !credits.has(code) && course.credits !== undefined && course.credits !== null) {
      credits.set(code, Number(course.credits));
    }
  }
  return credits;
}

// 起點不可用的原因（依序檢查）：
//   zero-credit-course：0 學分的課（班級活動、微積分實習課）沒有可比的主題內容。
//   no-text-embedding：課程資料中沒有這門課的文字向量。
//   no-course-tags：這門課沒有主題標籤，無法要求「至少一個相同主題」。
function favoriteUnavailableReason(courseCode, { textVectors, tagIndex, credits }) {
  if (credits.get(courseCode) === 0) return 'zero-credit-course';
  if (!hasVector(textVectors.get(courseCode))) return 'no-text-embedding';
  if (!(tagIndex.vectors.get(courseCode)?.weights?.size > 0)) return 'no-course-tags';
  return null;
}

// 已通過的課，每個課號取最近一次修課紀錄；標出哪些可以當起點。
function buildFavorites(courseHistory, context) {
  const passed = new Set(getPassedCourseCodes(courseHistory).map(normalizeCode));
  const latest = getLatestAttemptsByCourseCode(courseHistory);
  const attempts = latest instanceof Map ? [...latest.values()] : Object.values(latest ?? {});
  return attempts
    .filter(entry => passed.has(normalizeCode(entry.courseCode)))
    .map(entry => {
      const courseCode = normalizeCode(entry.courseCode);
      const reason = favoriteUnavailableReason(courseCode, context);
      return {
        courseCode,
        name: entry.courseName,
        score: Number.isFinite(Number(entry.score)) ? Number(entry.score) : null,
        graduationCategory: entry.graduationCategory ?? null,
        available: reason === null,
        // 「本學期沒開」不是原因——資料齊全就能當起點。
        ...(reason ? { reason } : {}),
      };
    })
    .sort((a, b) => (
      Number(b.available) - Number(a.available)
      || (b.score ?? -1) - (a.score ?? -1)
      || (a.courseCode < b.courseCode ? -1 : 1)
    ));
}

// 沒指定起點時：成績最高、可用的本系課（必修或選修）；沒有本系課才退到任何可用的課。
function pickDefaultFavorite(favorites) {
  const available = favorites.filter(item => item.available);
  const ownDepartment = available.filter(item => (
    item.graduationCategory === 'required' || item.graduationCategory === 'elective'
  ));
  return (ownDepartment.length > 0 ? ownDepartment : available)[0] ?? null;
}

function hasSchedule(section) {
  return Array.isArray(section.timeBlocks) ? section.timeBlocks.length > 0 : Boolean(section.dayOfWeek);
}

// 實習課的課號是講課課號加 P（例：ACCT2031 與 ACCT2031P）。兩者同時出現時併成同一張卡片，
// 以講課課號為準；只有實習課時維持原課號。
function lectureCode(courseCode, codes) {
  return courseCode.endsWith('P') && codes.has(courseCode.slice(0, -1)) ? courseCode.slice(0, -1) : courseCode;
}

// 依課號把班次分組。排名以課號為單位；加入課表以班次為單位，所以班次物件原樣保留
// （它們是 filterCategorizedCourses() 的標準輸出，驗證與事件記錄會讀其中的欄位）。
function groupByCourseCode(sections) {
  const groups = new Map();
  const codes = new Set(sections.map(section => normalizeCode(section.catalogCourseCode)));
  for (const section of sections) {
    const courseCode = lectureCode(normalizeCode(section.catalogCourseCode), codes);
    if (!courseCode) continue;
    const group = groups.get(courseCode) ?? { courseCode, sections: [] };
    group.sections.push(section);
    groups.set(courseCode, group);
  }
  return [...groups.values()];
}

function outsideRecognition(section) {
  const evaluation = section.outsideElective;
  const checked = evaluation?.checked === true;
  return {
    // 通過機械條件不等於已確認可抵畢業學分；科目表註記仍須向系辦確認。
    status: checked ? RECOGNITION_STATUS.NEEDS_OFFICE_CONFIRMATION : RECOGNITION_STATUS.UNCHECKED,
    checked,
    needsOfficeConfirmation: true,
    warnings: evaluation?.warnings ?? [],
  };
}

function generalRecognition(section) {
  return {
    status: RECOGNITION_STATUS.GENERAL_EDUCATION,
    ruleVersion: section.generalEducationRuleVersion ?? null,
    // 115 學年度起通識不分領域，這裡會是 null。
    domain: section.generalEducationDomain || null,
  };
}

// vectors：課號 → 文字向量。為 null 時不附向量，也不要求有向量（「依你的修課與興趣」用標籤）。
function buildCandidates(courses, category, scope, passedCodes, vectors, { seriesLevels = null } = {}) {
  const sections = filterCategorizedCourses(courses, { category }, scope).filter(section => (
    // filterCategorizedCourses 已限制當學期、年級與學制。以下是探索自己的安全條件。
    !passedCodes.has(normalizeCode(section.catalogCourseCode))
    // 系列課沒修過前一級不推薦（見 data/courseSeries.js）。
    && (!seriesLevels || isSeriesLevelReachable(section.name, seriesLevels))
    && section.eligibility !== 'unknown'
    && section.eligibility !== 'ineligible'
    && !(section.outsideElective?.checked === true && section.outsideElective.eligible === false)
    && hasSchedule(section)
  ));

  return groupByCourseCode(sections)
    .map(group => {
      const [first] = group.sections;
      const isGeneral = category === CATEGORY_GENERAL_EDUCATION;
      return {
        courseCode: group.courseCode,
        name: first.name,
        credits: first.credits,
        unit: isGeneral
          ? (first.generalEducationDomain || null)
          : (parseClassName(first.department).department || first.department || null),
        recognition: isGeneral ? generalRecognition(first) : outsideRecognition(first),
        sections: group.sections,
        vector: vectors ? (vectors.get(group.courseCode) ?? null) : null,
      };
    })
    .filter(candidate => !vectors || hasVector(candidate.vector));
}

function unitCount(candidates) {
  return new Set(candidates.map(item => item.unit).filter(unit => unit !== null)).size;
}

const emptyGroups = () => ({
  outside: { diversification: 'department', items: [] },
  general: { diversification: 'domain', items: [] },
  poolSize: { outsideCourses: 0, outsideUnits: 0, generalCourses: 0, generalUnits: 0 },
});

/**
 * @param identity `resolveIdentity()` 的結果。
 * @param input `{ favoriteCourseCode, representation }`，皆可省略；representation 只接受 'embedding'。
 * @param deps 測試用注入：`{ loadCourses, loadProfile, loadTextEmbeddings, now }`。
 */
export async function exploreForUser(identity, input = {}, deps = {}) {
  const representation = input.representation ?? EXPLORATION_REPRESENTATION;
  if (representation !== EXPLORATION_REPRESENTATION) {
    throw explorationError('不支援的課程內容比較方式（「共同用詞」已停用）。', 'INVALID_EXPLORATION_REPRESENTATION');
  }
  const profile = deps.loadProfile ? await deps.loadProfile(identity) : await getUserPreferences(identity);
  const scope = buildStudentScope(profile);
  const { courses } = await loadCatalog(deps);
  const textContext = await (deps.loadTextEmbeddings ?? loadCourseTextEmbeddingIndex)(courses);
  const textVectors = textContext.available ? textContext.index.vectors : new Map();
  const tagIndex = getCourseTagIndex(courses);
  const gate = createExplorationTagGate(courses, tagIndex);

  const courseHistory = Array.isArray(profile.courseHistory) ? profile.courseHistory : [];
  const favorites = buildFavorites(courseHistory, { textVectors, tagIndex, credits: creditsByCode(courses) });
  const base = {
    mode: 'favorite',
    favorites: favorites.map(({ graduationCategory, ...item }) => item),
    method: {
      ...(textContext.index?.method ?? { representation: 'course-text-embedding-v1' }),
      selection: 'one-per-unit-cosine',
      k: EXPLORATION_RESULT_LIMIT,
      denseWeight: EXPLORATION_DENSE_WEIGHT,
      tagGate: 'shared-topic-tag',
      minSimilarity: EXPLORATION_MIN_SIMILARITY,
      genericMinSimilarity: EXPLORATION_GENERIC_MIN_SIMILARITY,
      genericTagDepartmentSpread: GENERIC_TAG_DEPARTMENT_SPREAD,
    },
  };
  const empty = emptyReason => ({ ...base, favorite: null, emptyReason, ...emptyGroups() });
  if (!textContext.available) return empty(textContext.reason);

  const requested = normalizeCode(input.favoriteCourseCode);
  let favorite;
  let source;
  if (requested) {
    favorite = favorites.find(item => item.courseCode === requested);
    if (!favorite) {
      throw explorationError('起點必須是你已修過並通過的課程。', 'FAVORITE_NOT_IN_HISTORY');
    }
    if (!favorite.available) return empty(`favorite-${favorite.reason}`);
    source = FAVORITE_SOURCE.USER;
  } else {
    favorite = pickDefaultFavorite(favorites);
    source = FAVORITE_SOURCE.SYSTEM_DEFAULT;
  }
  if (!favorite) return empty(favorites.length === 0 ? 'no-course-history' : 'no-available-favorite');

  const favoriteVector = textVectors.get(favorite.courseCode);
  const favoriteTags = tagIndex.vectors.get(favorite.courseCode)?.weights;
  const passedCodes = new Set(getPassedCourseCodes(courseHistory).map(normalizeCode));
  const seriesLevels = passedSeriesLevels(courseHistory);
  const outsideCandidates = buildCandidates(courses, CATEGORY_OUTSIDE_ELECTIVE, scope, passedCodes, textVectors, { seriesLevels });
  const generalCandidates = buildCandidates(courses, CATEGORY_GENERAL_EDUCATION, scope, passedCodes, textVectors, { seriesLevels });

  // 分數＝文字向量 ×0.7 ＋ 標籤 soft cosine ×0.3。入選條件（ADR-033）：
  //   1. 至少一個相同的主題標籤——工具軟體、上課方式、太常見的標籤不算。
  //   2. 分數 ≥ 0.40；相同的主題標籤全是籠統標籤（出現在 ≥13 個系所）時 ≥ 0.45。
  // 不合格回傳 0，rankSerendipitous 會略過，不拿來湊數。
  const tagSimilarity = getTagSimilarity();
  const sharedByCode = new Map();
  const similarityOf = (left, right, candidate) => {
    const candidateTags = tagIndex.vectors.get(candidate.courseCode)?.weights;
    const shared = gate.sharedTopicTags(favoriteTags, candidateTags);
    if (shared.length === 0) return 0;
    const tagSim = softCosine(favoriteTags, candidateTags, tagSimilarity).similarity ?? 0;
    const score = EXPLORATION_DENSE_WEIGHT * denseCosine(left, right) + (1 - EXPLORATION_DENSE_WEIGHT) * tagSim;
    if (score < gate.minimumSimilarity(shared)) return 0;
    sharedByCode.set(candidate.courseCode, shared);
    return score;
  };
  const rank = candidates => rankSerendipitous({
    favoriteVector,
    candidates,
    unitOf: candidate => candidate.unit,
    k: EXPLORATION_RESULT_LIMIT,
    similarityOf,
  });
  const outside = rank(outsideCandidates);
  const general = rank(generalCandidates);
  const present = ranked => ranked.items.map(({ vector: _vector, similarity, ...item }) => ({
    ...item,
    similarity: Number(similarity.toFixed(4)),
    semanticMatch: {
      sourceCourseCode: favorite.courseCode,
      // 只列真正拿來當入選證據的主題標籤。
      commonTags: (sharedByCode.get(item.courseCode) ?? []).slice(0, 5).map(tagName),
    },
  }));

  return {
    ...base,
    favorite: { courseCode: favorite.courseCode, name: favorite.name, source },
    emptyReason: null,
    outside: { diversification: 'department', items: present(outside) },
    general: {
      // 任何一門通識沒有領域（115 學年度起）時整組不分散，直接取最相似的 k 門不同課號。
      diversification: general.diversified || generalCandidates.every(candidate => candidate.unit !== null) ? 'domain' : 'none',
      items: present(general),
    },
    poolSize: {
      outsideCourses: outsideCandidates.length,
      outsideUnits: unitCount(outsideCandidates),
      generalCourses: generalCandidates.length,
      generalUnits: unitCount(generalCandidates),
    },
  };
}

// 依 s_vec 排序，每個單位（系所／通識領域）只取一門；任一候選沒有單位時不分散（同通識 115 學年度規則）。
function rankByProfile(candidates, scored, k) {
  const ranked = candidates
    .map(candidate => ({ candidate, entry: scored.get(candidate.courseCode) }))
    .filter(({ entry }) => entry && entry.raw !== null && entry.positive > 0 && entry.raw > 0)
    .sort((a, b) => b.entry.raw - a.entry.raw || a.candidate.courseCode.localeCompare(b.candidate.courseCode));
  const diversified = candidates.length > 0 && candidates.every(candidate => candidate.unit !== null);
  const items = [];
  const usedUnits = new Set();
  for (const item of ranked) {
    if (items.length >= k) break;
    if (diversified) {
      if (usedUnits.has(item.candidate.unit)) continue;
      usedUnits.add(item.candidate.unit);
    }
    items.push(item);
  }
  return { items, diversified };
}

// 理由標籤：使用者本身就有的課程標籤一律標成完全相同（即使貢獻最大的那組配對是相近標籤），
// 且至少列出一個入選依據的完全相同標籤，避免畫面上看起來「只靠相近標籤」。
function profileReasonTags(explanation, exactNames) {
  const tags = explanation.tags.map(tag => (exactNames.includes(tag.courseTag)
    ? { userTag: tag.courseTag, courseTag: tag.courseTag, viaNeighbor: false }
    : { userTag: tag.userTag, courseTag: tag.courseTag, viaNeighbor: tag.viaNeighbor }));
  if (exactNames.length > 0 && !tags.some(tag => !tag.viaNeighbor)) {
    tags.unshift({ userTag: exactNames[0], courseTag: exactNames[0], viaNeighbor: false });
  }
  return tags;
}

function presentProfileItems(ranked, context) {
  return ranked.items.map(({ candidate, entry }) => {
    const { vector, ...item } = candidate;
    const explanation = explainCourseForUser(context.user, context.index, candidate.courseCode, {
      similarity: context.similarity,
    });
    const exactNames = profileExactTags(context.user.positive, context.index.vectors.get(candidate.courseCode)?.weights)
      .map(tagName);
    return {
      ...item,
      score: entry.score === null ? null : Number(entry.score.toFixed(4)),
      reasons: {
        tags: profileReasonTags(explanation, exactNames),
        closestEvidence: explanation.closestEvidence
          ? {
            courseCode: explanation.closestEvidence.courseCode,
            name: explanation.closestEvidence.name || null,
            source: explanation.closestEvidence.source,
          }
          : null,
      },
    };
  });
}

/**
 * 「依你的修課與興趣」探索（階段 4）。以標籤空間使用者向量排序系外選修與通識。
 * 需要 personalization_learning 同意；未同意或沒有任何訊號時回傳空清單與原因，前端改用「從一門課出發」。
 * 唯讀：不寫互動事件，也不影響自動排課。
 *
 * @param deps 測試用注入：`{ loadCourses, loadProfile, loadEvents, now }`。
 */
export async function exploreByProfile(identity, deps = {}) {
  const profile = deps.loadProfile ? await deps.loadProfile(identity) : await getUserPreferences(identity);
  const scope = buildStudentScope(profile);
  const { courses } = await loadCatalog(deps);
  const courseHistory = Array.isArray(profile.courseHistory) ? profile.courseHistory : [];
  const passedCodes = new Set(getPassedCourseCodes(courseHistory).map(normalizeCode));
  const context = await loadUserTagVectorContext(identity, profile, courses, deps);
  const base = {
    mode: 'profile',
    method: PROFILE_EXPLORATION_METHOD,
    signals: context.user
      ? {
        historyCourses: context.user.sources.historyCourses,
        positiveEvents: context.user.sources.positiveEvents,
        negativeEvents: context.user.sources.negativeEvents,
        explicitTags: context.user.sources.explicitTags,
      }
      : null,
  };
  const empty = emptyReason => ({ ...base, emptyReason, ...emptyGroups() });
  if (!context.consented) return empty('no-personalization-consent');
  if (!(context.user.positive.size > 0)) return empty('no-profile-signal');

  const options = { seriesLevels: passedSeriesLevels(courseHistory) };
  // 使用者明確拒絕過的課不再推薦（見 userTagVector 的 rejectedCourseCodes）。
  const rejected = context.user.rejectedCourseCodes ?? new Set();
  // 只靠相近標籤配到的課不列：至少要有一個和使用者完全相同、且不是工具軟體或上課方式的標籤（ADR-033）。
  const eligible = candidate => !rejected.has(normalizeCode(candidate.courseCode))
    && profileExactTags(context.user.positive, context.index.vectors.get(candidate.courseCode)?.weights).length > 0;
  const outsideCandidates = buildCandidates(courses, CATEGORY_OUTSIDE_ELECTIVE, scope, passedCodes, null, options)
    .filter(eligible);
  const generalCandidates = buildCandidates(courses, CATEGORY_GENERAL_EDUCATION, scope, passedCodes, null, options)
    .filter(eligible);
  const scored = scoreCoursesForUser(
    context.user, context.index,
    [...outsideCandidates, ...generalCandidates].map(candidate => candidate.courseCode),
    { similarity: context.similarity },
  );
  const outside = rankByProfile(outsideCandidates, scored, EXPLORATION_RESULT_LIMIT);
  const general = rankByProfile(generalCandidates, scored, EXPLORATION_RESULT_LIMIT);
  return {
    ...base,
    emptyReason: null,
    outside: { diversification: 'department', items: presentProfileItems(outside, context) },
    general: {
      diversification: general.diversified || generalCandidates.every(candidate => candidate.unit !== null) ? 'domain' : 'none',
      items: presentProfileItems(general, context),
    },
    poolSize: {
      outsideCourses: outsideCandidates.length,
      outsideUnits: unitCount(outsideCandidates),
      generalCourses: generalCandidates.length,
      generalUnits: unitCount(generalCandidates),
    },
  };
}

export default { exploreForUser, exploreByProfile, resetExplorationCache };
