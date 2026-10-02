// roadmap #10 任務 2：方案挑選器（Danna & Woodruff 2009 的 D_bin 目標，窮舉精確求解）。
//
// 要釘住的事：
//   1. D_bin 的數值與論文 §2.2 的公式一致（手算對照）；
//   2. 窮舉結果等於獨立暴力實作的最佳解；
//   3. **結果與輸入順序無關**——這正是被取代的暫時挑選器的毛病；
//   4. 邊界（只有 S₀、b = 0）有明確定義，不會靜默除以零。
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  CANONICAL_ARCHETYPE_ORDER,
  dBinFromHammingSum,
  selectDiverseSubset,
  SUBSET_SELECTION_METHOD,
} from '../src/skills/optimization/diverseSubsetSelector.js';

const set = text => new Set(text.split(''));
// candidateId 模擬正式接線的「課號集合|班次集合」；sections 省略時視為每門課只有一個班次。
const cand = (keys, ratio = 1, sections = '') => ({
  candidateId: `${[...keys].sort().join(',')}|${sections}`,
  selectedKeys: set(keys),
  ratio,
});

// 固定 seed 的 LCG，讓「隨機」案例每次跑都一樣。
function rng(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function shuffled(items, random) {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const other = Math.floor(random() * (index + 1));
    [copy[index], copy[other]] = [copy[other], copy[index]];
  }
  return copy;
}

const hamming = (left, right) => (
  [...left].filter(key => !right.has(key)).length + [...right].filter(key => !left.has(key)).length
);
const replacement = (left, right) => Math.min(
  [...left].filter(key => !right.has(key)).length,
  [...right].filter(key => !left.has(key)).length
);

// 獨立的暴力實作：不共用選擇器的任何程式碼，只回傳最佳的 (planCount, hammingSum)。
function bruteForceObjective(base, axes) {
  let best = { planCount: 0, sum: -1 };
  const walk = (index, members) => {
    if (index === axes.length) {
      for (let j = 0; j < members.length; j += 1) {
        for (let k = j + 1; k < members.length; k += 1) {
          if (replacement(members[j], members[k]) < 2) return;
        }
      }
      let sum = 0;
      for (let j = 0; j < members.length; j += 1) {
        for (let k = j + 1; k < members.length; k += 1) sum += hamming(members[j], members[k]);
      }
      if (members.length > best.planCount || (members.length === best.planCount && sum > best.sum)) {
        best = { planCount: members.length, sum };
      }
      return;
    }
    walk(index + 1, members);
    for (const candidate of axes[index].candidates) walk(index + 1, [...members, candidate.selectedKeys]);
  };
  walk(0, [base]);
  return best;
}

describe('DS1 D_bin 與論文公式一致', () => {
  // S₀ = {a,b,c,d}、X = {a,b,e,f}、Y = {c,d,g,h}，b = 8。
  //   hamming(S₀,X) = 4、hamming(S₀,Y) = 4、hamming(X,Y) = 8 → 合計 16
  //   D_bin = 2/(3·2) · 16/8 = 2/3
  test('DS1 三份方案的手算對照', () => {
    const result = selectDiverseSubset({
      baseSelection: set('abcd'),
      axes: [
        { archetype: 'interest', candidates: [cand('abef')] },
        { archetype: 'compact', candidates: [cand('cdgh')] },
      ],
      b: 8,
    });

    assert.equal(result.objective.planCount, 3);
    assert.equal(result.objective.pairwiseHammingSum, 16);
    assert.ok(Math.abs(result.objective.dBin - 2 / 3) < 1e-12);
    assert.equal(result.method, SUBSET_SELECTION_METHOD);
  });

  // 兩份方案：D_bin = 2/(2·1) · 4/10 = 0.4。b 是分母，變大時 D_bin 等比例變小。
  test('DS1b 兩份方案，且 b 只影響縮放', () => {
    const input = { baseSelection: set('abcd'), axes: [{ archetype: 'easy', candidates: [cand('abef')] }] };

    assert.ok(Math.abs(selectDiverseSubset({ ...input, b: 10 }).objective.dBin - 0.4) < 1e-12);
    assert.ok(Math.abs(selectDiverseSubset({ ...input, b: 20 }).objective.dBin - 0.2) < 1e-12);
  });

  test('DS1c dBinFromHammingSum 四份方案', () => {
    // 6 對、合計 30、b = 10 → 2/(4·3) · 30/10 = 0.5
    assert.ok(Math.abs(dBinFromHammingSum(30, 4, 10) - 0.5) < 1e-12);
  });
});

