// roadmap #10 任務 4：探索清單的文字相似度與挑選（Pardos & Jiang 2020 的 BOW 與式 (4)）。
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildTfIdfIndex,
  cosineSimilarity,
  rankSerendipitous,
  sharedPhrases,
  sharedTerms,
  STOP_TERM_DOCUMENT_RATIO,
  tokenizeDescription,
} from '../src/skills/courseExploration.js';

const doc = (catalogCourseCode, description) => ({ catalogCourseCode, description });

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

describe('EX1 斷詞', () => {
  test('EX1 中文取相鄰兩字，英數字串整個當一個 term', () => {
    assert.deepEqual(tokenizeDescription('資料庫 SQL'), ['sql', '資料', '料庫']);
  });

  test('EX1b 標點與空白不產生 term，也不跨過去接成 bigram', () => {
    assert.deepEqual(tokenizeDescription('網路。安全'), ['網路', '安全']);
  });

  // 對應論文 §4.1 的 "removing generic, often-seen sentences"。
  test('EX1c 開頭的「課程：課名。」套語被去掉', () => {
    assert.deepEqual(tokenizeDescription('課程：資料庫系統。網路'), ['網路']);
  });

  // 對應論文的停用詞移除：含虛詞的 bigram 幾乎都是跨詞碎片。
  test('EX1d 含虛詞的 bigram 不計', () => {
    assert.deepEqual(tokenizeDescription('網路的安全'), ['網路', '安全']);
  });

  test('EX1e 英數 term 轉小寫，保留 c# 與 c++', () => {
    assert.deepEqual(tokenizeDescription('Python C# C++'), ['python', 'c#', 'c++']);
  });
});

describe('EX2 tf-idf 與 cosine', () => {
  // 三份文件、term 各只出現在部分文件：
  //   A = 網路 安全        B = 網路 程式        C = 資料 程式 程式
  // 用九份「填充」文件把 N 撐到 12，讓每個 term 的 df 比例（最多 2/12）都低於停用門檻。
  const N = 12;
  const filler = ['甲乙', '丙丁', '戊己', '庚辛', '壬癸', '子丑', '寅卯', '辰巳', '午未'].map((text, index) => doc(`F${index}`, text));
  const index = buildTfIdfIndex([
    doc('A', '網路。安全'),
    doc('B', '網路。程式'),
    doc('C', '資料。程式。程式'),
    ...filler,
  ]);

  test('EX2 權重是 tf × ln(N/df)', () => {
    // 網路：df = 2 → ln(N/2)；安全：df = 1 → ln(N)
    const a = index.vectors.get('A').weights;
    assert.ok(Math.abs(a.get('網路') - Math.log(N / 2)) < 1e-12);
    assert.ok(Math.abs(a.get('安全') - Math.log(N)) < 1e-12);
    // 程式在 C 出現兩次：tf = 2
    assert.ok(Math.abs(index.vectors.get('C').weights.get('程式') - 2 * Math.log(N / 2)) < 1e-12);
  });

  test('EX2b cosine 手算對照', () => {
    const idfShared = Math.log(N / 2);
    const idfRare = Math.log(N);
    // A·B 只有「網路」重疊；兩者的 norm 都是 sqrt(idfShared² + idfRare²)… B 的另一項是程式（df 2）。
    const normA = Math.hypot(idfShared, idfRare);
    const normB = Math.hypot(idfShared, idfShared);
    const expected = (idfShared * idfShared) / (normA * normB);
    assert.ok(Math.abs(cosineSimilarity(index.vectors.get('A'), index.vectors.get('B')) - expected) < 1e-12);
    assert.equal(cosineSimilarity(index.vectors.get('A'), index.vectors.get('C')), 0);
    assert.ok(Math.abs(cosineSimilarity(index.vectors.get('A'), index.vectors.get('A')) - 1) < 1e-12);
  });

  test('EX2c 出現在太多課程裡的 term 不計', () => {
    const many = Array.from({ length: 10 }, (_, i) => doc(`M${i}`, `學習。主題${'甲乙丙丁戊己庚辛壬癸'[i]}`));
    const built = buildTfIdfIndex(many);
    // 「學習」在 10/10 份文件中，比例 1 > 門檻。
    assert.ok(1 > STOP_TERM_DOCUMENT_RATIO);
    assert.equal(built.vectors.get('M0').weights.has('學習'), false);
  });

  // 開班多的課不該因為班次多而佔更多權重。
  test('EX2d 同課號多個班次只算一份文件', () => {
    const built = buildTfIdfIndex([doc('A', '網路。安全'), doc('A', '網路。安全'), doc('A', '網路'), doc('B', '程式')]);
    assert.equal(built.documentCount, 2);
    // 取說明最長的那一份。
    assert.equal(built.descriptions.get('A'), '網路。安全');
  });

  test('EX2e 沒有說明或沒有課號的課不進索引', () => {
    const built = buildTfIdfIndex([doc('A', ''), doc('', '網路'), doc('B', '程式')]);
    assert.deepEqual([...built.vectors.keys()], ['B']);
  });
});

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

  test('EX3 每個 unit 只出一門，且是該 unit 內 cosine 最大者', () => {
    const { diversified, items } = rankSerendipitous({ favoriteVector: favorite, candidates, unitOf, k: 5 });

    assert.equal(diversified, true);
    assert.deepEqual(items.map(item => item.courseCode), ['X1', 'Y2']);
    assert.ok(Math.abs(items[0].similarity - 1) < 1e-12);
    assert.ok(Math.abs(items[1].similarity - Math.SQRT1_2) < 1e-12);
  });

  // 沒有任何共同 term 的課不算「相關」，不拿來湊數。
  test('EX3b cosine 為 0 的課不列入', () => {
    const { items } = rankSerendipitous({ favoriteVector: favorite, candidates, unitOf, k: 5 });
    assert.equal(items.some(item => item.courseCode === 'Z1'), false);
  });

  test('EX3c k 截斷', () => {
    const { items } = rankSerendipitous({ favoriteVector: favorite, candidates, unitOf, k: 1 });
    assert.deepEqual(items.map(item => item.courseCode), ['X1']);
  });

  // 115 學年度起通識不分領域：有任何一門沒有 unit，整組就不分散。
  test('EX3d unitOf 回傳 null 時不做單位分散，直接取最相似的 k 門', () => {
    const { diversified, items } = rankSerendipitous({
      favoriteVector: favorite, candidates, unitOf: () => null, k: 3,
    });

    assert.equal(diversified, false);
    assert.deepEqual(items.map(item => item.courseCode), ['X1', 'X2', 'Y2']);
  });

  test('EX3e 平手依課號，且結果與輸入順序無關', () => {
    const reference = rankSerendipitous({ favoriteVector: favorite, candidates, unitOf: () => null, k: 5 });
    // X2 與 Y2 的 cosine 相同（0.707），課號小的排前面。
    assert.deepEqual(reference.items.map(item => item.courseCode), ['X1', 'X2', 'Y2', 'Y1']);

    const random = rng(18);
    for (let round = 0; round < 30; round += 1) {
      const permuted = shuffled(candidates, random);
      for (const fn of [unitOf, () => null]) {
        const base = rankSerendipitous({ favoriteVector: favorite, candidates, unitOf: fn, k: 5 });
        const again = rankSerendipitous({ favoriteVector: favorite, candidates: permuted, unitOf: fn, k: 5 });
        assert.deepEqual(again.items.map(item => item.courseCode), base.items.map(item => item.courseCode));
      }
    }
  });

  test('EX3f 沒有候選時回傳空清單', () => {
    assert.deepEqual(rankSerendipitous({ favoriteVector: favorite, candidates: [], unitOf }), {
      diversified: false, items: [],
    });
  });
});

