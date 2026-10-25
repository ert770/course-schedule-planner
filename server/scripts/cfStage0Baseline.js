// 協同過濾與 User Embedding 構想（docs/CHANGE_REPORTS/2026-10-14-cf-user-embedding-design.md）
// 階段 0：量現況，決定後續階段值不值得做。
//
// **只讀。** 對資料庫只做 SELECT；不重算、不寫入 Learned_Tag_Interests，標籤興趣檔只在記憶體
// 依「同意狀態＋未到期互動事件＋明確偏好」算一次（與 recomputeTagInterestProfile 相同的輸入）。
// 輸出寫到 `server/simulation-runs/<out>/`（不進版控）。
//
// 量四件事：
//   1. 當學期課程數（班次、課號）。
//   2. 課程簡介（rag_context）與 rag_tag 的填寫率。
//   3. 每位帳號的非必修候選課中，拿不到標籤興趣分數的比例，以及原因。
//   4. 每位帳號的歷史修課中，非必修且有可跨課比對標籤的課有多少；這些課的標籤能讓多少候選課對上。
//
// 用法：node scripts/cfStage0Baseline.js --out=cf-stage0 [--accounts=D0009001,D1249697]

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(scriptDir, '..', '.env'), quiet: true });
dotenv.config({ path: path.resolve(scriptDir, '..', '..', '.env'), quiet: true });

const { ACTIVE_TERM, normalizeSemesterLabel } = await import('../src/data/activeTerm.js');
const { getAll } = await import('../src/db/database.js');
const { closePool, isMysqlConfigured } = await import('../src/db/mysql.js');
const { getUserPreferences } = await import('../src/services/memoryService.js');
const { hasPersonalizationConsent, getInteractionEventsForExport } = await import('../src/services/interactionEventService.js');
const { PRIVACY_RETENTION } = await import('../src/data/privacyPolicy.js');
const { resolveInterestTags } = await import('../src/data/interestTagCatalog.js');
const { getLatestAttemptsByCourseCode } = await import('../src/data/courseHistory.js');
const { buildStudentScope } = await import('../src/skills/courseScope.js');
const { filterCategorizedCourses } = await import('../src/skills/courseQuery.js');
const { CATEGORY_REQUIRED } = await import('../src/skills/courseCategory.js');
const { computeTagInterestProfile, scoreCourseTagInterest } = await import('../src/skills/tagInterestLearning.js');

const args = process.argv.slice(2);
const argValue = name => args.find(arg => arg.startsWith(`--${name}=`))?.split('=')[1];
const outName = argValue('out');
if (!outName) { console.error('請指定 --out=<名稱>'); process.exit(1); }
const outDir = path.resolve(scriptDir, '..', 'simulation-runs', outName);

const DEFAULT_ACCOUNTS = [
  ...Array.from({ length: 10 }, (_, index) => ({ studentId: `D000${9001 + index}`, numericId: String(9001 + index), persona: true })),
  { studentId: 'D1249697', numericId: '1', persona: false },
];
const accountFilter = argValue('accounts')?.split(',');
const accounts = DEFAULT_ACCOUNTS.filter(item => !accountFilter || accountFilter.includes(item.studentId));
const NON_REQUIRED_HISTORY = new Set(['elective', 'general', 'external']);

const code = value => String(value ?? '').trim().toUpperCase();
const pct = (part, whole) => (whole > 0 ? Number((part / whole * 100).toFixed(1)) : null);
const crossTags = rawTags => resolveInterestTags(rawTags).tags
  .filter(tag => tag.eligibility?.crossCourseMatchEligible === true);
const isActiveTerm = course => Number(course.year) === Number(ACTIVE_TERM.academicYear)
  && normalizeSemesterLabel(course.semester) === normalizeSemesterLabel(ACTIVE_TERM.semester);

function quantiles(values) {
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const at = q => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
  return { min: sorted[0], p25: at(0.25), median: at(0.5), p75: at(0.75), max: sorted[sorted.length - 1] };
}

