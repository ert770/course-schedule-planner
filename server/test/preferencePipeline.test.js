import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalizeProfile } from '../src/data/profileSchema.js';
import { TAG_TO_FLAG } from '../src/data/preferenceTags.js';
import { executeAgentTool, handleChat } from '../src/services/agentService.js';
import { validatePlanningContext } from '../src/data/planningContextSchema.js';
import { resolvePlanningContext } from '../src/services/planningContextService.js';
import { readTemporaryPreference } from '../src/services/chatPreferenceService.js';
import { buildScheduleConstraints } from '../src/services/constraintService.js';
import { buildPreferenceProfile, generateSchedule } from '../src/skills/scheduler.js';
import { makeCourse, makeReview } from './fixtures.js';

const identity = { canonicalId: 'TEST-PREFERENCE' };
const request = { minCredits: 0, maxCredits: 12 };
const content = {
  noMidterm: '設有期中考。',
  practicalExam: '實作評量。',
  finalReport: '繳交期末報告。',
  weightDaily: '平時作業占六成。',
  noGroupReport: '小組作業。',
  preferDiscussion: '課堂討論。',
  englishTaught: '全程英文授課。',
  learnMore: '深入應用。',
  noRollCall: '上課不點名。',
};
const times = {
  noMorningClasses: { dayOfWeek: 2, startPeriod: 1, endPeriod: 1 },
  mondayFree: { dayOfWeek: 1, startPeriod: 3, endPeriod: 3 },
  lunchBreakFree: { dayOfWeek: 2, startPeriod: 5, endPeriod: 5 },
};

for (const [tag, flag] of TAG_TO_FLAG) {
  test(`${tag} 勾選與取消的已存偏好、Agent 和排課結果一致`, async () => {
    const prefs = normalizeProfile({ selectedTags: [] });
    const write = { updatePreferences: async (_identity, updates) => normalizeProfile(updates) };
    const constraints = checked => buildScheduleConstraints(request, normalizeProfile({ selectedTags: checked ? [tag] : [] }));
    const enabled = constraints(true);
    const disabled = constraints(false);
    assert.notDeepEqual(enabled, disabled);

    for (const [action, expected, selectedTags] of [['check', enabled, [tag]], ['uncheck', disabled, []]]) {
      const result = await executeAgentTool('update_preferences', { [action]: [flag] }, { identity, prefs }, write);
      assert.equal(result.success, true);
      assert.deepEqual(prefs.selectedTags, selectedTags);
      assert.deepEqual(buildScheduleConstraints(request, prefs), expected);
    }

    if (times[flag]) {
      const candidates = [makeCourse(1, times[flag])];
      assert.equal(generateSchedule(candidates, enabled).schedule.length, 0);
      assert.equal(generateSchedule(candidates, disabled).schedule.length, 1);
    } else if (content[flag]) {
      const candidates = [makeCourse(1, { description: content[flag] })];
      const scoredFlag = flag === 'preferDiscussion' ? 'discussion' : flag;
      const matches = input => generateSchedule(candidates, input).schedule[0].recommendationReason.matchedPreferences;
      assert.ok(matches(enabled).some(item => item.preferenceId === scoredFlag));
      assert.ok(!matches(disabled).some(item => item.preferenceId === scoredFlag));
    } else {
      const axis = flag === 'preferCompact' ? 'compact' : 'easy';
      assert.notEqual(buildPreferenceProfile(enabled)[axis], 0);
      assert.equal(buildPreferenceProfile(disabled)[axis], 0);
      const candidate = makeCourse(1);
      const scoring = input => generateSchedule([candidate], { ...input, courseReviews: [makeReview({ reviewCount: 5 })] })
        .plans[0].preferenceScore;
      assert.notEqual(scoring(enabled), scoring(disabled));
    }
  });
}

test('單次取消星期一排空仍保留個別封鎖時段', () => {
  const prefs = { mondayFree: true, blockedPeriods: [{ day: 1, period: 7 }] };
  const result = buildScheduleConstraints({ mondayFree: false }, prefs);
  assert.deepEqual(result.blockedPeriods, [{ day: 1, period: 7 }]);
});

test('聊天取消後從首頁重新勾選，Agent 以新保存的偏好回答「現在呢」', async () => {
  let prefs = normalizeProfile({ selectedTags: ['#星期一排空'] });
  const history = [
    { role: 'user', content: '取消星期一排空' },
    { role: 'assistant', content: '星期一排空：已取消。' },
  ];
  const updatePreferences = async (_identity, { selectedTags }) => {
    prefs = normalizeProfile({ selectedTags });
    return prefs;
  };
  const cancelled = await executeAgentTool('update_preferences', { uncheck: ['mondayFree'] },
    { identity, prefs }, { updatePreferences });
  assert.equal(cancelled.success, true);
  assert.deepEqual(prefs.selectedTags, []);

  await updatePreferences(identity, { selectedTags: ['#星期一排空'] });
  const response = await handleChat(identity, '現在呢？', null, {
    loadPreferences: async () => prefs,
    loadHistory: async () => history,
    saveExchange: async (_identity, _message, reply) => history.push({ role: 'assistant', content: reply }),
  });
  assert.match(response.reply, /目前已保存的排課偏好：星期一排空/);
  assert.doesNotMatch(response.reply, /已取消/);
  assert.equal(response.data, null);
  assert.equal(history.at(-1).content, response.reply);
});