describe('EX4 共同字詞（只用於顯示）', () => {
  const filler = Array.from({ length: 12 }, (_, i) => doc(`F${i}`, `填充${'甲乙丙丁戊己庚辛壬癸子丑'[i]}文`));
  const leftText = '介紹人工智慧。機器學習方法';
  const rightText = '人工智慧應用。機器學習實務';
  const index = buildTfIdfIndex([doc('L', leftText), doc('R', rightText), ...filler]);
  const left = index.vectors.get('L');
  const right = index.vectors.get('R');

  test('EX4 sharedTerms 回傳兩邊都有的 term', () => {
    const terms = sharedTerms(left, right, 20);
    assert.ok(terms.includes('人工') && terms.includes('智慧') && terms.includes('機器'));
    assert.equal(terms.includes('介紹'), false);
  });

  // 每一步延伸都要求兩份原文同時包含，所以不會拼出原文沒有的詞。
  test('EX4b sharedPhrases 把 bigram 接回原文裡真的出現過的片語', () => {
    const phrases = sharedPhrases(left, right, { leftText, rightText, limit: 5 });

    assert.ok(phrases.includes('人工智慧'), phrases.join('、'));
    assert.ok(phrases.includes('機器學習'), phrases.join('、'));
    for (const phrase of phrases) {
      assert.ok(leftText.includes(phrase) && rightText.includes(phrase), phrase);
    }
  });

  test('EX4c 被判定為通用句型的片語不列出', () => {
    const phrases = sharedPhrases(left, right, {
      leftText, rightText, limit: 5, isCommonPhrase: phrase => phrase === '人工智慧',
    });
    assert.equal(phrases.includes('人工智慧'), false);
  });

  test('EX4d phraseDocumentRatio 以子字串比對計算', () => {
    assert.ok(Math.abs(index.phraseDocumentRatio('人工智慧') - 2 / 14) < 1e-12);
    assert.equal(index.phraseDocumentRatio('不存在的詞'), 0);
  });
});
