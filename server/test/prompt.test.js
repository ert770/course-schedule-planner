// docs/TEST_PLAN.md「AI Agent 契約測試」P1-P3。
//
// agentService 曾新增排課參數卻沒有同步 promptService，
// 模型不知道那些參數存在，/api/chat 路徑的個人化因此完全未生效。
//
// 改用 OpenAI 原生 tool calling 之後，「模型知道哪些參數」的真相從 prompt 字串
// 搬到了 `getAgentTools()` 的 JSON Schema，因此參數與 enum 類的斷言改成對 schema
// 檢查；行為規範（要問使用者是否符合需求、不得代答）仍然只存在於 prompt。

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { buildSystemPrompt, getAgentTools } from '../src/services/promptService.js';

// 與 server/src/services/constraintService.js 接受的欄位保持一致。
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
  // Roadmap #24：接通既有放寬階梯 + 這次不可放寬的指名。
  'allowRelaxation', 'nonNegotiablePreferenceIds',
];

const tools = getAgentTools();
// Responses API 的工具是扁平的 { type, name, description, parameters }。
const toolByName = new Map(tools.map(tool => [tool.name, tool]));

describe('P1 tool schema 含所有排課參數', () => {
  const scheduler = toolByName.get('run_csp_scheduler');

  test('run_csp_scheduler 工具存在', () => {
    assert.ok(scheduler, '缺少 run_csp_scheduler 工具');
  });

  for (const param of SCHEDULER_PARAMS) {
    test(`列出 ${param}`, () => {
      assert.ok(
        Object.hasOwn(scheduler.parameters.properties, param),
        `run_csp_scheduler schema 缺少參數 ${param}`
      );
    });
  }

  test('列出所有可用工具', () => {
    for (const name of [
      'query_course_db',
      'search_dcard_reviews',
      'get_easy_courses',
      'run_csp_scheduler',
      'update_preferences',
      'update_student_profile',
      'record_schedule_feedback',
    ]) {
      assert.ok(toolByName.has(name), `缺少工具 ${name}`);
    }
  });

  // 原生 tool calling 的終止條件是「模型回一則沒有 tool_calls 的訊息」。
  // 留著 final_answer 會讓模型多繞一步，也和 API 的語意打架。
  test('不再有 final_answer 工具', () => {
    assert.ok(!toolByName.has('final_answer'), 'final_answer 應由純文字回覆取代');
  });

  test('每個工具都是合法的 OpenAI function tool', () => {
    for (const tool of tools) {
      assert.equal(tool.type, 'function');
      assert.equal(typeof tool.name, 'string');
      assert.ok(tool.description, `${tool.name} 缺少 description`);
      assert.equal(tool.parameters.type, 'object');
      assert.ok(!('function' in tool), 'Responses API 的工具不再包一層 function');
    }
  });

  // roadmap #2：排課只是推薦，使用者是否覺得符合需求才是「最終選擇」。
  // 沒有問，系統就無從得知這份推薦好不好，#30 也就少了最關鍵的一個訊號。
  test('要求排課後必須確認課表是否符合需求', () => {
    const prompt = buildSystemPrompt({});

    assert.ok(prompt.includes('排課後的確認'), 'system prompt 缺少排課後確認章節');
    assert.ok(prompt.includes('是否符合需求'), 'system prompt 未要求詢問是否符合需求');
    assert.ok(
      prompt.includes('不得自行假設他接受了這份課表'),
      'system prompt 未禁止代替使用者回答'
    );
  });

  // 這條規則以前只是 prompt 裡的一句叮嚀，模型可以照樣填「太難」；
  // 現在由 schema 的 enum 在 API 層擋下。
  test('移除原因只接受七個 enum，不收自由文字', () => {
    const feedback = toolByName.get('record_schedule_feedback');
    const reason = feedback.parameters.properties.rejectedCourses.items.properties.reason;

    assert.deepEqual(
      [...reason.enum].sort(),
      ['content', 'eligibility', 'full', 'instructor', 'other', 'time', 'workload']
    );
  });

  test('record_schedule_feedback 必須帶 requestId', () => {
    const feedback = toolByName.get('record_schedule_feedback');
    assert.ok(feedback.parameters.required.includes('requestId'));
  });

  test('不向模型暴露修課歷史或已修課號參數', () => {
    // prompt 與 tool schema 兩邊都要檢查——參數搬到 schema 之後，只查 prompt
    // 會漏掉真正的入口。
    const surface = buildSystemPrompt({}) + JSON.stringify(tools);

    assert.ok(!surface.includes('completedCourseIds'));
    assert.ok(!surface.includes('courseHistory'));
    assert.ok(!surface.includes('retakeCourseIds'), '重補修只能由 courseHistory 自動推導');
    assert.ok(!surface.includes('failedRequiredCourseIds'));
    assert.ok(!surface.includes('courseReviews'), '評價由伺服器查詢，不可由模型提供');
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
    const surface = buildSystemPrompt({}) + JSON.stringify(tools);

    assert.ok(surface.includes('eligibility'));
    assert.ok(surface.includes('資格待確認'));
    assert.ok(surface.includes('不得宣稱使用者確定可修'));
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

describe('P4 Roadmap #24：永久寫入的兩段式確認', () => {
  test('update_preferences 與 update_student_profile 都收 confirmationToken', () => {
    for (const name of ['update_preferences', 'update_student_profile']) {
      assert.ok(
        Object.hasOwn(toolByName.get(name).parameters.properties, 'confirmationToken'),
        `${name} 缺少 confirmationToken`
      );
    }
  });

  test('update_student_profile 開放系所、年級與班別三個欄位', () => {
    const props = toolByName.get('update_student_profile').parameters.properties;

    for (const field of ['department', 'gradeLevel', 'className']) {
      assert.ok(Object.hasOwn(props, field), `缺少 ${field}`);
    }
  });

  // 這三個欄位是身分事實，不是排課偏好——不該混進 update_preferences。
  test('update_preferences 不得同時開放系所年級班別', () => {
    const props = toolByName.get('update_preferences').parameters.properties;

    for (const field of ['department', 'gradeLevel', 'className']) {
      assert.ok(!Object.hasOwn(props, field), `${field} 不該出現在 update_preferences`);
    }
  });

  test('system prompt 說明兩段式流程且禁止自行編造 token', () => {
    const prompt = buildSystemPrompt({});

    assert.ok(prompt.includes('confirmationToken'));
    assert.ok(prompt.includes('兩段式'));
    assert.ok(prompt.includes('不得自行編造 token'));
  });
});

describe('P5 Roadmap #24：偏好強度的判讀', () => {
  test('nonNegotiablePreferenceIds 只接受三個可放寬的偏好', () => {
    const scheduler = toolByName.get('run_csp_scheduler');
    const { enum: allowed } = scheduler.parameters.properties.nonNegotiablePreferenceIds.items;

    assert.deepEqual(
      [...allowed].sort(),
      ['LUNCH_BREAK_FREE', 'NO_EVENING_CLASSES', 'NO_MORNING_CLASSES']
    );
  });

  test('system prompt 教模型分辨語氣強弱', () => {
    const prompt = buildSystemPrompt({});

    assert.ok(prompt.includes('allowRelaxation'));
    assert.ok(prompt.includes('nonNegotiablePreferenceIds'));
    assert.ok(prompt.includes('絕對不要'), 'prompt 需給出強硬語氣的例子');
    assert.ok(prompt.includes('盡量不要'), 'prompt 需給出彈性語氣的例子');
  });
});

describe('P6 Roadmap #24：結構化理解回講', () => {
  const scheduler = toolByName.get('run_csp_scheduler');

  // 原生 tool calling 保證得了參數格式，保證不了理解正確——模型把「盡量」
  // 聽成「絕對」，參數一樣合法，使用者卻拿到不對的課表。
  test('interpretation 是 run_csp_scheduler 的必填參數', () => {
    assert.ok(scheduler.parameters.required.includes('interpretation'));
  });

  test('四個必填子欄位齊全', () => {
    const { interpretation } = scheduler.parameters.properties;

    for (const field of ['nonNegotiable', 'flexible', 'creditGoal', 'notMentioned']) {
      assert.ok(interpretation.required.includes(field), `缺少必填欄位 ${field}`);
      assert.ok(Object.hasOwn(interpretation.properties, field), `缺少欄位定義 ${field}`);
    }
  });

  test('sourcePhrases 存在但非必填（沒有直接對應時可省略）', () => {
    const { interpretation } = scheduler.parameters.properties;

    assert.ok(Object.hasOwn(interpretation.properties, 'sourcePhrases'));
    assert.ok(!interpretation.required.includes('sourcePhrases'));
  });

  test('system prompt 要求排課前先回講，且不得自行假設', () => {
    const prompt = buildSystemPrompt({});

    assert.ok(prompt.includes('理解回講'));
    assert.ok(prompt.includes('interpretation'));
    assert.ok(prompt.includes('notMentioned'));
    assert.ok(prompt.includes('不要在那裡自行假設答案'));
  });
});

describe('P7 Roadmap #25：工具結果信封說明', () => {
  test('system prompt 說明信封的五個欄位與 result 才是實際內容', () => {
    const prompt = buildSystemPrompt({});

    for (const field of ['schemaVersion', 'dataSource', 'term', 'warnings', 'errorCode', 'result']) {
      assert.ok(prompt.includes(field), `system prompt 未提到信封欄位 ${field}`);
    }
  });

  test('system prompt 說明 json-fallback 是暫時性限制，不是資料不存在', () => {
    const prompt = buildSystemPrompt({});

    assert.ok(prompt.includes('json-fallback'));
    assert.ok(prompt.includes('暫時性限制'));
  });

  test('system prompt 說明 errorCode 不為 null 時不得宣稱已完成', () => {
    const prompt = buildSystemPrompt({});

    assert.ok(prompt.includes('errorCode'));
    assert.ok(prompt.includes('不要宣稱已完成'));
  });
});
