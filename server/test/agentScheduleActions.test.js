import assert from 'node:assert/strict';
import { test } from 'node:test';
import { executeAgentTool, handleChat } from '../src/services/agentService.js';
import { validatePlanningContext } from '../src/data/planningContextSchema.js';
import { resolvePlanningContext } from '../src/services/planningContextService.js';
import { makeCourse } from './fixtures.js';

const pool = [
  makeCourse(901, { name: '資料工程', catalogCourseCode: 'C901', dayOfWeek: 2, startPeriod: 3, endPeriod: 4 }),
  makeCourse(902, { name: '資料工程', catalogCourseCode: 'C901', dayOfWeek: 3, startPeriod: 3, endPeriod: 4 }),
  makeCourse(903, { name: '電腦網路', catalogCourseCode: 'C903', dayOfWeek: 2, startPeriod: 3, endPeriod: 4 }),
];
const plans = [{ id: 'personalized', title: '個人化綜合方案' }, { id: 'easy', title: '輕鬆導向方案' }];
const prefs = { department: '資訊工程學系', gradeLevel: 3, className: '資訊三甲', targetCreditsMin: 0 };
const requestId = 'e9de4010-ef4c-401b-89ca-62165f1d8d27';

function fixture(id, current = [901]) {
  const identity = { canonicalId: id };
  const context = validatePlanningContext({
    requestId, activePlanId: 'plan1', currentCourses: current.map(sectionId => ({ sectionId })),
    plans, selectedVariantId: 'personalized',
  }).value;
  const writes = [];
  const options = {
    loadPreferences: async () => prefs,
    saveExchange: async () => {},
    resolvePlanning: (id, input) => resolvePlanningContext(id, input, {
      loadCourses: async () => pool,
      findExposure: async () => ({ displayedPlanIds: ['plan1'], displayedSectionIds: new Set(current) }),
    }),
    executeTool: (name, args, ctx) => executeAgentTool(name, args, ctx, {
      lookupCourses: async ids => new Map(pool.filter(course => ids.includes(course.id)).map(course => [course.id, course])),
      searchCourses: async ({ keyword }) => pool.filter(course => course.name.includes(keyword) || course.catalogCourseCode === keyword),
      recordFeedback: async (_, request) => {
        writes.push(request);
        return { success: true, recorded: true };
      },
    }),
  };
  return { writes, chat: text => handleChat(identity, text, context, options) };
}

test('以課名加課遇到兩個班次，短答選定前不產生修改指令', async () => {
  const f = fixture('ACTIONS-ADD', []);
  const question = await f.chat('加課 資料工程');
  assert.match(question.reply, /多個符合[\s\S]*901[\s\S]*902/u);
  assert.equal(question.data, null);
  const chosen = await f.chat('第二個');
  assert.equal(chosen.data.scheduleAction.course.id, 902);
  const byCode = await f.chat('加選 C903');
  assert.equal(byCode.data.scheduleAction.sectionId, 903);
});

test('鎖定、解鎖、移除及換班只操作目前課表中的來源班次', async () => {
  const f = fixture('ACTIONS-CURRENT');
  for (const [message, action] of [['鎖定班次901', 'lock'], ['解除鎖定班次901', 'unlock'], ['移除班次901', 'remove']]) {
    assert.equal((await f.chat(message)).data.scheduleAction.action, action);
  }
  assert.equal((await f.chat('移除班次902')).data, null);
  const swap = (await f.chat('把班次901換成班次902')).data.scheduleAction;
  assert.equal(swap.action, 'swap');
  assert.equal(swap.sectionId, 901);
  assert.equal(swap.target.id, 902);
});

test('避開先問作用範圍，回覆本次後接續；關注與取消是明確動作', async () => {
  const f = fixture('ACTIONS-AVOID');
  const question = await f.chat('避開班次903');
  assert.match(question.reply, /本次避開.*以後/);
  assert.equal(question.data, null);
  assert.equal((await f.chat('這次')).data.scheduleAction.scope, 'temporary');
  assert.equal((await f.chat('解除避開班次903')).data.scheduleAction.action, 'restore');
  assert.equal((await f.chat('以後避開班次903')).data.scheduleAction.scope, 'saved');
  assert.equal((await f.chat('關注班次903')).data.scheduleAction.action, 'watch');
  assert.equal((await f.chat('取消關注班次903')).data.scheduleAction.action, 'unwatch');
});

test('比較、切換、檢查均依目前方案和班次，檢查回傳實際衝堂', async () => {
  const f = fixture('ACTIONS-PLANS', [901, 903]);
  assert.equal((await f.chat('比較目前方案')).data.scheduleAction.action, 'compare');
  const question = await f.chat('切換方案');
  assert.match(question.reply, /要?切到哪個方案/);
  assert.equal((await f.chat('第二個')).data.scheduleAction.variantId, 'easy');
  const checked = (await f.chat('檢查目前課表')).data.scheduleAction;
  assert.equal(checked.valid, false);
  assert.equal(checked.credits, 6);
  assert.match(checked.issues.join(' '), /衝堂|時段衝突/);
  const incomplete = await fixture('ACTIONS-MISSING', [901, 99999]).chat('檢查目前課表');
  assert.match(incomplete.reply, /班次資料查不到/);
  assert.equal(incomplete.data, null);
});

test('只在有具體且可對照目前推薦的課程和原因時記錄調整回饋', async () => {
  const f = fixture('ACTIONS-FEEDBACK');
  assert.equal((await f.chat('這份課表符合需求')).data.scheduleAction.feedback, 'accept');
  assert.equal((await f.chat('這份課表需要調整')).data.scheduleAction.feedback, 'adjust');
  assert.equal(f.writes.length, 0);
  assert.equal((await f.chat('記錄班次902作業太多')).data, null);
  const action = (await f.chat('記錄班次901作業太多')).data.scheduleAction;
  assert.equal(action.feedbackResult.recorded, true);
  assert.deepEqual(f.writes, [{ requestId, accepted: false, rejectedCourses: [{ sectionId: 901, reason: 'workload' }] }]);
});