// 課號 → 該課號在任何學期出現過的可跨課比對標籤（歷史課本學期可能沒開）。
function buildCodeTagIndex(courses) {
  const index = new Map();
  for (const course of courses) {
    const key = code(course.catalogCourseCode);
    if (!key) continue;
    const ids = index.get(key) ?? new Set();
    for (const tag of crossTags(course.ragTag)) ids.add(tag.canonicalTagId);
    index.set(key, ids);
  }
  return index;
}

function catalogStats(courses) {
  const active = courses.filter(isActiveTerm);
  const byCode = new Map();
  for (const course of active) {
    const key = code(course.catalogCourseCode);
    if (!key) continue;
    const entry = byCode.get(key) ?? { descriptionLength: 0, rawTagCount: 0, crossTagCount: 0 };
    entry.descriptionLength = Math.max(entry.descriptionLength, String(course.description ?? '').trim().length);
    entry.rawTagCount = Math.max(entry.rawTagCount, Array.isArray(course.ragTag) ? course.ragTag.length : 0);
    entry.crossTagCount = Math.max(entry.crossTagCount, crossTags(course.ragTag).length);
    byCode.set(key, entry);
  }
  const entries = [...byCode.values()];
  const withDescription = entries.filter(item => item.descriptionLength > 0);
  return {
    term: ACTIVE_TERM,
    allTermSections: courses.length,
    activeTermSections: active.length,
    activeTermCourseCodes: byCode.size,
    description: {
      filled: withDescription.length,
      filledPct: pct(withDescription.length, entries.length),
      atLeast50Chars: entries.filter(item => item.descriptionLength >= 50).length,
      atLeast50CharsPct: pct(entries.filter(item => item.descriptionLength >= 50).length, entries.length),
      lengthQuantiles: quantiles(withDescription.map(item => item.descriptionLength)),
    },
    ragTag: {
      anyTag: entries.filter(item => item.rawTagCount > 0).length,
      anyTagPct: pct(entries.filter(item => item.rawTagCount > 0).length, entries.length),
      crossMatchTag: entries.filter(item => item.crossTagCount > 0).length,
      crossMatchTagPct: pct(entries.filter(item => item.crossTagCount > 0).length, entries.length),
      crossTagCountQuantiles: quantiles(entries.map(item => item.crossTagCount)),
    },
  };
}

async function loadProfile(identity, prefs) {
  const consented = await hasPersonalizationConsent(identity);
  const now = new Date();
  const retentionMs = PRIVACY_RETENTION.interactionEventDays * 86400000;
  const events = consented
    ? (await getInteractionEventsForExport(identity)).filter(event => {
      const time = Date.parse(event.timestamp ?? '');
      return Number.isFinite(time) && now.getTime() - time <= retentionMs;
    })
    : [];
  return {
    consented,
    eventCount: events.length,
    learned: computeTagInterestProfile(events, prefs, { now, activeTerm: ACTIVE_TERM }),
    explicitOnly: computeTagInterestProfile([], prefs, { now, activeTerm: ACTIVE_TERM }),
  };
}

function classify(profile, rawTags) {
  const scored = scoreCourseTagInterest(profile, rawTags);
  if (scored.eligibleTagCount === 0) return 'noCrossMatchTags';
  if (scored.evidenceTagCount === 0) return 'noUserSignal';
  return 'scored';
}

