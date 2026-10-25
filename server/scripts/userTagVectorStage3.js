// 協同過濾與 User Embedding 構想階段 3：使用者向量與 s_vec 的離線評估，不接排課。
// **只讀**：對資料庫只做 SELECT；不寫任何表。輸出到 `server/simulation-runs/<out>/`（不進版控）。
//
// 每個帳號比較兩種設定：
//   identity  純標籤空間（只認同一標籤）
//   neighbors 接上階段 2 的標籤相近表（tagVectorNeighbors.json）
// 量：
//   1. 非必修候選課中有分數（正向相似 > 0）的比例，對照標籤興趣檔 s_tag；分數為 1 與負分的課數。
//   2. 兩種設定的排序一致性（Spearman）與前 20 名重疊。
//   3. s_vec 與 s_tag 的相關（兩者都有分數的課），檢查是否重複計算同一個訊號。
//   4. 歷史修課留一法：拿掉一門非必修已修課（連同它的事件），用其餘資料建向量，
//      看這門課在「候選池＋它」之中的百分位排名。隨機排序的期望值是 0.5。
//      另外比較歷史修課的學期衰減 1.0／0.8／0.6。
//   5. 真實帳號前 10 名與推薦理由。
//
// 用法：node scripts/userTagVectorStage3.js --out=user-tag-vector-stage3

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(scriptDir, '..', '.env'), quiet: true });
dotenv.config({ path: path.resolve(scriptDir, '..', '..', '.env'), quiet: true });

const { ACTIVE_TERM } = await import('../src/data/activeTerm.js');
const { getAll } = await import('../src/db/database.js');
const { closePool, isMysqlConfigured } = await import('../src/db/mysql.js');
const { getUserPreferences } = await import('../src/services/memoryService.js');
const { hasPersonalizationConsent, getInteractionEventsForExport } = await import('../src/services/interactionEventService.js');
const { PRIVACY_RETENTION } = await import('../src/data/privacyPolicy.js');
const { getLatestAttemptsByCourseCode } = await import('../src/data/courseHistory.js');
const { buildStudentScope } = await import('../src/skills/courseScope.js');
const { filterCategorizedCourses } = await import('../src/skills/courseQuery.js');
const { CATEGORY_REQUIRED } = await import('../src/skills/courseCategory.js');
const { computeTagInterestProfile, scoreCourseTagInterest } = await import('../src/skills/tagInterestLearning.js');
const { buildCourseTagVectors, buildTagSimilarity } = await import('../src/skills/tagVectorSpace.js');
const { buildUserTagVector, scoreCoursesForUser, explainCourseForUser } = await import('../src/skills/userTagVector.js');

const args = process.argv.slice(2);
const outName = args.find(arg => arg.startsWith('--out='))?.split('=')[1];
if (!outName) { console.error('請指定 --out=<名稱>'); process.exit(1); }
const outDir = path.resolve(scriptDir, '..', 'simulation-runs', outName);
// --no-downweights：不套用審核過的降權名單；--downweights=<檔案>：改用另一份名單（皆為對照用）。
const NO_DOWNWEIGHTS = args.includes('--no-downweights');
// --neighbors=<檔案>：改用另一份標籤相近表（評估對照用）。
const neighborFile = args.find(arg => arg.startsWith('--neighbors='))?.split('=')[1];
const neighborTable = JSON.parse(fs.readFileSync(
  neighborFile ? path.resolve(neighborFile) : new URL('../src/data/tagVectorNeighbors.json', import.meta.url), 'utf8'));

const ACCOUNTS = [
  { studentId: 'D1249697', numericId: '1', persona: false },
  ...Array.from({ length: 10 }, (_, index) => ({ studentId: `D000${9001 + index}`, numericId: String(9001 + index), persona: true })),
];
const NON_REQUIRED_HISTORY = new Set(['elective', 'general', 'external']);
const DECAYS = [1, 0.8, 0.6];
const code = value => String(value ?? '').trim().toUpperCase();
const round = (value, digits = 3) => (value === null || value === undefined ? null : Number(value.toFixed(digits)));
const pct = (part, whole) => (whole > 0 ? round(part / whole * 100, 1) : null);

