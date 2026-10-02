// roadmap #10 任務 2：方案挑選器接進 `generateSchedule()` 之後的資料契約。
//
// 單元測試（diverseSubsetSelector.test.js）只看課號集合。這裡用真的 HiGHS 求解，再透過
// `diverseCandidatesHook` 改寫候選，重現求解器不容易剛好產生的兩種情況：
//   - 兩條主軸的候選幾乎相同 → `too-similar-to-selected` ＋ `conflictsWith`；
//   - 候選不通過單一方案檢查 → `candidate-check-failed`，**不能**被說成太相似。
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { makeCourse } from './fixtures.js';
import { getHighsRuntime } from '../src/skills/optimization/highsRuntime.js';
import { generateSchedule } from '../src/skills/scheduler.js';

function pool() {
  return Array.from({ length: 8 }, (_, index) => makeCourse(index + 1, {
    name: index < 2 ? `一般課程${index + 1}` : `人工智慧專題${index + 1}`,
    catalogCourseCode: `MILP${index + 1}`,
    category: '一般選修',
    credits: 3,
    dayOfWeek: (index % 4) + 1,
    startPeriod: index < 4 ? 2 : 6,
    endPeriod: index < 4 ? 3 : 7,
  }));
}

const CONSTRAINTS = { minCredits: 6, maxCredits: 6, interests: ['人工智慧'] };
const SOLVER_OPTIONS = { totalBudgetMs: 5000, candidatesPerAxis: 1, minQualityScale: 10_000 };

async function run(courses, hook) {
  return generateSchedule(courses, CONSTRAINTS, {
    highsRuntime: await getHighsRuntime(),
    diverseSolverOptions: SOLVER_OPTIONS,
    ...(hook ? { diverseCandidatesHook: hook } : {}),
  });
}

// 找出求解器真的有產生候選的主軸，以及另一條可以拿來改寫的主軸。
function splitAxes(generated) {
  const source = generated.axes.find(axis => axis.candidates.length > 0);
  const target = generated.axes.find(axis => axis !== source);
  return { source, target };
}

describe('SS1 沒有衝突時的契約', () => {
  test('SS1 solver.method 仍是候選產生方法，挑選方法另記在 subsetSelection', async () => {
    const result = await run(pool());
    const { solver, collapsed } = result.planDiversity;

    assert.equal(solver.method, 'dinkelbach-milp');
    assert.equal(solver.subsetSelection.method, 'dbin-exact-enumeration');
    assert.equal(solver.subsetSelection.objective.planCount, result.plans.length);
    assert.deepEqual(solver.subsetSelection.rejectedCandidates, []);
    assert.equal(Object.hasOwn(solver.subsetSelection, 'error'), false);
    // 沒有「太相似」時，collapsed 的項目不得帶 conflictsWith 這個 key。
    for (const item of collapsed) assert.equal(Object.hasOwn(item, 'conflictsWith'), false);
    for (const plan of result.plans.filter(item => item.milpSolver)) {
      assert.equal(plan.milpSolver.method, 'dinkelbach-milp');
    }
  });

  // `inputs.competitive` 按班次列；同課號多班次在 MILP 裡是同一個 z_k。
  // 多加一個同課號的班次，分母 b 不應該跟著變大。
  test('SS1b b 是不重複課號數，不是班次數', async () => {
    const before = await run(pool());
    const extraSection = makeCourse(99, {
      name: '人工智慧專題8',
      catalogCourseCode: 'MILP8',
      category: '一般選修',
      credits: 3,
      dayOfWeek: 5,
      startPeriod: 2,
      endPeriod: 3,
    });
    const after = await run([...pool(), extraSection]);
    // 先確認前提成立：班次真的比課號多一個，否則這條測試什麼都沒測到。
    const withInputs = generateSchedule([...pool(), extraSection], CONSTRAINTS, {
      highsRuntime: await getHighsRuntime(),
      diverseSolverOptions: SOLVER_OPTIONS,
      includeMipInputs: true,
    });
    assert.equal(withInputs.mipInputs.competitive.length, 9);

    assert.equal(before.planDiversity.solver.subsetSelection.b, 8);
    assert.equal(after.planDiversity.solver.subsetSelection.b, 8);
  });
});