async function accountStats(account, allCourses, codeTags) {
  const identity = { canonicalId: account.studentId, numericId: account.numericId, studentId: account.studentId };
  const prefs = await getUserPreferences(identity);
  const scope = buildStudentScope(prefs);
  if (!scope.resolved) return { studentId: account.studentId, persona: account.persona, error: 'student_scope_unavailable' };

  const pool = filterCategorizedCourses(allCourses, {}, scope, { includeGeneralEducation: true, schedulingPool: true });
  // 以課號為單位：同一課號取可比對標籤最多的那個班次。
  const candidates = new Map();
  for (const course of pool) {
    if (course.category === CATEGORY_REQUIRED || course.type === CATEGORY_REQUIRED) continue;
    const key = code(course.catalogCourseCode);
    if (!key) continue;
    const current = candidates.get(key);
    if (!current || crossTags(course.ragTag).length > crossTags(current.ragTag).length) candidates.set(key, course);
  }

  const profiles = await loadProfile(identity, prefs);
  const count = profile => {
    const result = { scored: 0, noUserSignal: 0, noCrossMatchTags: 0 };
    for (const course of candidates.values()) result[classify(profile, course.ragTag)] += 1;
    return result;
  };
  const learnedCounts = count(profiles.learned);
  const explicitCounts = count(profiles.explicitOnly);

  // 歷史修課：最新一次已通過、非必修。
  const latest = [...getLatestAttemptsByCourseCode(prefs.courseHistory ?? []).values()].filter(entry => entry?.passed);
  const byCategory = {};
  for (const entry of latest) byCategory[entry.graduationCategory ?? 'null'] = (byCategory[entry.graduationCategory ?? 'null'] ?? 0) + 1;
  const nonRequired = latest.filter(entry => NON_REQUIRED_HISTORY.has(entry.graduationCategory));
  const historyTagIds = new Set();
  let nonRequiredWithTags = 0;
  for (const entry of nonRequired) {
    const ids = codeTags.get(code(entry.courseCode));
    if (ids && ids.size > 0) {
      nonRequiredWithTags += 1;
      ids.forEach(id => historyTagIds.add(id));
    }
  }

  // 階段 A 的上限估計：候選課是否與非必修歷史課共用至少一個可跨課比對標籤。
  let historyOverlap = 0;
  let historyOverlapAmongUnscored = 0;
  for (const course of candidates.values()) {
    const shares = crossTags(course.ragTag).some(tag => historyTagIds.has(tag.canonicalTagId));
    if (!shares) continue;
    historyOverlap += 1;
    if (classify(profiles.learned, course.ragTag) !== 'scored') historyOverlapAmongUnscored += 1;
  }
  const unscored = learnedCounts.noUserSignal + learnedCounts.noCrossMatchTags;

  return {
    studentId: account.studentId,
    persona: account.persona,
    consented: profiles.consented,
    eventCount: profiles.eventCount,
    tagInterestCount: profiles.learned.tagInterests?.length ?? 0,
    nonRequiredCandidates: candidates.size,
    learned: { ...learnedCounts, unscoredPct: pct(unscored, candidates.size) },
    explicitOnly: {
      ...explicitCounts,
      unscoredPct: pct(explicitCounts.noUserSignal + explicitCounts.noCrossMatchTags, candidates.size),
    },
    history: {
      passedCourses: latest.length,
      passedByCategory: byCategory,
      nonRequiredPassed: nonRequired.length,
      nonRequiredWithCrossTags: nonRequiredWithTags,
      distinctCrossTags: historyTagIds.size,
      candidatesSharingTag: historyOverlap,
      candidatesSharingTagPct: pct(historyOverlap, candidates.size),
      unscoredCandidatesSharingTag: historyOverlapAmongUnscored,
      unscoredCandidatesSharingTagPct: pct(historyOverlapAmongUnscored, unscored),
    },
  };
}

async function main() {
  if (!isMysqlConfigured()) throw new Error('未設定 MySQL（DB_*），無法量測。');
  const allCourses = await getAll('courses');
  const codeTags = buildCodeTagIndex(allCourses);
  const catalog = catalogStats(allCourses);
  const perAccount = [];
  for (const account of accounts) perAccount.push(await accountStats(account, allCourses, codeTags));

  const output = { generatedAt: new Date().toISOString(), readOnly: true, catalog, accounts: perAccount };
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'stage0.json'), JSON.stringify(output, null, 2));
  console.log(JSON.stringify(output, null, 2));
}

try {
  await main();
} finally {
  await closePool();
}