function ranks(values) {
  const order = values.map((value, i) => [value, i]).sort((x, y) => x[0] - y[0]);
  const result = new Array(values.length);
  for (let i = 0; i < order.length;) {
    let j = i;
    while (j + 1 < order.length && order[j + 1][0] === order[i][0]) j += 1;
    for (let k = i; k <= j; k += 1) result[order[k][1]] = (i + j) / 2;
    i = j + 1;
  }
  return result;
}
function pearson(x, y) {
  const n = x.length;
  if (n < 3) return null;
  const mx = x.reduce((s, v) => s + v, 0) / n;
  const my = y.reduce((s, v) => s + v, 0) / n;
  let sxy = 0; let sxx = 0; let syy = 0;
  for (let i = 0; i < n; i += 1) { sxy += (x[i] - mx) * (y[i] - my); sxx += (x[i] - mx) ** 2; syy += (y[i] - my) ** 2; }
  return sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : null;
}
const spearman = (x, y) => pearson(ranks(x), ranks(y));
const topCodes = (scored, k) => [...scored].filter(([, item]) => item.raw !== null)
  .sort((x, y) => y[1].raw - x[1].raw || x[0].localeCompare(y[0])).slice(0, k).map(([c]) => c);

async function loadEvents(identity) {
  if (!(await hasPersonalizationConsent(identity))) return { consented: false, events: [] };
  const now = Date.now();
  const retentionMs = PRIVACY_RETENTION.interactionEventDays * 86400000;
  const events = (await getInteractionEventsForExport(identity)).filter(event => {
    const time = Date.parse(event.timestamp ?? '');
    return Number.isFinite(time) && now - time <= retentionMs;
  });
  return { consented: true, events };
}

// 留一法：每門非必修已修課輪流拿掉，回傳它在候選池中的百分位（1 = 最前面）。
function leaveOneOut({ prefs, events, index, pool, similarity, decay }) {
  const held = [...getLatestAttemptsByCourseCode(prefs.courseHistory ?? []).values()]
    .filter(entry => entry?.passed && NON_REQUIRED_HISTORY.has(entry.graduationCategory))
    .map(entry => code(entry.courseCode))
    .filter(c => index.vectors.get(c)?.norm > 0);
  const percentiles = [];
  for (const target of held) {
    const user = buildUserTagVector({
      courseHistory: prefs.courseHistory, events, prefs, index, activeTerm: ACTIVE_TERM,
      now: new Date().toISOString(), excludeCourseCodes: [target], options: { historyTermDecay: decay },
    });
    const codes = [...pool.filter(c => c !== target), target];
    const scored = scoreCoursesForUser(user, index, codes, { similarity });
    const own = scored.get(target).raw;
    if (own === null) continue;
    const others = codes.filter(c => c !== target).map(c => scored.get(c).raw ?? -Infinity);
    const below = others.filter(v => v < own).length;
    const ties = others.filter(v => v === own).length;
    percentiles.push((below + ties / 2) / others.length);
  }
  const mean = percentiles.reduce((s, v) => s + v, 0) / (percentiles.length || 1);
  return {
    heldOut: held.length,
    scored: percentiles.length,
    meanPercentile: percentiles.length ? round(mean) : null,
    inTop10Pct: percentiles.filter(v => v >= 0.9).length,
  };
}

