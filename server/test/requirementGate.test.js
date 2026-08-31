// Roadmap #24：永久寫入的確認閘門、profile 更正後的 scope 重建，
// 以及排課前的矛盾偵測——三者都在 `executeAgentTool()` 這一層。
//
// 與 `agentTools.test.js` 同樣用 `deps` 注入，完全不碰網路與資料庫。

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { executeAgentTool, mergePreferenceTags } from '../src/services/agentService.js';

const identity = { canonicalId: 'S1130001' };
const ctx = { identity, prefs: {}, studentScope: { department: '資訊工程系', resolved: true } };

describe('AG9 永久寫入前必須先經使用者確認', () => {
  // 先前 `update_preferences` 在模型決定呼叫的當下就寫進 MySQL，唯一的保護是
  // system prompt 裡一句模型可以無視的叮嚀——這正是 #24 自己的範圍條文
  // 「使用者確認前不得永久更新偏好」被違反的地方。
  test('沒有 confirmationToken 時只暫存，絕不呼叫寫入', async () => {
    let wrote = false;
    const result = await executeAgentTool('update_preferences', { noEveningClasses: true }, ctx, {
      updatePreferences: async () => { wrote = true; },
      stageChange: () => ({ token: 'tok-1', expiresAt: '2026-08-30T12:00:00.000Z' }),
    });

    assert.equal(wrote, false, '未確認前不得有任何寫入');
    assert.equal(result.pendingConfirmation, true);
    assert.equal(result.confirmationToken, 'tok-1');
    assert.deepEqual(result.proposedChanges, { noEveningClasses: true });
    assert.equal(result.success, undefined, '不得讓模型以為已經成功');
  });

  // 模型可能拿一個使用者確認過的 token，夾帶使用者從沒同意過的欄位一起送。
  // 寫入的必須是**當初暫存**的內容。同樣的防護思路已存在於
  // `scheduleFeedbackService`：不信模型自報的 sectionId，只信伺服器的曝光紀錄。
  test('確認時寫入的是暫存內容，夾帶的額外欄位一律忽略', async () => {
    let written = null;
    const staged = { noEveningClasses: true };
    await executeAgentTool(
      'update_preferences',
      { confirmationToken: 'tok-1', targetCreditsMax: 30, noMorningClasses: true },
      ctx,
      { updatePreferences: async (_id, fields) => { written = fields; }, consumeChange: () => staged }
    );

    assert.deepEqual(written, { noEveningClasses: true });
  });

  test('token 無效、過期或已用過時回 error 且不寫入', async () => {
    let wrote = false;
    const result = await executeAgentTool('update_preferences', { confirmationToken: 'bad' }, ctx, {
      updatePreferences: async () => { wrote = true; },
      consumeChange: () => null,
    });

    assert.equal(wrote, false);
    assert.match(result.error, /confirmationToken/);
  });

  test('沒有任何要變更的欄位時直接拒絕，不佔用一個 token', async () => {
    let staged = false;
    const result = await executeAgentTool('update_preferences', {}, ctx, {
      stageChange: () => { staged = true; return { token: 'x', expiresAt: 'y' }; },
    });

    assert.equal(staged, false);
    assert.match(result.error, /沒有要變更的欄位/);
  });
});

