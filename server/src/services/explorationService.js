// Roadmap #10 任務 4：系外與通識探索清單。
//
// 使用者從已修課程中挑一門喜歡的課，系統列出課程說明最相近的系外選修與通識，
// 每個系所／通識領域只出一門（Pardos & Jiang 2020 的式 (4)，見 skills/courseExploration.js）。
//
// 這條路徑**不影響自動排課**，也**不寫任何互動事件**——它只是一份清單。
//
// 兩個集合刻意分開處理：
//   - 起點（喜歡的課）：只要課程資料裡**任何學期**查得到說明就能用，本學期沒開也可以。
//   - 推薦候選：只取當學期、資格確定的班次。這是本系統自己的安全規則（roadmap #9：
//     探索不得作用於資格不確定的課程），不是論文驗證過的做法——論文的推薦不限當學期。
import { getAll } from '../db/database.js';
import { ACTIVE_TERM } from '../data/activeTerm.js';
import { getLatestAttemptsByCourseCode, getPassedCourseCodes } from '../data/courseHistory.js';
import { buildStudentScope, parseClassName } from '../skills/courseScope.js';
import { filterCategorizedCourses } from '../skills/courseQuery.js';
import {
  CATEGORY_GENERAL_EDUCATION,
  CATEGORY_OUTSIDE_ELECTIVE,
} from '../skills/courseCategory.js';
import {
  buildTfIdfIndex,
  COMMON_PHRASE_DOCUMENT_RATIO,
  rankSerendipitous,
  sharedPhrases,
} from '../skills/courseExploration.js';
import { getUserPreferences } from './memoryService.js';