describe('SS2 兩條主軸太相似', () => {
  test('SS2 回報 too-similar-to-selected 與已解析的 conflictsWith', async () => {
    let names;
    const result = await run(pool(), generated => {
      const { source, target } = splitAxes(generated);
      names = { source: source.archetype, target: target.archetype };
      // 把 source 的候選原封不動複製給 target：兩條主軸的課號集合完全相同。
      target.status = 'generated';
      target.reason = null;
      target.candidates = source.candidates.map(candidate => ({ ...candidate, archetype: target.archetype }));
      return generated;
    });

    const tooSimilar = result.planDiversity.collapsed
      .filter(item => item.detail === 'too-similar-to-selected');
    assert.equal(tooSimilar.length, 1, `改寫了 ${names.source} → ${names.target}`);
    const [item] = tooSimilar;
    assert.equal(item.reason, 'insufficient-difference');
    assert.equal(item.conflictsWith.length, 1);
    // conflictsWith 的元素是已解析好的 { variantId, title }，而且指向一個真的有顯示的方案。
    const [other] = item.conflictsWith;
    assert.deepEqual(Object.keys(other).sort(), ['title', 'variantId']);
    const shown = result.plans.find(plan => plan.id === other.variantId);
    assert.ok(shown, '衝突對象必須是畫面上存在的方案');
    assert.equal(shown.title, other.title);

    // 給使用者看的句子帶對方的名稱，而且不再說成「品質下限內換不出兩門課」。
    const warning = result.warnings.find(message => message.includes(item.title));
    assert.ok(warning.includes(`「${other.title}」`));
    assert.ok(warning.includes('幾乎相同'));
    assert.equal(warning.includes('無法在品質下限內換進、換出至少兩門課'), false);

    // 兩條主軸中只留一條；被留下的那條有對應方案。
    const kept = [names.source, names.target].filter(archetype => (
      result.plans.some(plan => plan.id === `personalized_${archetype}`)
    ));
    assert.equal(kept.length, 1);
  });
});

describe('SS3 候選未通過單一方案檢查', () => {
  test('SS3 回報 candidate-check-failed，不說成太相似', async () => {
    let touched;
    const result = await run(pool(), generated => {
      const { source } = splitAxes(generated);
      touched = source.archetype;
      // 塞進一門與既有班次同時段的課，讓 validator 判定衝堂。
      source.candidates = source.candidates.map(candidate => {
        const [first] = candidate.selectedSections;
        const clash = {
          ...first,
          courseKey: 'CLASH',
          course: { ...first.course, id: 777, catalogCourseCode: 'CLASH', name: '衝堂課' },
        };
        return {
          ...candidate,
          selectedKeys: new Set([...candidate.selectedKeys, 'CLASH']),
          selectedSections: [...candidate.selectedSections, clash],
        };
      });
      return generated;
    });

    const item = result.planDiversity.collapsed.find(entry => entry.variantId === `personalized_${touched}`);
    assert.ok(item, `${touched} 應該被記為未產出`);
    assert.equal(item.reason, 'candidate-check-failed');
    assert.notEqual(item.detail, 'too-similar-to-selected');
    assert.ok(['validator-rejected', 'model-check-rejected', 'mixed'].includes(item.detail));
    assert.equal(Object.hasOwn(item, 'conflictsWith'), false);

    const rejected = result.planDiversity.solver.subsetSelection.rejectedCandidates;
    assert.ok(rejected.some(entry => entry.archetype === touched));
    assert.ok(result.warnings.some(message => message.includes('未通過課表規則檢查')));
    assert.equal(result.plans.some(plan => plan.id === `personalized_${touched}`), false);
  });
});
