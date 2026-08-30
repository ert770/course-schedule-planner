// AI Agent 工具派送的契約測試。
//
// 這段程式決定了模型能對這位使用者的資料做什麼，先前卻完全沒有測試覆蓋——
// 它卡在一個需要真的呼叫外部模型的對話迴圈中間，測不到。改用原生 tool calling
// 時把它抽成 `executeAgentTool()` 並開了注入接縫，這份測試才有辦法存在。

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { executeAgentTool, summarizeScheduleForModel } from '../src/services/agentService.js';

const identity = { canonicalId: 'S1130001' };
const ctx = { identity, prefs: {}, studentScope: { department: '資訊工程系' } };

describe('AG1 未知工具與工具錯誤不得中斷對話', () => {
  test('不明的工具名稱回傳 error 物件，不丟例外', async () => {
    const result = await executeAgentTool('drop_all_tables', {}, ctx);

    assert.match(result.error, /不明的函數呼叫/);
  });

  // 一個工具壞掉應該讓模型知道並改用別的方法，而不是整段對話中止。
  test('工具丟出例外時包成 error 回傳，不往外拋', async () => {
    const result = await executeAgentTool('get_easy_courses', {}, ctx, {
      easyCourses: () => { throw new Error('資料庫連線中斷'); },
    });

    assert.match(result.error, /執行工具發生錯誤: 資料庫連線中斷/);
  });
});

describe('AG2 run_csp_scheduler 的曝光來源由伺服器決定', () => {
  // 「這次推薦顯示在哪個畫面、被什麼觸發」是系統事實，不是模型可以宣稱的東西。
  // 允許模型覆蓋，等於讓它把 chat 的推薦記成前端畫面上的曝光。
  test('模型帶進來的 surface／trigger 不得覆蓋伺服器寫死的值', async () => {
    let received;
    await executeAgentTool(
      'run_csp_scheduler',
      { maxCredits: 20, surface: 'schedule_page', trigger: 'user_click' },
      ctx,
      { generateSchedule: (_id, input) => { received = input; return { success: true }; } }
    );

    assert.equal(received.surface, 'chat');
    assert.equal(received.trigger, 'chat_tool');
    // 模型送的排課條件本身照樣傳下去。
    assert.equal(received.constraints.maxCredits, 20);
  });

  test('已載入的 prefs 直接傳下去，同一次對話不重複查詢 profile', async () => {
    const prefs = { targetCreditsMax: 22 };
    let options;
    await executeAgentTool('run_csp_scheduler', {}, { ...ctx, prefs }, {
      generateSchedule: (_id, _input, opts) => { options = opts; return { success: true }; },
    });

    assert.equal(options.prefs, prefs);
  });
});

describe('AG3 課程查詢結果長度上限', () => {
  test('超過 10 筆時只回前 10 筆', async () => {
    const many = Array.from({ length: 25 }, (_, i) => ({ id: i + 1, name: `課程${i + 1}` }));
    const result = await executeAgentTool('query_course_db', { keyword: '課' }, ctx, {
      searchCourses: () => many,
    });

    assert.equal(result.length, 10);
    assert.equal(result[0].id, 1);
  });

  test('未超過上限時原樣回傳', async () => {
    const few = [{ id: 1, name: '計算機概論' }];
    const result = await executeAgentTool('query_course_db', {}, ctx, { searchCourses: () => few });

    assert.deepEqual(result, few);
  });

  test('查詢帶入伺服器算出的 studentScope，不由模型提供', async () => {
    let scope;
    await executeAgentTool('query_course_db', { keyword: '網路' }, ctx, {
      searchCourses: (_args, s) => { scope = s; return []; },
    });

    assert.equal(scope, ctx.studentScope);
  });
});

describe('AG4 評價查詢', () => {
  test('找不到課程時回傳 error，不得自行補一個評價', async () => {
    const result = await executeAgentTool('search_dcard_reviews', { keyword: '不存在' }, ctx, {
      searchCourses: () => [],
    });

    assert.deepEqual(result, { error: '找不到該課程的評價' });
  });

  test('找到課程時附上課程名稱，方便模型指名回覆', async () => {
    const result = await executeAgentTool('search_dcard_reviews', { keyword: '演算法' }, ctx, {
      searchCourses: () => [{ id: 7, name: '演算法' }],
      sentimentSummary: id => ({ courseId: id, positive: 3 }),
    });

    assert.deepEqual(result, { courseId: 7, positive: 3, courseName: '演算法' });
  });
});

