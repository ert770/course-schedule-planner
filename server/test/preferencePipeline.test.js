import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalizeProfile } from '../src/data/profileSchema.js';
import { TAG_TO_FLAG } from '../src/data/preferenceTags.js';
import { executeAgentTool, handleChat } from '../src/services/agentService.js';
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