describe('DS-B 邊界定義', () => {
  // 只有 S₀ 時公式分母為 0。回 null（未定義）而不是 0——0 會被讀成「完全沒有差異」。
  test('DS-B1 只有 S₀ → dBin 為 null', () => {
    const result = selectDiverseSubset({
      baseSelection: set('abcd'),
      // 只換一門課，與 S₀ 的 replacementDistance = 1，不可入選。
      axes: [{ archetype: 'easy', candidates: [cand('abce')] }],
      b: 5,
    });

    assert.equal(result.objective.planCount, 1);
    assert.equal(result.objective.dBin, null);
    assert.deepEqual(result.chosen, []);
  });

  test('DS-B2 b = 0 且沒有候選 → 不丟例外', () => {
    const result = selectDiverseSubset({ baseSelection: new Set(), axes: [], b: 0 });

    assert.deepEqual(result.chosen, []);
    assert.deepEqual(result.dropped, []);
    assert.equal(result.objective.dBin, null);
    assert.equal(result.evaluated, 1);
  });

  // 有候選就必有競爭課號；b 不是正數代表呼叫端算錯了，寧可大聲失敗也不要除以零。
  test('DS-B3 有候選但 b 不是正數 → RangeError', () => {
    const axes = [{ archetype: 'easy', candidates: [cand('abef')] }];
    for (const b of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, undefined]) {
      assert.throws(() => selectDiverseSubset({ baseSelection: set('abcd'), axes, b }), RangeError, `b=${b}`);
    }
  });

  // 沒有候選的主軸不是「被選擇器捨棄」，原因由呼叫端依求解狀態回報。
  test('DS-B4 候選為空的主軸不出現在 dropped', () => {
    const result = selectDiverseSubset({
      baseSelection: set('abcd'),
      axes: [
        { archetype: 'easy', candidates: [] },
        { archetype: 'compact', candidates: [cand('abef')] },
      ],
      b: 6,
    });

    assert.deepEqual(result.chosen.map(item => item.archetype), ['compact']);
    assert.deepEqual(result.dropped, []);
  });

  test('DS-B5 候選缺 candidateId → TypeError', () => {
    assert.throws(() => selectDiverseSubset({
      baseSelection: set('abcd'),
      axes: [{ archetype: 'easy', candidates: [{ selectedKeys: set('abef'), ratio: 1 }] }],
      b: 6,
    }), TypeError);
  });
});

describe('DS2 限制與字典序', () => {
  test('DS2 任兩份 replacementDistance < 2 的組合不會被選', () => {
    // interest 與 compact 各自離 S₀ 夠遠，但兩者只差一門課（f ↔ g）。
    const result = selectDiverseSubset({
      baseSelection: set('abcd'),
      axes: [
        { archetype: 'interest', candidates: [cand('abef')] },
        { archetype: 'compact', candidates: [cand('abeg')] },
      ],
      b: 7,
    });

    assert.equal(result.chosen.length, 1);
    assert.equal(result.objective.planCount, 2);
  });

  // D_bin 是平均值，不同 |S| 不可比。先比方案數：四份彼此差異小的組合，
  // 勝過三份彼此差異大的組合。
  test('DS2b 方案數優先於 D_bin', () => {
    const base = set('abcdef');
    const axes = [
      // easy 有兩個候選：`abcdgh` 與其他兩軸都相容（可湊成四份方案）；
      // `abefim` 與 interest 只差一門（m ↔ j），選它就只剩三份。
      { archetype: 'easy', candidates: [cand('abcdgh'), cand('abefim')] },
      { archetype: 'interest', candidates: [cand('abefij')] },
      { archetype: 'compact', candidates: [cand('cdefkl')] },
    ];

    const result = selectDiverseSubset({ baseSelection: base, axes, b: 14 });

    assert.equal(result.objective.planCount, 4);
    assert.equal(result.chosen.find(item => item.archetype === 'easy').candidateId, cand('abcdgh').candidateId);
  });

  test('DS2c S₀ 一定在：chosen 不含 base，planCount 含 base', () => {
    const result = selectDiverseSubset({
      baseSelection: set('abcd'),
      axes: [{ archetype: 'easy', candidates: [cand('abef')] }],
      b: 6,
    });

    assert.equal(result.objective.planCount, result.chosen.length + 1);
  });

  test('DS2d 輸出依 canonical 順序，不依輸入順序', () => {
    const result = selectDiverseSubset({
      baseSelection: set('abcd'),
      axes: [
        { archetype: 'compact', candidates: [cand('cdgh')] },
        { archetype: 'interest', candidates: [cand('abef')] },
        { archetype: 'easy', candidates: [cand('adij')] },
      ],
      b: 10,
    });

    assert.deepEqual(result.chosen.map(item => item.archetype), ['easy', 'interest', 'compact']);
    assert.deepEqual(CANONICAL_ARCHETYPE_ORDER, ['easy', 'challenge', 'interest', 'compact']);
  });
});