describe('AG10 update_student_profile 確認後同回合就改變查詢範圍', () => {
  // #24 驗收標準：「使用者更正 department／grade／className 後，後續 candidate
  // scope 使用新值」。先前 scope 只在回合開始算一次，改完不會重算。
  test('確認後 ctx.studentScope 立即以新 profile 重建', async () => {
    const prefs = { department: null, gradeLevel: null };
    const turnCtx = { identity, prefs, studentScope: { department: null, resolved: false } };
    const staged = { department: '資訊工程學系', gradeLevel: 3 };

    const result = await executeAgentTool(
      'update_student_profile', { confirmationToken: 'tok' }, turnCtx,
      { updatePreferences: async () => {}, consumeChange: () => staged }
    );

    assert.equal(result.success, true);
    assert.equal(turnCtx.studentScope.department, '資訊工程學系');
    assert.equal(turnCtx.studentScope.grade, 3);
    assert.equal(turnCtx.studentScope.resolved, true);
    assert.equal(result.scopeResolved, true);
  });

  // `ctx` 在同一次 handleChat 迴圈中是同一個物件參考，所以下一個工具呼叫就看得到。
  test('同回合後續的 query_course_db 收到更新後的 scope', async () => {
    const prefs = {};
    const turnCtx = { identity, prefs, studentScope: { department: null, resolved: false } };
    await executeAgentTool('update_student_profile', { confirmationToken: 'tok' }, turnCtx, {
      updatePreferences: async () => {},
      consumeChange: () => ({ department: '資訊工程學系', gradeLevel: 3 }),
    });

    let seenScope;
    await executeAgentTool('query_course_db', { keyword: '網路' }, turnCtx, {
      searchCourses: (_args, scope) => { seenScope = scope; return []; },
    });

    assert.equal(seenScope.department, '資訊工程學系');
  });

  test('未確認前不得寫入 profile', async () => {
    let wrote = false;
    const result = await executeAgentTool('update_student_profile', { department: '資訊工程學系' }, ctx, {
      updatePreferences: async () => { wrote = true; },
      stageChange: () => ({ token: 't', expiresAt: 'e' }),
    });

    assert.equal(wrote, false);
    assert.equal(result.pendingConfirmation, true);
  });
});

describe('AG11 排課前的矛盾與資料不足偵測', () => {
  // 系所無法解析時必修判定其實懸空，先前照樣排完給使用者，一聲不吭。
  test('scope 無法解析時短路成澄清，完全不呼叫排課引擎', async () => {
    let scheduled = false;
    const result = await executeAgentTool(
      'run_csp_scheduler', {}, { ...ctx, studentScope: { resolved: false } },
      { generateSchedule: () => { scheduled = true; return { success: true }; } }
    );

    assert.equal(scheduled, false, '資料不足時不該真的跑排課');
    assert.equal(result.clarification.required, true);
    assert.equal(result.solver.status, 'data-insufficient');
    assert.equal(result.clarification.questions[0].id, 'confirm-student-scope');
  });

  test('scope 正常且無矛盾時照常進入排課引擎', async () => {
    let scheduled = false;
    await executeAgentTool(
      'run_csp_scheduler', {}, { ...ctx, studentScope: { resolved: true } },
      { generateSchedule: () => { scheduled = true; return { success: true }; } }
    );

    assert.equal(scheduled, true);
  });

  // 使用者自己給的兩個條件互相打架——直接問他要保留哪一邊，比跑完一次排課
  // 再回報「無解」誠實也快得多。
  test('必修課撞到自訂封鎖時段時先問，不跑排課', async () => {
    let scheduled = false;
    const course = { id: 55, name: '資料結構', dayOfWeek: 1, startPeriod: 3, endPeriod: 4 };
    const result = await executeAgentTool(
      'run_csp_scheduler',
      { mustTakeCourseIds: [55], blockedPeriods: [{ day: 1, period: 3 }] },
      { ...ctx, studentScope: { resolved: true } },
      {
        generateSchedule: () => { scheduled = true; return { success: true }; },
        lookupCourses: async () => new Map([[55, course]]),
      }
    );

    assert.equal(scheduled, false);
    assert.equal(result.clarification.questions[0].id, 'confirm-required-course-conflict');
    assert.deepEqual(result.clarification.questions[0].constraintIds, ['BLOCKED_PERIODS']);
    assert.deepEqual(result.clarification.relatedCourseIds, [55]);
  });

  test('必修課沒撞到封鎖時段時不誤報', async () => {
    let scheduled = false;
    const course = { id: 55, name: '資料結構', dayOfWeek: 1, startPeriod: 3, endPeriod: 4 };
    await executeAgentTool(
      'run_csp_scheduler',
      { mustTakeCourseIds: [55], blockedPeriods: [{ day: 2, period: 3 }] },
      { ...ctx, studentScope: { resolved: true } },
      {
        generateSchedule: () => { scheduled = true; return { success: true }; },
        lookupCourses: async () => new Map([[55, course]]),
      }
    );

    assert.equal(scheduled, true);
  });
});

