// 協同過濾與 User Embedding 構想階段 7：collaborative_learning 同意、item-item 共現表與 s_cf shadow。
import { beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { PRIVACY_POLICY, PRIVACY_POLICY_VERSION, PRIVACY_PURPOSES } from '../src/data/privacyPolicy.js';
import {
  deriveSubjectId,
  listCollaborativeContributors,
  recordConsentChoices,
  resetPrivacyMemoryStoreForTests,
} from '../src/services/privacyService.js';
import { interestTagCatalog } from '../src/data/interestTagCatalog.js';
import { buildTagInterestSnapshot } from '../src/skills/tagInterestLearning.js';
import {
  CF_ACTIVATION_GATE,
  buildCourseNeighbors,
  buildUserCourseSignals,
  countEffectiveInteractions,
  evaluateCfActivationGate,
  scoreCoursesWithCf,
} from '../src/skills/itemItemCf.js';
import { assertInterestConfig, resolveCfInterestMode } from '../src/skills/interestAlphas.js';
import {
  collectContributorSignals,
  loadLatestCourseNeighbors,
  rebuildCourseNeighbors,
  resetCourseNeighborStateForTests,
} from '../src/services/courseNeighborService.js';
import { generateScheduleWithTagInterestContext, loadCfInterestContext } from '../src/services/scheduleService.js';
import { generateSchedule } from '../src/skills/scheduler.js';
import { makeCourse } from './fixtures.js';

// 共現表的重建會寫入 MySQL；測試一律走記憶體，絕不碰共用資料庫。
for (const key of ['DB_HOST', 'DB_USER', 'DB_NAME']) delete process.env[key];

const tag = interestTagCatalog.canonicalTags.find(item => item.eligibility?.crossCourseMatchEligible === true);
const history = (courseCode, graduationCategory = 'elective') => ({
  courseCode, courseName: courseCode, passed: true, graduationCategory, academicYear: 114, semester: 1,
});
const signals = entries => new Map(entries);

describe('CC：collaborative_learning 同意', () => {
  beforeEach(() => {
    process.env.NODE_ENV = 'test';
    process.env.PRIVACY_STORE = 'memory';
    process.env.PRIVACY_ENFORCEMENT_ENABLED = 'true';
    process.env.ANALYTICS_ID_SECRET = 'test-only-analytics-secret-32-characters';
    process.env.PRIVACY_DATA_KEY_V1 = Buffer.alloc(32, 7).toString('base64');
    resetPrivacyMemoryStoreForTests();
  });
  const choices = (personalization, collaborative) => ({
    service_processing: true,
    personalization_learning: personalization,
    collaborative_learning: collaborative,
    aggregate_research: false,
  });

  test('CC-1 政策：新用途預設不同意、以個人化學習為前提，政策已升版', () => {
    const purpose = PRIVACY_POLICY.purposes.find(item => item.id === PRIVACY_PURPOSES.COLLABORATIVE_LEARNING);
    assert.equal(purpose.required, false);
    assert.equal(purpose.defaultGranted, false);
    assert.deepEqual(purpose.requires, [PRIVACY_PURPOSES.PERSONALIZATION_LEARNING]);
    assert.equal(PRIVACY_POLICY_VERSION, '2026-10-14.v4');
    assert.equal(PRIVACY_POLICY.retention.collaborativeMinimumCooccurrence, 3);
  });

  test('CC-2 沒有勾個人化學習時，協同過濾一律記為不同意', async () => {
    const status = await recordConsentChoices({ canonicalId: 'D0000101' }, choices(false, true));
    assert.equal(status.consents.collaborative_learning.granted, false);
  });

  test('CC-3 貢獻者：兩項都同意才算；撤回個人化學習一併退出；來源不是隱私中心的標為模擬', async () => {
    const real = { canonicalId: 'D0000102' };
    const persona = { canonicalId: 'D0000103' };
    const onlyPersonalization = { canonicalId: 'D0000104' };
    await recordConsentChoices(real, choices(true, true));
    await recordConsentChoices(persona, choices(true, true), { source: 'persona_seed' });
    await recordConsentChoices(onlyPersonalization, choices(true, false));
    let contributors = await listCollaborativeContributors();
    assert.deepEqual([...contributors.keys()].sort(), [deriveSubjectId('D0000102'), deriveSubjectId('D0000103')].sort());
    assert.equal(contributors.get(deriveSubjectId('D0000102')).simulated, false);
    assert.equal(contributors.get(deriveSubjectId('D0000103')).simulated, true);
    await recordConsentChoices(real, choices(false, false));
    contributors = await listCollaborativeContributors();
    assert.equal(contributors.has(deriveSubjectId('D0000102')), false);
  });
});

describe('CF：item-item 計算', () => {
  test('CF-1 課程訊號：已通過非必修 +0.5；必修、未通過不算；探索問卷不算；不喜歡改為 −1', () => {
    const course = { catalogCourseCode: 'H1', ragTag: [tag.name], category: '選修' };
    const feedback = response => {
      const event = {
        eventId: `hf-${response}`, eventType: 'history_course_feedback', timestamp: '2026-10-01T00:00:00.000Z',
        course: { catalogCourseCode: 'H1', sectionId: 1 }, term: { academicYear: 114, semester: 'second' },
        source: 'history_review', interestFeedback: { response, canonicalTagIds: [] },
      };
      return { ...event, tagInterestSnapshot: buildTagInterestSnapshot(event, course, { resolved: true }) };
    };
    const courseHistory = [history('H1'), history('R1', 'required'), { ...history('F1'), passed: false }];
    assert.deepEqual([...buildUserCourseSignals({ courseHistory })], [['H1', 0.5]]);
    assert.deepEqual([...buildUserCourseSignals({ courseHistory, events: [feedback('liked')] })], [['H1', 1]]);
    assert.deepEqual([...buildUserCourseSignals({ courseHistory, events: [feedback('disliked')] })], [['H1', -1]]);
  });

  test('CF-2 共現少於 3 人的配對不保留；支持度收縮讓少數共現的相似度變小', () => {
    const users = [
      ...Array.from({ length: 3 }, () => ({ signals: signals([['A', 1], ['B', 1]]) })),
      ...Array.from({ length: 2 }, () => ({ signals: signals([['A', 1], ['C', 1]]) })),
      { signals: signals([['A', 0.1], ['D', 1]]) }, // 只瀏覽 A，不算「選了」
    ];
    const { neighbors, stats } = buildCourseNeighbors(users);
    assert.deepEqual(neighbors.get('A').map(item => item.courseCode), ['B']);
    assert.equal(neighbors.has('C'), false);
    assert.equal(stats.keptPairs, 1);
    assert.equal(stats.droppedPairs, 1);
    const [ab] = neighbors.get('A');
    // co 3、nA 5、nB 3：3/sqrt(15) × 3/(3+5)
    assert.ok(Math.abs(ab.similarity - (3 / Math.sqrt(15)) * (3 / 8)) < 1e-12);
    assert.equal(ab.coCount, 3);
  });

  test('CF-3 s_cf：相近課的訊號加權；相似度總和小於 1 時不放大；沒有重疊為 null', () => {
    const neighbors = new Map([
      ['X', [{ courseCode: 'A', similarity: 0.4, coCount: 3 }, { courseCode: 'B', similarity: 0.2, coCount: 3 }]],
      ['Y', [{ courseCode: 'A', similarity: 0.8, coCount: 3 }, { courseCode: 'B', similarity: 0.8, coCount: 3 }]],
      ['Z', [{ courseCode: 'Q', similarity: 0.9, coCount: 3 }]],
    ]);
    const scores = scoreCoursesWithCf(signals([['A', 1], ['B', -1]]), neighbors, ['x', 'Y', 'Z', 'W']);
    assert.ok(Math.abs(scores.get('X').score - 0.2) < 1e-12);
    assert.equal(scores.get('Y').score, 0);
    assert.deepEqual(scores.get('Z'), { score: null, matched: 0 });
    assert.deepEqual(scores.get('W'), { score: null, matched: 0 });
  });

  test('CF-4 啟用門檻只計真人，且每人至少 3 筆有效互動', () => {
    const enough = signals([['A', 1], ['B', 0.5], ['C', -1]]);
    const few = signals([['A', 1], ['B', 0.1]]);
    assert.equal(countEffectiveInteractions(enough), 3);
    const contributors = [
      ...Array.from({ length: 14 }, () => ({ signals: enough, simulated: false })),
      { signals: few, simulated: false },
      ...Array.from({ length: 5 }, () => ({ signals: enough, simulated: true })),
    ];
    const gate = evaluateCfActivationGate(contributors, 10);
    assert.equal(gate.realContributors, 15);
    assert.equal(gate.eligibleRealContributors, 14);
    assert.equal(gate.simulatedContributors, 5);
    assert.equal(gate.met, false);
    assert.equal(evaluateCfActivationGate([...contributors, { signals: enough, simulated: false }], 10).met, true);
    assert.equal(CF_ACTIVATION_GATE.minRealContributors, 15);
  });

  test('CF-5 CF_INTEREST_MODE 只接受 off／shadow；active 拒絕啟動', () => {
    assert.equal(resolveCfInterestMode(undefined), 'shadow');
    assert.equal(resolveCfInterestMode('off'), 'off');
    assert.throws(() => resolveCfInterestMode('active'), /尚未開放/);
    assert.throws(() => assertInterestConfig({ CF_INTEREST_MODE: 'active' }), /尚未開放/);
  });
});

describe('CN：共現表建立與讀取', () => {
  beforeEach(() => resetCourseNeighborStateForTests());
  const users = Array.from({ length: 5 }, (_, index) => ({ id: index + 1, studentId: `D00002${index}` }));
  const subject = index => deriveSubjectId(`D00002${index}`);
  const deps = (simulatedIndexes = []) => ({
    listContributors: async () => new Map(users.map((_, index) => [subject(index), { simulated: simulatedIndexes.includes(index) }])),
    loadUsers: async () => users,
    loadProfile: async () => ({ courseHistory: [history('A'), history('B'), history('C')] }),
    loadEvents: async () => [],
  });

  test('CN-1 正式表只用真人；Persona 只在 dry-run 加入；寫入時禁止加入模擬資料', async () => {
    const collected = await collectContributorSignals({ deps: deps([3, 4]) });
    assert.equal(collected.contributors.length, 3);
    assert.equal(collected.skippedSimulated, 2);
    const dryRun = await rebuildCourseNeighbors({ persist: false, includeSimulated: true, deps: deps([3, 4]) });
    assert.equal(dryRun.gate.simulatedContributors, 2);
    await assert.rejects(rebuildCourseNeighbors({ persist: true, includeSimulated: true, deps: deps() }), /只能用於 dry-run/);
  });

  test('CN-2 重建後讀得到最新的表；輸出不含 subject 或學號', async () => {
    const before = await loadLatestCourseNeighbors();
    assert.equal(before.available, false);
    resetCourseNeighborStateForTests();
    const build = await rebuildCourseNeighbors({ deps: deps() });
    assert.equal(build.stats.keptPairs, 3);
    assert.equal(build.gate.met, false); // 只有 5 位真人
    const latest = await loadLatestCourseNeighbors();
    assert.equal(latest.available, true);
    assert.equal(latest.neighbors.get('A').length, 2);
    const serialized = JSON.stringify({ ...build, neighbors: [...build.neighbors] });
    assert.equal(/D00002|v1:/.test(serialized), false);
  });
});

describe('CS：s_cf shadow 接入排課', () => {
  const candidates = [
    makeCourse(87101, { department: '資訊三合', category: '選修', dayOfWeek: 1, catalogCourseCode: 'IECS8101' }),
    makeCourse(87102, { department: '資訊三合', category: '選修', dayOfWeek: 2, catalogCourseCode: 'IECS8102' }),
  ];
  const constraints = {
    department: '資訊工程學系', gradeLevel: 3, className: '資訊三甲',
    minCredits: 0, maxCredits: 3, planSet: 'primary-only',
  };
  const neighbors = new Map([
    ['IECS8101', [{ courseCode: 'H9', similarity: 0.9, coCount: 3 }]],
    ['IECS8102', [{ courseCode: 'H8', similarity: 0.9, coCount: 3 }]],
  ]);
  const prefs = { courseHistory: [history('H8')] };
  const loadNeighbors = async () => ({ available: true, gateMet: false, neighbors });

  test('CS-1 context：用本人訊號查共現表；沒有重疊的課沒有分數', async () => {
    const context = await loadCfInterestContext({}, prefs, candidates, { mode: 'shadow', loadNeighbors, loadEvents: async () => [] });
    assert.equal(context.source, 'cf');
    assert.equal(context.alpha, 0.1);
    assert.equal(context.gateMet, false);
    assert.deepEqual(context.coursesBySectionId[87101], { score: null, reason: 'no_neighbor_overlap' });
    assert.ok(context.coursesBySectionId[87102].score > 0);
  });

  test('CS-2 共現表不存在、為空、本人沒有訊號時記原因；off 不計算', async () => {
    const missing = await loadCfInterestContext({}, prefs, candidates, {
      mode: 'shadow', loadNeighbors: async () => ({ available: false, reason: 'table_missing', neighbors: new Map() }), loadEvents: async () => [],
    });
    assert.equal(missing.source, 'table_missing');
    const empty = await loadCfInterestContext({}, prefs, candidates, {
      mode: 'shadow', loadNeighbors: async () => ({ available: true, neighbors: new Map() }), loadEvents: async () => [],
    });
    assert.equal(empty.source, 'empty_table');
    const noSignal = await loadCfInterestContext({}, { courseHistory: [] }, candidates, { mode: 'shadow', loadNeighbors, loadEvents: async () => [] });
    assert.equal(noSignal.source, 'no-user-signal');
    assert.equal(await loadCfInterestContext({}, prefs, candidates, { mode: 'off', loadNeighbors }), null);
  });

  test('CS-3 s_vec 與 s_cf 分開記錄；shadow 不改變課表', async () => {
    const cfContext = await loadCfInterestContext({}, prefs, candidates, { mode: 'shadow', loadNeighbors, loadEvents: async () => [] });
    const baseline = generateSchedule(candidates, constraints);
    const shadow = generateScheduleWithTagInterestContext(candidates, constraints, null, generateSchedule, null, null, cfContext);
    assert.deepEqual(shadow.schedule.map(course => course.id), baseline.schedule.map(course => course.id));
    assert.ok(shadow.cfInterestShadowStats.poolComparisons > 0);
    assert.equal(shadow.cfInterestShadowStats.source, 'cf');
    assert.equal(shadow.cfInterestShadowStats.gateMet, false);
    assert.equal(shadow.vectorInterestShadowStats, undefined);
    assert.equal(Object.keys(shadow).includes('cfInterestShadowStats'), false);
  });
});
