// roadmap #10 任務 4：探索清單的挑選規則（Pardos & Jiang 2020 的式 (4)）。
// 相似度由呼叫端提供；2026-11-23 起「共同用詞」（tf-idf）已移除（ADR-033），原 EX1、EX2、EX4 一併移除。
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { rankSerendipitous } from '../src/skills/courseExploration.js';

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

// 測試用相似度：稀疏向量的 cosine。
function cosine(left, right) {
  if (!left?.norm || !right?.norm) return 0;
  let dot = 0;
  for (const [term, weight] of left.weights) dot += weight * (right.weights.get(term) ?? 0);
  return dot / (left.norm * right.norm);
}

describe('EX3 式 (4)：每個 unit 取最相似的一門', () => {
  const vector = weights => {
    const map = new Map(Object.entries(weights));
    return { weights: map, norm: Math.hypot(...map.values()) };
  };
  const favorite = vector({ a: 1, b: 1 });
  const candidates = [
    { courseCode: 'X1', unit: '企管', vector: vector({ a: 1, b: 1 }) },   // cos 1
    { courseCode: 'X2', unit: '企管', vector: vector({ a: 1 }) },          // cos 0.707
    { courseCode: 'Y1', unit: '會計', vector: vector({ a: 1, c: 1 }) },    // cos 0.5
    { courseCode: 'Y2', unit: '會計', vector: vector({ b: 1 }) },          // cos 0.707
    { courseCode: 'Z1', unit: '土木', vector: vector({ c: 1 }) },          // cos 0
  ];
  const unitOf = candidate => candidate.unit;
  const rank = options => rankSerendipitous({ favoriteVector: favorite, candidates, unitOf, k: 5, similarityOf: cosine, ...options });

  test('EX3 每個 unit 只出一門，且是該 unit 內相似度最大者', () => {
    const { diversified, items } = rank();

    assert.equal(diversified, true);
    assert.deepEqual(items.map(item => item.courseCode), ['X1', 'Y2']);
    assert.ok(Math.abs(items[0].similarity - 1) < 1e-12);
    assert.ok(Math.abs(items[1].similarity - Math.SQRT1_2) < 1e-12);
  });

  // 不相關或未達門檻（相似度 ≤ 0）的課不拿來湊數。
  test('EX3b 相似度為 0 的課不列入', () => {
    assert.equal(rank().items.some(item => item.courseCode === 'Z1'), false);
  });

  test('EX3c k 截斷', () => {
    assert.deepEqual(rank({ k: 1 }).items.map(item => item.courseCode), ['X1']);
  });

  // 115 學年度起通識不分領域：有任何一門沒有 unit，整組就不分散。
  test('EX3d unitOf 回傳 null 時不做單位分散，直接取最相似的 k 門', () => {
    const { diversified, items } = rank({ unitOf: () => null, k: 3 });

    assert.equal(diversified, false);
    assert.deepEqual(items.map(item => item.courseCode), ['X1', 'X2', 'Y2']);
  });

  test('EX3e 平手依課號，且結果與輸入順序無關', () => {
    // X2 與 Y2 的相似度相同（0.707），課號小的排前面。
    assert.deepEqual(rank({ unitOf: () => null }).items.map(item => item.courseCode), ['X1', 'X2', 'Y2', 'Y1']);

    const random = rng(18);
    for (let round = 0; round < 30; round += 1) {
      const permuted = shuffled(candidates, random);
      for (const fn of [unitOf, () => null]) {
        const base = rank({ unitOf: fn });
        const again = rank({ unitOf: fn, candidates: permuted });
        assert.deepEqual(again.items.map(item => item.courseCode), base.items.map(item => item.courseCode));
      }
    }
  });

  test('EX3f 沒有候選時回傳空清單', () => {
    assert.deepEqual(rank({ candidates: [] }), { diversified: false, items: [] });
  });

  test('EX3g 呼叫端提供的相似度（含門檻）回傳 0 的課不列入', () => {
    const gated = (left, right, candidate) => (candidate.courseCode === 'X1' ? 0 : cosine(left, right));
    assert.deepEqual(rank({ similarityOf: gated }).items.map(item => item.courseCode), ['X2', 'Y2']);
  });

  test('EX3h 沒給 similarityOf 會直接報錯，不默默改用其他算法', () => {
    assert.throws(() => rankSerendipitous({ favoriteVector: favorite, candidates, unitOf }), TypeError);
  });
});
