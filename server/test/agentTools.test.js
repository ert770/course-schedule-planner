// AI Agent 工具派送的契約測試。
//
// 這段程式決定了模型能對這位使用者的資料做什麼，先前卻完全沒有測試覆蓋——
// 它卡在一個需要真的呼叫外部模型的對話迴圈中間，測不到。改用原生 tool calling
// 時把它抽成 `executeAgentTool()` 並開了注入接縫，這份測試才有辦法存在。

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  applyToolOutcome,
  buildToolResultEnvelope,
  executeAgentTool,
  resolveMaxSteps,
  summarizeScheduleForModel,
  dropUnchangedProfileFields,
  normalizeCourseQueryArgs,
  rankByEligibility,
  expandPreferenceChecklist,
} from '../src/services/agentService.js';

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
  // Roadmap #24 之後 chat 這條路一定要附上理解回講，否則會被 preflight 擋下。
  const interpretation = {
    nonNegotiable: [], flexible: [], creditGoal: { min: null, max: null }, notMentioned: [],
  };

  // 「這次推薦顯示在哪個畫面、被什麼觸發」是系統事實，不是模型可以宣稱的東西。
  // 允許模型覆蓋，等於讓它把 chat 的推薦記成前端畫面上的曝光。
  test('模型帶進來的 surface／trigger 不得覆蓋伺服器寫死的值', async () => {
    let received;
    await executeAgentTool(
      'run_csp_scheduler',
      { maxCredits: 20, surface: 'schedule_page', trigger: 'user_click', interpretation },
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
    await executeAgentTool('run_csp_scheduler', { interpretation }, { ...ctx, prefs }, {
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

    assert.deepEqual(result, { error: '找不到該課程的評價', errorCode: 'REVIEWS_NOT_FOUND' });
  });

  test('找到課程時附上課程名稱，方便模型指名回覆', async () => {
    const result = await executeAgentTool('search_dcard_reviews', { keyword: '演算法' }, ctx, {
      searchCourses: () => [{ id: 7, name: '演算法' }],
      sentimentSummary: id => ({ courseId: id, positive: 3 }),
    });

    assert.deepEqual(result, { courseId: 7, positive: 3, courseName: '演算法' });
  });
});

describe('AG5 update_preferences 直接寫入，並同步這次對話的 prefs（ADR-036）', () => {
  // 不同步的話，同一次對話裡「存好偏好後再排課」會用到舊值，
  // 模型會以為存了卻沒生效。
  test('一次呼叫就寫入後端並更新記憶體中的 prefs', async () => {
    const prefs = { noMorningClasses: false };
    let written = null;
    const result = await executeAgentTool(
      'update_preferences', { noMorningClasses: true }, { ...ctx, prefs },
      { updatePreferences: async (_id, payload) => { written = payload; } }
    );

    assert.equal(prefs.noMorningClasses, true);
    assert.equal(result.success, true);
    assert.deepEqual(result.updatedFields, { noMorningClasses: true });
    assert.deepEqual(written.preferenceTags, ['#不排早八']);
  });

  test('星期一排空寫成 #星期一排空，且保留使用者沒提到的偏好', async () => {
    const prefs = { preferenceTags: ['#不排早八', '#涼課優先'] };
    let written = null;
    const result = await executeAgentTool(
      'update_preferences', { mondayFree: true }, { ...ctx, prefs },
      { updatePreferences: async (_id, payload) => { written = payload; } }
    );

    assert.equal(result.success, true);
    assert.deepEqual([...written.preferenceTags].sort(), ['#不排早八', '#星期一排空', '#涼課優先'].sort());
    assert.deepEqual([...result.preferenceTags].sort(), [...written.preferenceTags].sort());
    assert.equal(prefs.mondayFree, true);
  });

  test('check／uncheck 清單只改列出的項目，其他偏好保留', async () => {
    const prefs = { preferenceTags: ['#不排早八', '#涼課優先', '#星期一排空'] };
    let written = null;
    const result = await executeAgentTool(
      'update_preferences', { check: ['lunchBreakFree'], uncheck: ['mondayFree'] }, { ...ctx, prefs },
      { updatePreferences: async (_id, payload) => { written = payload; } }
    );
    assert.deepEqual(result.updatedFields, { lunchBreakFree: true, mondayFree: false });
    assert.deepEqual([...written.preferenceTags].sort(), ['#不排早八', '#午休務必空出', '#涼課優先'].sort());
  });

  test('同一項同時要勾又要取消時不改、未知項目忽略', () => {
    assert.deepEqual(
      expandPreferenceChecklist({ check: ['mondayFree', 'notAFlag'], uncheck: ['mondayFree'], targetCreditsMax: 20 }),
      { targetCreditsMax: 20 }
    );
  });

  test('模型抄回來的現值與空的 blockedPeriods 不寫入，不會清掉已存的不能上課時段', async () => {
    const prefs = {
      preferenceTags: ['#不排早八'], targetCreditsMax: 25, preferredTrack: '技術應用類',
      blockedPeriods: [{ day: 5, period: 3 }],
    };
    let written = null;
    const result = await executeAgentTool(
      'update_preferences',
      { check: ['mondayFree'], uncheck: [], targetCreditsMax: 25, blockedPeriods: [], preferredTrack: '技術應用類' },
      { ...ctx, prefs },
      { updatePreferences: async (_id, payload) => { written = payload; } }
    );
    assert.deepEqual(result.updatedFields, { mondayFree: true });
    assert.equal(Object.hasOwn(written, 'blockedPeriods'), false);
    assert.equal(Object.hasOwn(written, 'targetCreditsMax'), false);
    assert.deepEqual(prefs.blockedPeriods, [{ day: 5, period: 3 }]);
  });

  test('全部都是現值時回 noChange、不寫入', async () => {
    let called = false;
    const result = await executeAgentTool(
      'update_preferences', { targetCreditsMax: 25 }, { ...ctx, prefs: { targetCreditsMax: 25 } },
      { updatePreferences: async () => { called = true; } }
    );
    assert.equal(result.noChange, true);
    assert.equal(called, false);
  });

  test('沒有要改的欄位時回 error、不寫入', async () => {
    let called = false;
    const result = await executeAgentTool(
      'update_preferences', {}, { ...ctx, prefs: {} },
      { updatePreferences: async () => { called = true; } }
    );
    assert.equal(result.errorCode, 'NOTHING_TO_CHANGE');
    assert.equal(called, false);
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
      graduationPlanning: {
        enabled: true,
        remainingSemesters: 1,
        gaps: { elective: 6, general: 4, external: 0 },
        semesterTargets: { elective: 6, general: 4, external: 0 },
      },
      schedule: [course(1), course(2), course(3)],
      plans: [{
        planId: 'req-1:interest', variantId: 'interest', title: '興趣優先',
        preferenceScore: 0.26, reviewCoverage: { rated: 1, total: 8, ratio: 0.125 },
        graduationPlanning: {
          enabled: true,
          selected: { elective: { courses: 2, credits: 6 }, general: { courses: 2, credits: 4 } },
        },
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
    assert.equal(compact.graduationPlanning.remainingSemesters, 1);
    assert.equal(compact.plans[0].preferenceScore, 0.26);
    assert.equal(compact.plans[0].graduationPlanning.selected.general.courses, 2);
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

  // roadmap #26：模型先前完全看不到課為何被推薦，只能講空泛的話——
  // 而講空泛的話最容易變成編造。
  test('AG6 課程帶著推薦理由送進模型', () => {
    const result = bigResult();
    result.schedule[0].recommendationReason = {
      selectedBecause: 'PREFERENCE_MATCH',
      matchedPreferences: [{ type: 'content', preferenceId: 'practicalExam', label: '實作評量', score: 40 }],
      easinessSource: 'proxy',
      confidence: 'medium',
      dataSources: ['Course_Sections'],
      constraintTradeoffs: [],
      scoreBreakdown: [{ component: 'base', value: 1000 }],
      alternativesRejected: {
        status: 'had-competitors',
        candidates: [{ sectionId: 9, name: '對手課', scoreDelta: 40, notScheduledBecause: '衝堂' }],
      },
    };

    const [first] = summarizeScheduleForModel(result).schedule;

    assert.equal(first.recommendationReason.selectedBecause, 'PREFERENCE_MATCH');
    assert.deepEqual(first.recommendationReason.matchedPreferences, ['實作評量']);
    assert.equal(first.recommendationReason.easinessSource, 'proxy');
    assert.equal(first.recommendationReason.alternativesRejected.status, 'had-competitors');
    assert.equal(first.recommendationReason.alternativesRejected.candidates[0].name, '對手課');
  });

  // 分數是內部排序用的，對使用者講「這門課得了 956 分」沒有意義，
  // 而且會把 input 撐大——那正是這個投影函式存在的原因。
  test('AG6 理由的分數組成不送進模型', () => {
    const result = bigResult();
    result.schedule[0].recommendationReason = {
      selectedBecause: 'PREFERENCE_MATCH', matchedPreferences: [],
      scoreBreakdown: [{ component: 'base', value: 1000 }], scoreTotal: 1000,
      alternativesRejected: { status: 'no-competitors', candidates: [] },
    };

    const [first] = summarizeScheduleForModel(result).schedule;

    assert.ok(!('scoreBreakdown' in first.recommendationReason));
    assert.ok(!('scoreTotal' in first.recommendationReason));
  });

  test('AG6 沒有理由的課不會憑空生出一個', () => {
    const [first] = summarizeScheduleForModel(bigResult()).schedule;

    assert.equal(first.recommendationReason, null);
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

describe('AG7 intent 與 data 只反映真正成功的工具', () => {
  const start = { intent: 'general_chat', data: null };

  // 這是實際踩到的情境：模型呼叫了 record_schedule_feedback，但 sectionId 不在
  // 那次推薦顯示過的課表裡，後端拒絕。回應若照樣說 intent 是它，就是在謊報
  // 「已經記錄了」——資料庫裡其實一筆都沒有。
  test('工具被拒時 intent 與 data 都不變', () => {
    const rejected = { error: '班次 999 不在該次推薦實際顯示的課表中，不能記為退選。' };
    const after = applyToolOutcome(start, 'record_schedule_feedback', rejected);

    assert.deepEqual(after, start);
  });

  test('可渲染的工具失敗時，data 不會被塞進錯誤物件', () => {
    const scheduled = { intent: 'run_csp_scheduler', data: { success: true, requestId: 'r-1' } };
    const after = applyToolOutcome(scheduled, 'query_course_db', { error: '資料庫連線中斷' });

    assert.equal(after.data.success, true, '既有的課表不該被錯誤物件蓋掉');
    assert.equal(after.intent, 'run_csp_scheduler');
  });

  test('run_csp_scheduler 成功時同時更新 intent 與 data', () => {
    const result = { success: true, requestId: 'r-1' };
    const after = applyToolOutcome(start, 'run_csp_scheduler', result);

    assert.equal(after.intent, 'run_csp_scheduler');
    assert.equal(after.data, result);
  });

  // record_schedule_feedback／update_preferences 只是確認訊息；讓它們覆蓋 data
  // 會把畫面上已經顯示的課表洗掉。
  test('非渲染型工具成功時更新 intent 但不覆寫 data', () => {
    const scheduled = { intent: 'run_csp_scheduler', data: { success: true, requestId: 'r-1' } };
    const after = applyToolOutcome(scheduled, 'record_schedule_feedback', { success: true, recorded: 1 });

    assert.equal(after.intent, 'record_schedule_feedback');
    assert.deepEqual(after.data, { success: true, requestId: 'r-1' });
  });

  test('工具名稱缺漏時沿用既有 intent，不寫入 undefined', () => {
    const after = applyToolOutcome(start, undefined, { ok: true });

    assert.equal(after.intent, 'general_chat');
  });
});

describe('AG8 思考步數上限', () => {
  test('未設定時使用預設 12', () => {
    assert.equal(resolveMaxSteps(undefined), 12);
  });

  test('合法設定值照用', () => {
    assert.equal(resolveMaxSteps('16'), 16);
  });

  // 每一步都是一次模型往返，input 還會持續累積。設定值寫錯不該變成失控的請求。
  test('超過天花板被夾到 20', () => {
    assert.equal(resolveMaxSteps('1000'), 20);
  });

  test('垃圾值退回預設而不是 NaN', () => {
    for (const raw of ['abc', '', '0', '-3', null]) {
      assert.equal(resolveMaxSteps(raw), 12, `${JSON.stringify(raw)} 應退回預設`);
    }
  });
});

describe('AG14 查無對應課程的關注 id 不會進入排課引擎（Roadmap #25）', () => {
  // Roadmap #22 已經讓 mustTakeCourseIds／selectedCourseIds 撞到不存在的 id 時
  // 回報 data-insufficient 並回頭問使用者（見 Z5），這裡刻意不重複。關注課程
  // 只是追蹤用途，不佔時段也不計學分，為了一個打錯的 id 擋下整次排課並不相稱
  // ——改成濾掉並在 warnings 說明，而不是回頭問。
  const interpretation = {
    nonNegotiable: [], flexible: [], creditGoal: { min: null, max: null }, notMentioned: [],
  };
  const realCourse = { id: 1, catalogCourseCode: 'A1', name: '課甲' };

  test('不存在的 watching id 不會出現在傳給 generateSchedule 的 constraints 裡', async () => {
    let receivedConstraints;
    await executeAgentTool(
      'run_csp_scheduler',
      { watchingCourseIds: [1, 999999], interpretation },
      ctx,
      {
        lookupCourses: async ids => new Map(
          ids.filter(id => Number(id) === 1).map(id => [Number(id), realCourse])
        ),
        generateSchedule: (_identity, input) => {
          receivedConstraints = input.constraints;
          return { success: true, requestId: 'r1' };
        },
      }
    );

    assert.deepEqual(receivedConstraints.watchingCourseIds, [1]);
  });

  test('被略過的 id 併入 warnings，不覆蓋既有 warning', async () => {
    const result = await executeAgentTool(
      'run_csp_scheduler',
      { watchingCourseIds: [999999], interpretation },
      ctx,
      {
        lookupCourses: async () => new Map(),
        generateSchedule: () => ({ success: true, warnings: ['既有的排課警告'] }),
      }
    );

    assert.deepEqual(result.warnings, [
      '既有的排課警告',
      '關注課程 id 999999 查無對應課程，已略過。',
    ]);
  });

  test('全部合法時完全不動 constraints，也不新增 warnings', async () => {
    let receivedConstraints;
    const result = await executeAgentTool(
      'run_csp_scheduler',
      { watchingCourseIds: [1], interpretation },
      ctx,
      {
        lookupCourses: async () => new Map([[1, realCourse]]),
        generateSchedule: (_identity, input) => {
          receivedConstraints = input.constraints;
          return { success: true, warnings: [] };
        },
      }
    );

    assert.deepEqual(receivedConstraints.watchingCourseIds, [1]);
    assert.deepEqual(result.warnings, []);
  });

  test('沒有帶 watchingCourseIds 時完全不受影響', async () => {
    let receivedConstraints;
    await executeAgentTool('run_csp_scheduler', { interpretation }, ctx, {
      lookupCourses: async () => new Map(),
      generateSchedule: (_identity, input) => {
        receivedConstraints = input.constraints;
        return { success: true };
      },
    });

    assert.ok(!('watchingCourseIds' in receivedConstraints));
  });
});

describe('AG15 模型看到的工具結果統一包成信封（Roadmap #25）', () => {
  test('信封含五個固定欄位，實際內容在 result', () => {
    const envelope = buildToolResultEnvelope('query_course_db', [{ id: 1, name: '課甲' }]);

    assert.equal(envelope.schemaVersion, 1);
    assert.ok(['mysql', 'json-fallback'].includes(envelope.dataSource));
    assert.deepEqual(envelope.warnings, []);
    assert.equal(envelope.errorCode, null);
    assert.deepEqual(envelope.result, [{ id: 1, name: '課甲' }]);
  });

  test('陣列型結果也能正確包裝，不因為原始形狀是陣列而出錯', () => {
    const envelope = buildToolResultEnvelope('get_easy_courses', [1, 2, 3]);

    assert.deepEqual(envelope.result, [1, 2, 3]);
  });

  test('只有課程類工具附上 term，偏好／確認類工具不附', () => {
    const withTerm = buildToolResultEnvelope('run_csp_scheduler', { success: true });
    const withoutTerm = buildToolResultEnvelope('update_preferences', { success: true });

    assert.ok(withTerm.term && typeof withTerm.term.academicYear === 'number');
    assert.ok(!('term' in withoutTerm));
  });

  test('結果自帶 warnings 時會提到信封層', () => {
    const envelope = buildToolResultEnvelope('run_csp_scheduler', {
      success: true, warnings: ['訊號極弱'],
    });

    assert.deepEqual(envelope.warnings, ['訊號極弱']);
  });

  test('結果帶 errorCode 時信封正確透出', () => {
    const envelope = buildToolResultEnvelope('search_dcard_reviews', {
      error: '找不到該課程的評價', errorCode: 'REVIEWS_NOT_FOUND',
    });

    assert.equal(envelope.errorCode, 'REVIEWS_NOT_FOUND');
    assert.equal(envelope.result.error, '找不到該課程的評價');
  });

  test('沒有 errorCode 的結果，信封欄位是 null 而不是 undefined（JSON 序列化才看得到）', () => {
    const envelope = buildToolResultEnvelope('query_course_db', []);

    assert.equal(JSON.parse(JSON.stringify(envelope)).errorCode, null);
  });

  // 這是本次的核心邊界：信封只影響模型看到的那一份，前端消費的
  // `applyToolOutcome()` 寫進回應信封的 `data` 完全不能被信封污染。
  test('applyToolOutcome 寫進去的 data 是原始 result，不是包過信封的版本', () => {
    const rawResult = { success: true, requestId: 'r-1' };
    const after = applyToolOutcome(
      { intent: 'general_chat', data: null }, 'run_csp_scheduler', rawResult
    );

    assert.equal(after.data, rawResult);
    assert.ok(!('schemaVersion' in after.data));
  });
});

// 2026-10-15 Persona 實測：使用者說「我是大一」，模型就提議把年級「更新」成大一，整則回答變成確認流程。
describe('update_student_profile 與目前資料相同時不提議更新', () => {
  const prefs = { department: '資訊工程學系', gradeLevel: 1, className: '資訊一甲', admissionYear: 114 };

  test('PU-1 與目前相同的欄位會被拿掉；真的不同的才保留', () => {
    assert.deepEqual(dropUnchangedProfileFields({ gradeLevel: 1, className: '資訊一乙' }, prefs),
      { args: { className: '資訊一乙' }, unchanged: ['gradeLevel'] });
    assert.deepEqual(dropUnchangedProfileFields({ gradeLevel: '1' }, prefs), { args: {}, unchanged: ['gradeLevel'] });
    assert.deepEqual(dropUnchangedProfileFields({ gradeLevel: 2 }, {}), { args: { gradeLevel: 2 }, unchanged: [] });
  });

  test('PU-2 全部相同時回「不需要更新」，不暫存變更、也不是錯誤', async () => {
    let staged = 0;
    const ctx = { identity: { canonicalId: 'D0000001' }, prefs, studentScope: {}, turnId: 't1' };
    const result = await executeAgentTool('update_student_profile', { gradeLevel: 1, department: '資訊工程學系' }, ctx, {
      stageChange: () => { staged += 1; return { token: 'x', expiresAt: null }; },
    });
    assert.equal(result.noChange, true);
    assert.equal(result.error, undefined);
    assert.equal(staged, 0);
  });
});


describe('AG20 查課：分類用語不當關鍵字、可修的排前面（2026-11-24）', () => {
  test('keyword 整個是分類用語時改用 category', () => {
    assert.deepEqual(normalizeCourseQueryArgs({ keyword: '通識', dayOfWeek: 1 }), { category: '通識', dayOfWeek: 1 });
    assert.deepEqual(normalizeCourseQueryArgs({ keyword: ' 通識課 ', category: '通識' }), { category: '通識' });
    assert.deepEqual(normalizeCourseQueryArgs({ keyword: '系外' }), { category: '系外選修' });
    // 選修分兩類不猜，只刪 keyword；已給的 category 不被覆蓋。
    assert.deepEqual(normalizeCourseQueryArgs({ keyword: '選修' }), {});
    assert.deepEqual(normalizeCourseQueryArgs({ keyword: '必修', category: '通識' }), { category: '通識' });
  });

  test('真正的關鍵字不動', () => {
    assert.deepEqual(normalizeCourseQueryArgs({ keyword: '通識英文' }), { keyword: '通識英文' });
    assert.deepEqual(normalizeCourseQueryArgs({ keyword: '網路' }), { keyword: '網路' });
  });

  test('query_course_db 送進搜尋前先正規化', async () => {
    let received;
    await executeAgentTool('query_course_db', { keyword: '通識', dayOfWeek: 1 }, ctx, {
      searchCourses: args => { received = args; return []; },
    });
    assert.deepEqual(received, { category: '通識', dayOfWeek: 1 });
  });

  test('只回前 10 筆時，可修的排在不可修的前面（同級維持原順序）', async () => {
    const list = [
      ...Array.from({ length: 10 }, (_, i) => ({ id: i + 1, eligibility: 'ineligible' })),
      { id: 11, eligibility: 'unknown' },
      { id: 12, eligibility: 'eligible' },
      { id: 13, eligibility: 'eligible' },
    ];
    const result = await executeAgentTool('query_course_db', {}, ctx, { searchCourses: () => list });
    assert.deepEqual(result.slice(0, 3).map(item => item.id), [12, 13, 11]);
    assert.equal(result.length, 10);
    assert.deepEqual(rankByEligibility([{ id: 1 }, { id: 2, eligibility: 'eligible' }]).map(item => item.id), [2, 1]);
  });
});

describe('AG21 找替代課與換課（ADR-036）', () => {
  // 課表：A（週二 2-4）、B（週三 9-10，要被換掉）、C（週四 9-10）。
  const block = (dayOfWeek, startPeriod, endPeriod) => ({ dayOfWeek, startPeriod, endPeriod });
  const course = (id, name, code, timeBlocks, extra = {}) => ({
    id, sectionId: id, name, catalogCourseCode: code, timeBlocks, credits: 2,
    eligibility: 'eligible', category: '通識', timeStr: '', ...extra,
  });
  const A = course(1, '安全程式設計', 'IECS1', [block(2, 2, 4)]);
  const B = course(2, '人工智慧入門與省思', 'GE1', [block(3, 9, 10)]);
  const C = course(3, '程式設計與問題解決', 'IECS2', [block(4, 9, 10)]);
  const catalog = new Map([A, B, C].map(item => [item.id, item]));
  const pool = [
    course(10, '台灣考古學與原住民', 'GE10', [block(1, 3, 4)]),
    course(11, '衝堂通識', 'GE11', [block(2, 3, 4)]),
    course(12, '早八通識', 'GE12', [block(1, 1, 2)]),
    course(13, '修過的通識', 'GE13', [block(1, 6, 7)]),
    course(14, '不能修的通識', 'GE14', [block(1, 6, 7)], { eligibility: 'ineligible' }),
    course(15, '這次移除過的通識', 'GE15', [block(5, 3, 4)]),
    course(16, '另一班安全程式設計', 'IECS1', [block(5, 6, 7)]),
    course(17, '沒有時間的通識', 'GE17', []),
    // 被換掉那門課的另一班可以換。
    course(18, '人工智慧入門與省思', 'GE1', [block(5, 9, 10)]),
    { ...B },
  ];
  const planningCtx = {
    ...ctx,
    prefs: {
      noMorningClasses: true,
      courseHistory: [{ courseCode: 'GE13', courseName: '修過的通識', passed: true, academicYear: 113, semester: 1 }],
    },
    planningContext: {
      currentCourses: [{ sectionId: 1 }, { sectionId: 2 }, { sectionId: 3 }],
      removedCourses: [{ sectionId: 15, reason: null }],
    },
  };
  const deps = {
    lookupCourses: async ids => new Map(
      ids.map(id => [Number(id), catalog.get(Number(id))]).filter(([, value]) => value)
    ),
    searchScheduleCourses: async () => pool,
  };
  const PREFERENCE_LABEL = '不符合已存的排課偏好（早八、星期一排空、午休、不能上課的時段或避開教師）';

  test('排除衝堂、早八、已修、不能修、這次移除、同一門課、沒時間與課表上的課', async () => {
    const result = await executeAgentTool(
      'find_replacement_courses', { replaceSectionId: 2, category: '通識', dayOfWeek: 1 }, planningCtx, deps
    );
    assert.deepEqual(result.courses.map(item => item.sectionId), [10, 18]);
    assert.deepEqual(result.replacing, { sectionId: 2 });
    assert.deepEqual(result.excludedCounts, {
      '與課表上其他課衝堂': 1,
      [PREFERENCE_LABEL]: 1,
      '已經修過': 1,
      '資格不符': 1,
      '這次已移除過': 1,
      '與課表上的課是同一門課': 1,
      '沒有上課時間': 1,
      '已在課表上': 1,
    });
    // 頂層不帶課名，避免被忠實度檢查當成一門候選課。
    assert.equal(result.name, undefined);
  });

  test('搜尋條件經過正規化後才送出', async () => {
    let received;
    await executeAgentTool('find_replacement_courses', { replaceSectionId: 2, keyword: '通識' }, planningCtx, {
      ...deps, searchScheduleCourses: async filters => { received = filters; return []; },
    });
    assert.deepEqual(received, { category: '通識' });
  });

  test('要換掉的課不在目前課表上時回 error', async () => {
    const result = await executeAgentTool('find_replacement_courses', { replaceSectionId: 99 }, planningCtx, deps);
    assert.equal(result.errorCode, 'REPLACE_TARGET_NOT_IN_SCHEDULE');
  });

  test('沒有候選時不是失敗，回空清單與原因', async () => {
    const result = await executeAgentTool('find_replacement_courses', { replaceSectionId: 2 }, planningCtx, {
      ...deps, searchScheduleCourses: async () => [pool[1]],
    });
    assert.equal(result.error, undefined);
    assert.equal(result.success, undefined);
    assert.deepEqual(result.courses, []);
    assert.equal(result.excludedCounts['與課表上其他課衝堂'], 1);
  });

  test('swap_course 換上合格的候選，回傳完整課程給前端', async () => {
    const result = await executeAgentTool('swap_course', { removeSectionId: 2, addSectionId: 10 }, planningCtx, deps);
    assert.equal(result.success, true);
    assert.equal(result.swap.removeSectionId, 2);
    assert.equal(result.swap.addCourse.sectionId, 10);
    assert.deepEqual(result.swap.addCourse.timeBlocks, [block(1, 3, 4)]);
    assert.equal(result.courses[0].name, '台灣考古學與原住民');
  });

  test('swap_course 拒絕不合格的課（例如衝堂）', async () => {
    const result = await executeAgentTool('swap_course', { removeSectionId: 2, addSectionId: 11 }, planningCtx, deps);
    assert.equal(result.errorCode, 'SWAP_TARGET_NOT_ELIGIBLE');
  });
});

describe('AG22 課程主題偏好工具（ADR-037）', () => {
  test('get_topic_interests 帶 sectionId 給讀取服務，不寫入', async () => {
    let received;
    const result = await executeAgentTool('get_topic_interests', { sectionId: 7 }, ctx, {
      readTopicInterests: async (_id, _prefs, options) => { received = options; return { selectedTopics: ['區塊鏈'] }; },
    });
    assert.deepEqual(received, { sectionId: 7 });
    assert.deepEqual(result.selectedTopics, ['區塊鏈']);
  });

  test('update_topic_interests 把參數原樣交給寫入服務', async () => {
    let received;
    const args = { addTerms: ['區塊鏈'], removeTerms: ['生成式AI'], recordNotInterested: false };
    const result = await executeAgentTool('update_topic_interests', args, ctx, {
      writeTopicInterests: async (_id, _prefs, input) => { received = input; return { success: true, added: ['區塊鏈'] }; },
    });
    assert.deepEqual(received, args);
    assert.equal(result.success, true);
  });
});