export const EXPLORATION_RESULT_LIMIT = 5;
export const EXPLORATION_CACHE_TTL_MS = 10 * 60 * 1000;
export const EXPLORATION_METHOD = Object.freeze({
  representation: 'tfidf-char-bigram',
  selection: 'one-per-unit-cosine',
  k: EXPLORATION_RESULT_LIMIT,
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
// 這裡用 TTL：學期內課程說明不會變，過期資料的代價只是新匯入的課晚幾分鐘出現。
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
  // 索引涵蓋**所有學期**的課號：已修但本學期沒開的課，只要資料裡有說明就能當起點。
  const value = { courses, index: buildTfIdfIndex(courses) };
  cache = { key, expiresAt: now() + EXPLORATION_CACHE_TTL_MS, value };
  return value;
}

// 已通過的課，每個課號取最近一次修課紀錄；標出哪些有說明可以當起點。
function buildFavorites(courseHistory, index) {
  const passed = new Set(getPassedCourseCodes(courseHistory).map(normalizeCode));
  const latest = getLatestAttemptsByCourseCode(courseHistory);
  const attempts = latest instanceof Map ? [...latest.values()] : Object.values(latest ?? {});
  return attempts
    .filter(entry => passed.has(normalizeCode(entry.courseCode)))
    .map(entry => {
      const courseCode = normalizeCode(entry.courseCode);
      const vector = index.vectors.get(courseCode);
      const available = Boolean(vector && vector.norm > 0);
      return {
        courseCode,
        name: entry.courseName,
        score: Number.isFinite(Number(entry.score)) ? Number(entry.score) : null,
        graduationCategory: entry.graduationCategory ?? null,
        available,
        // 唯一的不可用原因：課程資料中任何學期都查不到這個課號的說明。
        // 「本學期沒開」不是原因——有說明就能當起點。
        ...(available ? {} : { reason: 'no-description' }),
      };
    })
    .sort((a, b) => (
      Number(b.available) - Number(a.available)
      || (b.score ?? -1) - (a.score ?? -1)
      || (a.courseCode < b.courseCode ? -1 : 1)
    ));
}

// 沒指定起點時：成績最高、有說明的本系課（必修或選修）；沒有本系課才退到任何有說明的課。
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

// 依課號把班次分組。排名以課號為單位；加入課表以班次為單位，所以班次物件原樣保留
// （它們是 filterCategorizedCourses() 的標準輸出，驗證與事件記錄會讀其中的欄位）。
function groupByCourseCode(sections) {
  const groups = new Map();
  for (const section of sections) {
    const courseCode = normalizeCode(section.catalogCourseCode);
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

function buildCandidates(courses, category, scope, passedCodes, index) {
  const sections = filterCategorizedCourses(courses, { category }, scope).filter(section => (
    // filterCategorizedCourses 已限制當學期、年級與學制。以下是探索自己的安全條件。
    !passedCodes.has(normalizeCode(section.catalogCourseCode))
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
        vector: index.vectors.get(group.courseCode) ?? null,
      };
    })
    .filter(candidate => candidate.vector && candidate.vector.norm > 0);
}

// sharedTerms 是兩份課程說明裡都出現的字面片段，讓使用者看得出「為什麼是這門」。
// 論文 §9 指出學生只能靠課程說明自行判斷關聯；這裡補上的只是字面重疊，不是語意解釋。
function presentItems(ranked, favorite, index) {
  const leftText = index.descriptions.get(favorite.courseCode) ?? '';
  return ranked.items.map(({ vector, similarity, ...item }) => ({
    ...item,
    similarity: Number(similarity.toFixed(4)),
    sharedTerms: sharedPhrases(favorite.vector, vector, {
      leftText,
      rightText: index.descriptions.get(item.courseCode) ?? '',
      isCommonPhrase: phrase => index.phraseDocumentRatio(phrase) > COMMON_PHRASE_DOCUMENT_RATIO,
      limit: 5,
    }),
  }));
}

function unitCount(candidates) {
  return new Set(candidates.map(item => item.unit).filter(unit => unit !== null)).size;
}

/**
 * @param identity `resolveIdentity()` 的結果。
 * @param input `{ favoriteCourseCode }`，可省略。
 * @param deps 測試用注入：`{ loadCourses, loadProfile, now }`。
 */
export async function exploreForUser(identity, input = {}, deps = {}) {
  const profile = deps.loadProfile ? await deps.loadProfile(identity) : await getUserPreferences(identity);
  const scope = buildStudentScope(profile);
  const { courses, index } = await loadCatalog(deps);

  const courseHistory = Array.isArray(profile.courseHistory) ? profile.courseHistory : [];
  const favorites = buildFavorites(courseHistory, index);
  const base = {
    favorites: favorites.map(({ graduationCategory, ...item }) => item),
    method: EXPLORATION_METHOD,
  };

  const requested = normalizeCode(input.favoriteCourseCode);
  let favorite;
  let source;
  if (requested) {
    favorite = favorites.find(item => item.courseCode === requested);
    if (!favorite) {
      throw explorationError('起點必須是你已修過並通過的課程。', 'FAVORITE_NOT_IN_HISTORY');
    }
    if (!favorite.available) {
      throw explorationError('課程資料中沒有這門課的說明，無法當作探索起點。', 'FAVORITE_UNAVAILABLE');
    }
    source = FAVORITE_SOURCE.USER;
  } else {
    favorite = pickDefaultFavorite(favorites);
    source = FAVORITE_SOURCE.SYSTEM_DEFAULT;
  }

  if (!favorite) {
    return {
      ...base,
      favorite: null,
      emptyReason: favorites.length === 0 ? 'no-course-history' : 'no-available-favorite',
      outside: { diversification: 'department', items: [] },
      general: { diversification: 'domain', items: [] },
      poolSize: { outsideCourses: 0, outsideUnits: 0, generalCourses: 0, generalUnits: 0 },
    };
  }

  const favoriteVector = index.vectors.get(favorite.courseCode);
  const passedCodes = new Set(getPassedCourseCodes(courseHistory).map(normalizeCode));
  const outsideCandidates = buildCandidates(courses, CATEGORY_OUTSIDE_ELECTIVE, scope, passedCodes, index);
  const generalCandidates = buildCandidates(courses, CATEGORY_GENERAL_EDUCATION, scope, passedCodes, index);

  const rank = candidates => rankSerendipitous({
    favoriteVector,
    candidates,
    unitOf: candidate => candidate.unit,
    k: EXPLORATION_RESULT_LIMIT,
  });
  const outside = rank(outsideCandidates);
  const general = rank(generalCandidates);

  return {
    ...base,
    favorite: { courseCode: favorite.courseCode, name: favorite.name, source },
    outside: { diversification: 'department', items: presentItems(outside, { courseCode: favorite.courseCode, vector: favoriteVector }, index) },
    general: {
      // 任何一門通識沒有領域（115 學年度起）時整組不分散，直接取最相似的 k 門不同課號。
      diversification: general.diversified || generalCandidates.length === 0 ? 'domain' : 'none',
      items: presentItems(general, { courseCode: favorite.courseCode, vector: favoriteVector }, index),
    },
    poolSize: {
      outsideCourses: outsideCandidates.length,
      outsideUnits: unitCount(outsideCandidates),
      generalCourses: generalCandidates.length,
      generalUnits: unitCount(generalCandidates),
    },
  };
}

export default { exploreForUser, resetExplorationCache };