describe('DS3 衝突時捨棄對的那一條', () => {
  // interest 與 compact 互相衝突（只差一門），只能留一條。
  //   留 interest {a,b,e,f}：換兩門，與 S₀ 的 hamming = 4
  //   留 compact  {a,e,f,g}：換三門，與 S₀ 的 hamming = 6
  // 舊挑選器依主軸順序會留 interest（排在前面）；新選擇器留 hamming 較大的 compact。
  const base = set('abcd');
  const interest = cand('abef', 9);
  const compact = cand('aefg', 1);

  test('DS3 留下使 D_bin 較高的主軸，並回報 conflictsWith', () => {
    const result = selectDiverseSubset({
      baseSelection: base,
      axes: [
        { archetype: 'interest', candidates: [interest] },
        { archetype: 'compact', candidates: [compact] },
      ],
      b: 7,
    });

    assert.deepEqual(result.chosen, [{ archetype: 'compact', candidateId: compact.candidateId }]);
    assert.deepEqual(result.dropped, [{ archetype: 'interest', conflictsWith: ['compact'] }]);
  });

  test('DS3b 與 S₀ 太像時 conflictsWith 含 base', () => {
    const result = selectDiverseSubset({
      baseSelection: base,
      axes: [{ archetype: 'easy', candidates: [cand('abce')] }],
      b: 5,
    });

    assert.deepEqual(result.dropped, [{ archetype: 'easy', conflictsWith: ['base'] }]);
  });

  // 不變式：方案數是第一順位，所以被捨棄主軸的候選一定與已選組合中的某份衝突。
  test('DS3c 隨機案例中 conflictsWith 永遠非空', () => {
    const random = rng(20261001);
    const letters = 'abcdefghij'.split('');
    for (let round = 0; round < 200; round += 1) {
      const pick = () => shuffled(letters, random).slice(0, 4).join('');
      const axes = ['easy', 'interest', 'compact'].map(archetype => ({
        archetype,
        candidates: Array.from({ length: 1 + Math.floor(random() * 3) }, () => cand(pick(), random())),
      }));
      const result = selectDiverseSubset({ baseSelection: set(pick()), axes, b: letters.length });
      for (const item of result.dropped) {
        assert.ok(item.conflictsWith.length > 0, `round ${round}`);
      }
    }
  });
});

describe('DS4 窮舉等於獨立暴力實作', () => {
  test('DS4 300 組固定 seed 的隨機小池', () => {
    const random = rng(424242);
    const letters = 'abcdefghijkl'.split('');
    for (let round = 0; round < 300; round += 1) {
      const pick = () => shuffled(letters, random).slice(0, 5).join('');
      const base = set(pick());
      const axes = ['easy', 'interest', 'compact'].map(archetype => ({
        archetype,
        candidates: Array.from({ length: Math.floor(random() * 4) }, () => cand(pick(), random())),
      }));
      const expected = bruteForceObjective(base, axes);
      const result = selectDiverseSubset({ baseSelection: base, axes, b: letters.length });

      assert.equal(result.objective.planCount, expected.planCount, `round ${round} planCount`);
      assert.equal(result.objective.pairwiseHammingSum, expected.sum, `round ${round} sum`);
      const space = axes.reduce((count, axis) => (
        count * (new Set(axis.candidates.map(item => item.candidateId)).size + 1)
      ), 1);
      assert.equal(result.evaluated, space, `round ${round} evaluated`);
      assert.ok(result.feasible >= 1 && result.feasible <= result.evaluated);
    }
  });
});

