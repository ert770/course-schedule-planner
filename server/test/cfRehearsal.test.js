// 協同過濾構想階段 8 的模擬演練（2026-10-15）：沒有真人樣本，先用 10 位 Persona 代替。
// 模擬共現表只由 Persona 組成、只放記憶體、只套用在 Persona 自己的排課；真人一律讀正式表。
import { beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { deriveSubjectId } from '../src/services/privacyService.js';
import {
  CF_REHEARSAL_GATE,
  buildSimulatedCourseNeighbors,
  evaluateCfRehearsalGate,
  invalidateSimulatedCourseNeighbors,
  loadSimulatedCourseNeighbors,
  resetCourseNeighborStateForTests,
} from '../src/services/courseNeighborService.js';
import { loadCfInterestContext } from '../src/services/scheduleService.js';
import { makeCourse } from './fixtures.js';

for (const key of ['DB_HOST', 'DB_USER', 'DB_NAME']) delete process.env[key];
process.env.ANALYTICS_ID_SECRET = 'test-only-analytics-secret-32-characters';

const history = courseCode => ({
  courseCode, courseName: courseCode, passed: true, graduationCategory: 'elective', academicYear: 114, semester: 1,
});
const personas = Array.from({ length: 6 }, (_, index) => ({ id: 9001 + index, studentId: `D000${9001 + index}` }));
const realUsers = Array.from({ length: 4 }, (_, index) => ({ id: index + 1, studentId: `D00003${index}` }));
const deps = ({ users = [...personas, ...realUsers], history: courses = ['A', 'B', 'C'], counter = null } = {}) => ({
  listContributors: async () => {
    if (counter) counter.calls += 1;
    return new Map(users.map(user => [deriveSubjectId(user.studentId), { simulated: false }]));
  },
  loadUsers: async () => users,
  loadProfile: async () => ({ courseHistory: courses.map(history) }),
  loadEvents: async () => [],
});

describe('SIM：階段 8 模擬共現表（Persona）', () => {
  beforeEach(() => resetCourseNeighborStateForTests());

  test('SIM-1 模擬表只由 Persona 組成；真人即使同意也不放進模擬表', async () => {
    const build = await buildSimulatedCourseNeighbors({ deps: deps() });
    assert.equal(build.simulated, true);
    assert.equal(build.gate.contributors, personas.length);
    assert.equal(build.stats.keptPairs, 3);
    assert.match(build.buildId, /^simulated-/);
  });

  test('SIM-2 演練門檻：至少 5 位 Persona 各有 3 筆有效互動，且有保留的配對', () => {
    const contributor = count => ({ signals: new Map(Array.from({ length: count }, (_, i) => [`C${i}`, 1])) });
    assert.equal(CF_REHEARSAL_GATE.minContributors, 5);
    assert.equal(evaluateCfRehearsalGate(Array.from({ length: 5 }, () => contributor(3)), 1).met, true);
    assert.equal(evaluateCfRehearsalGate(Array.from({ length: 4 }, () => contributor(3)), 1).met, false);
    assert.equal(evaluateCfRehearsalGate(Array.from({ length: 5 }, () => contributor(2)), 1).met, false);
    assert.equal(evaluateCfRehearsalGate(Array.from({ length: 5 }, () => contributor(3)), 0).met, false);
  });

  test('SIM-3 快取：同時兩次讀取只建一次；同意變動後重建', async () => {
    const counter = { calls: 0 };
    const [first, second] = await Promise.all([
      loadSimulatedCourseNeighbors({ deps: deps({ counter }) }),
      loadSimulatedCourseNeighbors({ deps: deps({ counter }) }),
    ]);
    assert.equal(counter.calls, 1);
    assert.equal(first.buildId, second.buildId);
    await loadSimulatedCourseNeighbors({ deps: deps({ counter }) });
    assert.equal(counter.calls, 1);
    invalidateSimulatedCourseNeighbors();
    await loadSimulatedCourseNeighbors({ deps: deps({ counter }) });
    assert.equal(counter.calls, 2);
  });
});

describe('SIM：Persona 與真人讀不同的表', () => {
  const candidates = [
    makeCourse(88101, { department: '資訊三合', category: '選修', dayOfWeek: 1, catalogCourseCode: 'B' }),
  ];
  const prefs = { courseHistory: [history('A')] };
  const neighbors = new Map([['B', [{ courseCode: 'A', similarity: 0.5, coCount: 3 }]]]);
  const loadEvents = async () => [];

  test('SIM-4 Persona 讀模擬表；達演練門檻才加分，未達時記原因', async () => {
    const persona = { numericId: '9003' };
    const met = await loadCfInterestContext(persona, prefs, candidates, {
      mode: 'active', loadEvents, loadSimulatedNeighbors: async () => ({ available: true, simulated: true, gateMet: true, neighbors }),
    });
    assert.equal(met.simulated, true);
    assert.equal(met.source, 'cf');
    assert.ok(met.coursesBySectionId[88101].score > 0);

    const notMet = await loadCfInterestContext(persona, prefs, candidates, {
      mode: 'active', loadEvents, loadSimulatedNeighbors: async () => ({ available: true, simulated: true, gateMet: false, neighbors }),
    });
    assert.equal(notMet.source, 'rehearsal_gate_not_met');
    assert.equal(notMet.coursesBySectionId[88101].score, null);
  });

  test('SIM-5 真人永遠不讀模擬表', async () => {
    let simulatedCalls = 0;
    const real = await loadCfInterestContext({ numericId: '1' }, prefs, candidates, {
      mode: 'active',
      loadEvents,
      loadSimulatedNeighbors: async () => { simulatedCalls += 1; return { available: true, gateMet: true, neighbors }; },
    });
    assert.equal(simulatedCalls, 0);
    assert.equal(real.simulated, false);
    assert.equal(real.source, 'not_built'); // 測試環境沒有正式表
  });
});
