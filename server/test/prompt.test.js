// docs/TEST_PLAN.md「AI Agent 契約測試」P1-P3。
//
// agentService 曾新增排課參數卻沒有同步 promptService，
// 模型不知道那些參數存在，/api/chat 路徑的個人化因此完全未生效。

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { buildSystemPrompt } from '../src/services/promptService.js';

// 與 server/src/services/agentService.js 的 run_csp_scheduler 參數保持一致。
// 新增參數時必須同時更新 promptService 與這份清單，否則本測試會失敗。
const SCHEDULER_PARAMS = [
  'minCredits', 'maxCredits', 'maxCoursesPerDay',
  'blockedPeriods', 'mondayFree', 'noMorningClasses', 'noEveningClasses', 'lunchBreakFree',
  'mustTakeCourseIds',
  'selectedCourseIds', 'watchingCourseIds', 'courseStates',
  'noMidterm', 'noGroupReport', 'discussion', 'learnMore',
  'weightDaily', 'practicalExam', 'finalReport', 'englishTaught',
  'preferCompact', 'preferEasyCourses', 'preferredKeywords', 'interests', 'preferredTrack',
  'digitalCreditsNeeded',
];

describe('P1 system prompt 含所有排課參數', () => {
  const prompt = buildSystemPrompt({});

  for (const param of SCHEDULER_PARAMS) {
    test(`列出 ${param}`, () => {
      assert.ok(prompt.includes(param), `system prompt 缺少參數 ${param}`);
    });
  }

  test('列出所有可用工具', () => {
    for (const tool of [
      'query_course_db',
      'search_dcard_reviews',
      'get_easy_courses',
      'run_csp_scheduler',
      'update_preferences',
      'record_schedule_feedback',
      'final_answer',
    ]) {
      assert.ok(prompt.includes(tool), `system prompt 缺少工具 ${tool}`);
    }
  });

  // roadmap #2：排課只是推薦，使用者是否覺得符合需求才是「最終選擇」。
  // 沒有問，系統就無從得知這份推薦好不好，#30 也就少了最關鍵的一個訊號。
  test('要求排課後必須確認課表是否符合需求', () => {
    assert.ok(prompt.includes('排課後的確認'), 'system prompt 缺少排課後確認章節');
    assert.ok(prompt.includes('是否符合需求'), 'system prompt 未要求詢問是否符合需求');
    assert.ok(
      prompt.includes('不得自行假設他接受了這份課表'),
      'system prompt 未禁止代替使用者回答'
    );
  });

  test('移除原因只接受七個 enum，不收自由文字', () => {
    for (const reason of ['time', 'content', 'instructor', 'workload', 'full', 'eligibility', 'other']) {
      assert.ok(prompt.includes(reason), `system prompt 缺少回饋原因 ${reason}`);
    }
  });

  test('不向模型暴露修課歷史或已修課號參數', () => {
    assert.ok(!prompt.includes('completedCourseIds'));
    assert.ok(!prompt.includes('courseHistory'));
    assert.ok(!prompt.includes('retakeCourseIds'), '重補修只能由 courseHistory 自動推導');
    assert.ok(!prompt.includes('failedRequiredCourseIds'));
  });
});

describe('P2 偏好摘要反映已儲存偏好', () => {
  test('列出已儲存的興趣關鍵字', () => {
    const prompt = buildSystemPrompt({
      preferredKeywords: ['網路'],
      preferenceTags: ['資安'],
    });

    assert.match(prompt, /網路、資安/);
  });

  test('列出修課路徑與涼課偏好', () => {
    const prompt = buildSystemPrompt({
      preferredTrack: '網路安全類',
      preferEasyCourses: true,
    });

    assert.ok(prompt.includes('網路安全類'));
    assert.match(prompt, /偏好涼課：是/);
  });

  test('沒有偏好時顯示未設定而非 undefined', () => {
    const prompt = buildSystemPrompt({});

    assert.ok(!prompt.includes('undefined'), 'prompt 不應出現 undefined');
    assert.ok(prompt.includes('未設定'));
  });
});

describe('P3 排課結果欄位有告知模型', () => {
  test('說明 preferenceScore 與 hasExpressedPreference 的用途', () => {
    const prompt = buildSystemPrompt({});

    assert.ok(prompt.includes('preferenceScore'));
    assert.ok(prompt.includes('hasExpressedPreference'));
  });

  test('資格 unknown 必須說成資格待確認，不能宣稱可修', () => {
    const prompt = buildSystemPrompt({});

    assert.ok(prompt.includes('eligibility'));
    assert.ok(prompt.includes('資格待確認'));
    assert.ok(prompt.includes('不得宣稱使用者確定可修'));
  });

  test('Roadmap #22：clarification.required 時必須依證據追問，草稿不得冒充成功', () => {
    const prompt = buildSystemPrompt({});

    for (const field of [
      'solver.status', 'clarification.required', 'clarification.questions',
      'unmetRequirements', 'conflictSet', 'draftSchedule', 'adjustableConstraintIds',
    ]) {
      assert.ok(prompt.includes(field), `system prompt 缺少 #22 回應欄位 ${field}`);
    }
    assert.ok(prompt.includes('timeout 不等於無解'));
    assert.ok(prompt.includes('不能稱為成功或合法完成的課表'));
    assert.ok(prompt.includes('不得自行發明衝突'));
  });
});