describe('DS5 結果與輸入順序無關', () => {
  function assertOrderIndependent(base, axes, b, label) {
    const reference = selectDiverseSubset({ baseSelection: base, axes, b });
    const random = rng(7);
    for (let round = 0; round < 40; round += 1) {
      const permuted = shuffled(axes, random).map(axis => ({
        ...axis, candidates: shuffled(axis.candidates, random),
      }));
      const result = selectDiverseSubset({ baseSelection: base, axes: permuted, b });
      assert.deepEqual(result.chosen, reference.chosen, `${label} chosen #${round}`);
      assert.deepEqual(result.dropped, reference.dropped, `${label} dropped #${round}`);
      assert.deepEqual(result.objective, reference.objective, `${label} objective #${round}`);
    }
    return reference;
  }

  test('DS5 一般案例', () => {
    assertOrderIndependent(set('abcd'), [
      { archetype: 'easy', candidates: [cand('adij', 2), cand('abij', 3)] },
      { archetype: 'interest', candidates: [cand('abef', 1), cand('cdef', 1.5)] },
      { archetype: 'compact', candidates: [cand('cdgh', 4), cand('abgh', 2)] },
    ], 10, '一般');
  });

  // interest 與 compact 互斥、與 S₀ 的 hamming 相同 → D_bin 平手，由 canonical 納入向量決定。
  test('DS5b D_bin 平手：canonical 順序在前的主軸勝出', () => {
    const reference = assertOrderIndependent(set('abcd'), [
      { archetype: 'compact', candidates: [cand('abeg')] },
      { archetype: 'interest', candidates: [cand('abef')] },
    ], 7, 'D_bin 平手');

    assert.deepEqual(reference.chosen.map(item => item.archetype), ['interest']);
  });

  // 同一主軸兩個候選，D_bin 相同、比值不同 → 比值高者；比值也相同 → candidateId 小者。
  test('DS5c ratio 平手與 ratio 決勝', () => {
    const higher = assertOrderIndependent(set('abcd'), [
      { archetype: 'easy', candidates: [cand('abef', 1), cand('abgh', 2)] },
    ], 8, 'ratio 決勝');
    assert.equal(higher.chosen[0].candidateId, cand('abgh').candidateId);

    const tied = assertOrderIndependent(set('abcd'), [
      { archetype: 'easy', candidates: [cand('abgh', 2), cand('abef', 2)] },
    ], 8, 'ratio 平手');
    assert.equal(tied.chosen[0].candidateId, cand('abef').candidateId);
  });

  // 課號集合相同、比值相同、只差班次：只看課號集合分不出來，candidateId 含班次所以分得出來。
  test('DS5d 同課號集合同 ratio、只差班次', () => {
    const reference = assertOrderIndependent(set('abcd'), [
      { archetype: 'easy', candidates: [cand('abef', 2, '12,31'), cand('abef', 2, '12,30')] },
    ], 6, '只差班次');

    assert.equal(reference.chosen[0].candidateId, 'a,b,e,f|12,30');
  });

  // pairwiseHammingSum 只差 2（b 很大時換算成 D_bin 的差距遠小於任何合理的浮點容差）。
  // 用整數比較才不會被當成平手、進而讓結果取決於比較順序。
  test('DS5e D_bin 近似平手仍以整數決勝', () => {
    const base = set('abcd');
    const near = cand('abef', 100);      // 與 S₀ hamming = 4
    const farther = cand('aefg', 1);     // 與 S₀ hamming = 6
    const reference = assertOrderIndependent(base, [
      { archetype: 'easy', candidates: [near, farther] },
    ], 1e15, '近似平手');

    assert.equal(reference.chosen[0].candidateId, farther.candidateId);
    assert.ok(Math.abs(reference.objective.dBin - dBinFromHammingSum(4, 2, 1e15)) < 1e-12);
  });

  test('DS5f 重複的 candidateId 去重後結果不變', () => {
    const base = set('abcd');
    const once = selectDiverseSubset({
      baseSelection: base, axes: [{ archetype: 'easy', candidates: [cand('abef', 2)] }], b: 6,
    });
    const twice = selectDiverseSubset({
      baseSelection: base,
      axes: [{ archetype: 'easy', candidates: [cand('abef', 2), cand('abef', 2), cand('abef', 2)] }],
      b: 6,
    });

    assert.deepEqual(twice.chosen, once.chosen);
    assert.equal(twice.evaluated, once.evaluated);
  });

  test('DS5g 同輸入跑兩次結果相同', () => {
    const input = {
      baseSelection: set('abcd'),
      axes: [
        { archetype: 'interest', candidates: [cand('abef'), cand('cdef')] },
        { archetype: 'compact', candidates: [cand('cdgh')] },
      ],
      b: 8,
    };
    assert.deepEqual(selectDiverseSubset(input), selectDiverseSubset(input));
  });
});