function chatFixture(canonicalId, initial = {}) {
  const account = { canonicalId };
  let prefs = normalizeProfile({ department: '資訊工程學系', gradeLevel: 3, className: '資訊三甲', ...initial });
  let writes = 0;
  const requests = [];
  const history = [];
  const courses = [makeCourse(777, { dayOfWeek: 2, startPeriod: 6, endPeriod: 6, name: '手動加選' })];
  const planning = validatePlanningContext({
    currentCourses: [{ sectionId: 777 }], selectedCourses: [{ sectionId: 777 }],
  }).value;
  const deps = {
    lookupCourses: async ids => new Map(courses.filter(item => ids.includes(item.id)).map(item => [item.id, item])),
    updatePreferences: async (_, updates) => {
      writes++;
      prefs = normalizeProfile({ ...prefs, ...updates });
      return prefs;
    },
    generateSchedule: async (_, request) => {
      requests.push(request);
      return { success: true, schedule: courses };
    },
  };
  const options = {
    loadPreferences: async () => structuredClone(prefs),
    loadHistory: async () => history,
    resolvePlanning: (id, context) => resolvePlanningContext(id, context, { loadCourses: async () => courses }),
    saveExchange: async (_, message, reply) => history.push({ role: 'user', content: message }, { role: 'assistant', content: reply }),
    executeTool: (name, args, ctx) => executeAgentTool(name, args, ctx, deps),
  };
  return {
    account, requests, options,
    prefs: () => prefs, writes: () => writes,
    chat: (message, overrides = {}) => handleChat(account, message, planning, { ...options, ...overrides }),
  };
}

test('短句先問範圍，「以後」保存時段、保留既有時段並直接重排', async () => {
  const f = chatFixture('SCOPE-SAVED', { blockedPeriods: [{ day: 2, period: 3 }] });
  assert.match((await f.chat('週三下午要打工')).reply, /這次.*以後/);
  assert.equal(f.writes(), 0);
  assert.equal(f.requests.length, 0);
  const saved = await f.chat('以後');
  assert.equal(saved.preferencesUpdated, true);
  assert.deepEqual(f.prefs().blockedPeriods, [{ day: 2, period: 3 },
    ...[6, 7, 8, 9, 10].map(period => ({ day: 3, period }))]);
  // 2026-11-27 使用者決定：講完條件就直接重排，不再問「要重排嗎」。
  assert.equal(saved.intent, 'run_csp_scheduler');
  assert.equal(f.requests.length, 1);
  assert.equal(f.writes(), 1);
  assert.match((await f.chat('以後')).reply, /沒有待確認/);
});

test('短句已要求重排，「這次」續接原條件並保留手動加選', async () => {
  const f = chatFixture('SCOPE-TEMPORARY');
  assert.match((await f.chat('週三下午不排，幫我重排')).reply, /這次.*以後/);
  assert.equal(f.requests.length, 0);
  const reply = await f.chat('這次');
  assert.equal(reply.intent, 'run_csp_scheduler');
  assert.equal(f.writes(), 0);
  assert.deepEqual(f.requests.map(request => request.constraints.selectedCourseIds), [[777]]);
  assert.deepEqual(f.requests[0].constraints.blockedPeriods, [6, 7, 8, 9, 10].map(period => ({ day: 3, period })));
  assert.equal(readTemporaryPreference(f.account, f.prefs()), null);
});

test('明說這次就直接用單次條件重排，不必再說「幫我重排」', async () => {
  const f = chatFixture('SCOPE-NEXT');
  assert.equal((await f.chat('這次週三下午不排')).intent, 'run_csp_scheduler');
  assert.equal(f.requests.length, 1);
  assert.equal(f.writes(), 0);
  assert.deepEqual(f.requests[0].constraints.blockedPeriods, [6, 7, 8, 9, 10].map(period => ({ day: 3, period })));
});

test('明說先不要排時，只暫存條件不重排', async () => {
  const f = chatFixture('SCOPE-HOLD');
  assert.match((await f.chat('這次週三下午不排，先不要排課')).reply, /暫存/);
  assert.equal(f.requests.length, 0);
  assert.equal((await f.chat('幫我重排')).intent, 'run_csp_scheduler');
  assert.equal(f.requests.length, 1);
  assert.equal(readTemporaryPreference(f.account, f.prefs()), null);
});

test('手動加選與封鎖時段衝突時，課表未重排且單次條件保留', async () => {
  const f = chatFixture('SCOPE-PIN-CONFLICT');
  const result = await f.chat('這次週二下午不排，幫我重排');
  assert.match(result.reply, /手動加選.*不能上課時段/);
  assert.equal(f.requests.length, 0);
  assert.ok(readTemporaryPreference(f.account, f.prefs()));
});

test('模型同時提出偏好和重排，條件範圍不明時由伺服器先追問', async () => {
  const f = chatFixture('SCOPE-NATURAL');
  const aiClient = { responses: { create: async () => ({
    output: [
      { type: 'function_call', name: 'run_csp_scheduler', arguments: '{}' },
      { type: 'function_call', name: 'update_preferences', arguments: '{"check":["lunchBreakFree"]}' },
    ],
  }) } };
  assert.match((await f.chat('中午要留給我吃飯，幫我排課', { aiClient })).reply, /這次.*以後/);
  assert.equal(f.writes(), 0);
  assert.equal(f.requests.length, 0);
  const result = await f.chat('以後');
  assert.equal(result.preferencesUpdated, true);
  assert.equal(f.requests.length, 1);
  assert.ok(f.prefs().selectedTags.includes('#午休務必空出'));
});