describe('AG12 部分偏好更新不得刪掉使用者沒提到的偏好', () => {
  // 瀏覽器驗收實際踩到：只送兩個旗標，demo 帳號的 preference_tags 從 5 個被砍成
  // 2 個——三個使用者從沒提過的偏好被靜默刪掉。既有行為，#24 一併修掉。
  const existing = {
    preferenceTags: ['#盡量集中排課', '#不排早八', '#上機實作考試', '#全英授課', '#學到許多知識'],
  };

  test('只改一個旗標時，其餘標籤原樣保留', () => {
    // 用有對應標籤的旗標；`noEveningClasses` 沒有標籤，不走這條路。
    const merged = mergePreferenceTags(existing, { lunchBreakFree: true });

    for (const tag of existing.preferenceTags) {
      assert.ok(merged.includes(tag), `${tag} 不該被刪掉`);
    }
    assert.equal(merged.length, existing.preferenceTags.length + 1);
  });

  test('把旗標設成 false 會移除對應標籤，但不影響其他標籤', () => {
    const merged = mergePreferenceTags(existing, { noMorningClasses: false });

    assert.ok(!merged.includes('#不排早八'));
    assert.ok(merged.includes('#全英授課'));
    assert.ok(merged.includes('#上機實作考試'));
  });

  // 這次沒動到任何旗標就不該順手重寫整份標籤清單。
  test('只改學分之類的非旗標欄位時不碰標籤', () => {
    assert.equal(mergePreferenceTags(existing, { targetCreditsMax: 18 }), null);
  });

  test('寫入時帶上合併後的完整標籤清單', async () => {
    let written = null;
    await executeAgentTool(
      'update_preferences', { confirmationToken: 'tok' },
      { identity, prefs: { ...existing }, studentScope: { resolved: true } },
      {
        updatePreferences: async (_id, payload) => { written = payload; },
        consumeChange: () => ({ lunchBreakFree: true }),
      }
    );

    assert.ok(written.preferenceTags.includes('#全英授課'), '無關偏好必須一起寫回去');
    assert.ok(written.preferenceTags.includes('#午休務必空出'), '這次的變更也要在清單裡');
    assert.equal(written.lunchBreakFree, true);
  });
});

describe('AG13 理解回講不進排課引擎，但會回傳給使用者', () => {
  const interpretation = {
    nonNegotiable: [], flexible: ['盡量集中排課'], creditGoal: '12～18 學分', notMentioned: ['不能上課的時段'],
  };

  // interpretation 是給使用者看的說明，不是排課條件。混進 constraints 會被
  // 排課引擎當成一個不認得的限制欄位。
  test('送進排課引擎的 constraints 不含 interpretation', async () => {
    let received;
    await executeAgentTool(
      'run_csp_scheduler', { maxCredits: 18, interpretation },
      { ...ctx, studentScope: { resolved: true } },
      { generateSchedule: (_id, input) => { received = input; return { success: true }; } }
    );

    assert.equal(received.constraints.maxCredits, 18);
    assert.ok(!('interpretation' in received.constraints));
  });

  test('排課結果會帶回 interpretation 給前端顯示', async () => {
    const result = await executeAgentTool(
      'run_csp_scheduler', { interpretation },
      { ...ctx, studentScope: { resolved: true } },
      { generateSchedule: () => ({ success: true, requestId: 'r-1' }) }
    );

    assert.deepEqual(result.interpretation, interpretation);
    assert.equal(result.success, true);
  });

  test('回講與參數自相矛盾時擋下，不跑排課', async () => {
    let scheduled = false;
    const result = await executeAgentTool(
      'run_csp_scheduler',
      { interpretation: { ...interpretation, nonNegotiable: ['絕對不排早八'] } },
      { ...ctx, studentScope: { resolved: true } },
      { generateSchedule: () => { scheduled = true; return { success: true }; } }
    );

    assert.equal(scheduled, false);
    assert.equal(result.clarification.questions[0].id, 'confirm-interpretation-mismatch');
  });
});