async function main() {
  if (!isMysqlConfigured()) throw new Error('未設定 MySQL（DB_*），無法量測。');
  const allCourses = await getAll('courses');
  const downweightFile = args.find(arg => arg.startsWith('--downweights='))?.split('=')[1];
  const index = buildCourseTagVectors(allCourses, NO_DOWNWEIGHTS
    ? { downweights: null }
    : downweightFile ? { downweights: JSON.parse(fs.readFileSync(downweightFile, 'utf8')) } : {});
  const variants = { identity: buildTagSimilarity(null), neighbors: buildTagSimilarity(neighborTable) };
  const results = [];
  let realTop = null;

  for (const account of ACCOUNTS) {
    const identity = { canonicalId: account.studentId, numericId: account.numericId, studentId: account.studentId };
    const prefs = await getUserPreferences(identity);
    const scope = buildStudentScope(prefs);
    if (!scope.resolved) { results.push({ studentId: account.studentId, error: 'student_scope_unavailable' }); continue; }
    const { consented, events } = await loadEvents(identity);
    const pool = [...new Set(filterCategorizedCourses(allCourses, {}, scope, { includeGeneralEducation: true, schedulingPool: true })
      .filter(course => course.category !== CATEGORY_REQUIRED && course.type !== CATEGORY_REQUIRED)
      .map(course => code(course.catalogCourseCode)).filter(Boolean))];
    const ragBySection = new Map(allCourses.map(course => [code(course.catalogCourseCode), course.ragTag]));
    const profile = computeTagInterestProfile(events, prefs, { now: new Date(), activeTerm: ACTIVE_TERM });
    const sTag = new Map(pool.map(c => {
      const scored = scoreCourseTagInterest(profile, ragBySection.get(c));
      return [c, scored.evidenceTagCount > 0 ? scored.score : null];
    }));

    const user = buildUserTagVector({
      courseHistory: prefs.courseHistory, events, prefs, index, activeTerm: ACTIVE_TERM, now: new Date().toISOString(),
    });
    const scoredBy = Object.fromEntries(Object.entries(variants).map(([name, similarity]) => (
      [name, scoreCoursesForUser(user, index, pool, { similarity })]
    )));
    const coverage = Object.fromEntries(Object.entries(scoredBy).map(([name, scored]) => {
      const items = [...scored.values()];
      const positive = items.filter(item => item.raw !== null && item.positive > 0).length;
      return [name, {
        withSignal: positive,
        pct: pct(positive, pool.length),
        scoreAtOne: items.filter(item => item.score === 1).length,
        negativeScore: items.filter(item => item.score !== null && item.score < 0).length,
      }];
    }));
    const both = pool.filter(c => scoredBy.identity.get(c).raw !== null);
    const agreement = {
      spearman: round(spearman(both.map(c => scoredBy.identity.get(c).raw), both.map(c => scoredBy.neighbors.get(c).raw))),
      top20Overlap: topCodes(scoredBy.identity, 20).filter(c => topCodes(scoredBy.neighbors, 20).includes(c)).length,
    };
    const withTag = pool.filter(c => sTag.get(c) !== null && scoredBy.neighbors.get(c).raw !== null);
    const tagCorrelation = {
      courses: withTag.length,
      pearson: round(pearson(withTag.map(c => sTag.get(c)), withTag.map(c => scoredBy.neighbors.get(c).raw))),
    };
    const looByDecay = {};
    for (const decay of DECAYS) {
      looByDecay[decay] = {};
      for (const [name, similarity] of Object.entries(variants)) {
        looByDecay[decay][name] = leaveOneOut({ prefs, events, index, pool, similarity, decay });
      }
    }

    results.push({
      studentId: account.studentId,
      persona: account.persona,
      consented,
      events: events.length,
      sources: user.sources,
      nonRequiredCandidates: pool.length,
      sTagCoverage: { withSignal: [...sTag.values()].filter(v => v !== null).length, pct: pct([...sTag.values()].filter(v => v !== null).length, pool.length) },
      sVecCoverage: coverage,
      agreement,
      tagCorrelation,
      leaveOneOut: looByDecay,
    });

    if (!account.persona) {
      realTop = topCodes(scoredBy.neighbors, 10).map(c => {
        const explanation = explainCourseForUser(user, index, c, { similarity: variants.neighbors });
        return {
          courseCode: c,
          name: index.courseNames.get(c),
          raw: round(scoredBy.neighbors.get(c).raw),
          score: round(scoredBy.neighbors.get(c).score),
          identityRaw: round(scoredBy.identity.get(c).raw),
          sTag: round(sTag.get(c)),
          reasonTags: explanation.tags.map(t => (t.viaNeighbor ? `${t.userTag}≈${t.courseTag}` : t.courseTag)),
          closestEvidence: explanation.closestEvidence
            ? `${explanation.closestEvidence.name || explanation.closestEvidence.courseCode}（${explanation.closestEvidence.source}，${round(explanation.closestEvidence.similarity)}）`
            : null,
        };
      });
    }
  }

  const output = { generatedAt: new Date().toISOString(), readOnly: true, term: ACTIVE_TERM, accounts: results, realAccountTop10: realTop };
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'stage3.json'), JSON.stringify(output, null, 2));
  console.log(JSON.stringify(output, null, 2));
}

try {
  await main();
} finally {
  await closePool();
}