describe('AG5 update_preferences 同步更新這次對話的 prefs', () => {
  // 不同步的話，同一次對話裡「存好偏好後再排課」會用到舊值，
  // 模型會以為存了卻沒生效。
  test('寫入後端之後也更新記憶體中的 prefs', async () => {
    const prefs = { noMorningClasses: false };
    const result = await executeAgentTool('update_preferences', { noMorningClasses: true }, { ...ctx, prefs }, {
      updatePreferences: async () => {},
    });

    assert.equal(prefs.noMorningClasses, true);
    assert.equal(result.success, true);
    assert.deepEqual(result.updatedFields, { noMorningClasses: true });
  });
});

describe('AG6 排課結果送進模型前要投影', () => {
  // 完整排課結果實測 838KB（excludedCourses 200+ 門完整課程物件，plans 每個方案
  // 又各帶一份完整課表）。原樣餵回模型，第二次排課就會 400 context window。
  function bigResult() {
    const course = n => ({
      id: n, sectionId: n, catalogCourseCode: `IECS${1000 + n}`, name: `課程${n}`,
      teacher: '某老師', credits: 3, timeStr: '一 03-04', category: '選修',
      eligibility: 'eligible', eligibilityReason: null, countsTowardGraduation: true,
      reviewEvidence: null,
      // 以下這些不該被送進模型
      syllabus: 'x'.repeat(2000), description: 'y'.repeat(2000), timeBitmask: 12345,
    });
    return {
      success: true, requestId: 'req-1', totalCredits: 9, courseCount: 3,
      hasExpressedPreference: true, reviewDataLoaded: false, isDraft: false,
      schedule: [course(1), course(2), course(3)],
      plans: [{
        planId: 'req-1:interest', variantId: 'interest', title: '興趣優先',
        preferenceScore: 0.26, reviewCoverage: { rated: 1, total: 8, ratio: 0.125 },
        schedule: [course(1), course(2), course(3)],
      }],
      excludedCourses: Array.from({ length: 200 }, (_, i) => ({
        course: course(100 + i), reason: '衝堂', constraintId: 'c1',
      })),
      solver: { status: 'solved' },
      clarification: { required: false },
      warnings: ['訊號極弱'],
    };
  }

  test('大幅縮小送進模型的體積', () => {
    const full = bigResult();
    const compact = summarizeScheduleForModel(full);

    assert.ok(
      JSON.stringify(compact).length < JSON.stringify(full).length / 10,
      '投影後應小於原本的十分之一'
    );
  });

  test('保留 system prompt 明文引用的欄位', () => {
    const compact = summarizeScheduleForModel(bigResult());

    assert.equal(compact.requestId, 'req-1');
    assert.equal(compact.solver.status, 'solved');
    assert.equal(compact.clarification.required, false);
    assert.equal(compact.hasExpressedPreference, true);
    assert.equal(compact.reviewDataLoaded, false);
    assert.equal(compact.plans[0].preferenceScore, 0.26);
    assert.deepEqual(compact.plans[0].reviewCoverage, { rated: 1, total: 8, ratio: 0.125 });
    assert.deepEqual(compact.warnings, ['訊號極弱']);
  });

  // 沒有 sectionId 就沒有 record_schedule_feedback。
  test('課程保留 sectionId 與課名，丟掉 syllabus 之類的長欄位', () => {
    const compact = summarizeScheduleForModel(bigResult());
    const [first] = compact.schedule;

    assert.equal(first.sectionId, 1);
    assert.equal(first.name, '課程1');
    assert.equal(first.catalogCourseCode, 'IECS1001');
    assert.ok(!('syllabus' in first));
    assert.ok(!('description' in first));
  });

  test('excludedCourses 只給總數與樣本，不整包送', () => {
    const compact = summarizeScheduleForModel(bigResult());

    assert.equal(compact.excludedCourseCount, 200);
    assert.equal(compact.excludedCoursesSample.length, 15);
    assert.equal(compact.excludedCoursesSample[0].reason, '衝堂');
    assert.ok(!('excludedCourses' in compact), '不得再帶完整清單');
  });

  test('方案不重複攜帶各自的完整課表', () => {
    const compact = summarizeScheduleForModel(bigResult());

    assert.ok(!('schedule' in compact.plans[0]));
  });
});
