// Roadmap #35：排課引擎 benchmark 題庫的正確性斷言。
//
// 不塞進 `scheduler.test.js`——那份檔案已經兩千多行，題庫用的是幾十門課的
// 候選池，跟現有 Z1-Z7 那種 2-3 門課的最小合成情境風格不同，分開比較看得清楚。
//
// 這批測試留在 `npm test`：跟其他排課測試一樣快、無條件執行，沒有 roadmap #34
// 那種 API 成本考量（純本地運算，不打模型、不連資料庫）。

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { runSchedulerCase, runSchedulerBenchmark } from '../src/skills/schedulerBenchmark.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, 'fixtures', 'schedulerBenchmarkCases.json'), 'utf8')
);

const EXPECTED_CATEGORIES = new Set(['feasible', 'infeasible', 'greedy-trap', 'timeout', 'data-insufficient']);

describe('SB 排課引擎 benchmark 題庫合法性', () => {
  test('題庫本身合法：每題有 id／why／候選課程，expectedCategory 是五類之一', () => {
    const seen = new Set();
    for (const [index, testCase] of fixture.cases.entries()) {
      const label = testCase.id ?? `第 ${index + 1} 題`;
      assert.ok(testCase.id, `${label}：缺少 id`);
      assert.ok(!seen.has(testCase.id), `${label}：id 重複`);
      seen.add(testCase.id);
      assert.ok(testCase.why, `${label}：缺少 why（這題要驗證什麼）`);
      assert.ok(Array.isArray(testCase.candidateCourses) && testCase.candidateCourses.length > 0,
        `${label}：candidateCourses 不得為空`);
      assert.ok(EXPECTED_CATEGORIES.has(testCase.expectedCategory),
        `${label}：expectedCategory「${testCase.expectedCategory}」不是五類之一`);
    }
  });

  // 涵蓋五類的意義不只是「每類至少一題」，是 roadmap #35 的驗收標準本身要求
  // 這五種情境都被量測到；少一類代表題庫退化，這條測試讓那件事立刻可見。
  test('五類情境都至少有一題覆蓋', () => {
    const categories = new Set(fixture.cases.map(c => c.expectedCategory));
    for (const category of EXPECTED_CATEGORIES) {
      assert.ok(categories.has(category), `題庫缺少 ${category} 類的 case`);
    }
  });
});

describe('SB 逐 case 正確性斷言', () => {
  for (const testCase of fixture.cases) {
    test(`${testCase.id}：${testCase.why}`, () => {
      const row = runSchedulerCase(testCase);
      assert.ok(row.pass, `${testCase.why}\n  失敗原因：${row.note}`);
    });
  }
});

describe('SB 整體彙總', () => {
  test('全部 case 通過，且彙總數字與逐題結果一致', () => {
    const summary = runSchedulerBenchmark(fixture.cases);
    assert.equal(summary.total, fixture.cases.length);
    assert.equal(summary.failed, 0, `${summary.failed} 題未通過：`
      + summary.rows.filter(r => !r.pass).map(r => `${r.id}（${r.note}）`).join('；'));
    assert.equal(summary.passed, summary.total);
  });

  // roadmap #35 的驗收標準一：「成功方案 hard violation count 為 0」。
  // 這裡直接對彙總結果斷言，不是散落在各 case 裡各自檢查一次。
  test('所有 feasible／greedy-trap 類 case 的 hard violation count 皆為 0', () => {
    const summary = runSchedulerBenchmark(fixture.cases);
    const successCases = summary.rows.filter(r => r.category === 'feasible' || r.category === 'greedy-trap');
    assert.ok(successCases.length > 0, '題庫裡沒有 feasible／greedy-trap 類 case 可供檢查');
    for (const row of successCases) {
      assert.equal(row.hardViolationCount, 0,
        `${row.id} 的 hard violation count 應為 0，實際為 ${row.hardViolationCount}（${row.hardViolations.join('、')}）`);
    }
  });

  // 驗收標準三：「Golden infeasible cases 回傳正確 conflict set，不把 timeout
  // 當 infeasible」——兩個 timeout case（有解／無解）與一個真無解 case 的
  // solverStatus 不能混在一起。
  test('timeout 與 infeasible 的 solver.status 不被混為一談', () => {
    const summary = runSchedulerBenchmark(fixture.cases);
    const byId = Object.fromEntries(summary.rows.map(row => [row.id, row]));

    assert.equal(byId['ee-sophomore-required-conflict'].solverStatus, 'infeasible');
    assert.equal(byId['cs-freshman-timeout-with-fallback'].solverStatus, 'timeout');
    assert.equal(byId['math-junior-timeout-no-solution'].solverStatus, 'timeout');
    // 同樣是 timeout，一個有 fallback 解、一個沒有——不能因為 status 相同
    // 就假設兩題結果一樣。
    assert.equal(byId['cs-freshman-timeout-with-fallback'].timedOut, true);
    assert.equal(byId['math-junior-timeout-no-solution'].timedOut, true);
  });
});
