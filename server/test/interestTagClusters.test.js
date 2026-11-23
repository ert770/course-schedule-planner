import { describe, test, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  clusterKey,
  lookupTagClusters,
  setInterestTagClustersForTests,
  validateClusters,
} from '../src/data/interestTagClusters.js';
import { toClusters } from '../scripts/buildInterestTagClusters.js';

// 預算分群的查表與驗證（設計稿 2026-11-22 三層沙漏）。不連資料庫、不呼叫模型。

const tag = (id, courseCount) => ({ tagId: id, name: `名${id}`, courseCount });
const TAGS = [tag('t1', 9), tag('t2', 7), tag('t3', 5), tag('t4', 4), tag('t5', 3), tag('t6', 2), tag('t7', 1)];
const IDS = TAGS.map(item => item.tagId);
const GOOD = [
  { clusterId: 'c1', label: '外語學習', tagIds: ['t3', 't1'] },
  { clusterId: 'c2', label: '文學閱讀', tagIds: ['t2', 't4', 't5'] },
  { clusterId: 'other', label: '其他', tagIds: ['t6', 't7'] },
];

describe('預算分群：驗證', () => {
  test('TC1 完整的分群通過', () => {
    assert.deepEqual(validateClusters(GOOD, IDS), { ok: true });
  });

  test('TC2 漏掉、重複、多出、群數不對、群太小、群名不可用都不通過', () => {
    assert.equal(validateClusters(GOOD.slice(0, 2), IDS).reason, 'missing_tag');
    assert.equal(validateClusters([...GOOD, { clusterId: 'c3', label: 'x', tagIds: ['t1'] }], IDS).reason, 'duplicate_tag');
    assert.equal(validateClusters([{ ...GOOD[0], tagIds: ['t1', 't3', 'tX'] }, ...GOOD.slice(1)], IDS).reason, 'unknown_tag');
    assert.equal(validateClusters([{ clusterId: 'c1', label: '全部', tagIds: IDS }], IDS).reason, 'cluster_count_1');
    assert.equal(validateClusters([
      { clusterId: 'c1', label: 'a', tagIds: ['t1'] },
      { clusterId: 'c2', label: 'b', tagIds: ['t2', 't3', 't4', 't5', 't6', 't7'] },
    ], IDS).reason, 'cluster_too_small');
    assert.equal(validateClusters([{ ...GOOD[0], label: '' }, ...GOOD.slice(1)], IDS).reason, 'bad_label');
  });

  test('TC3 鍵只看方向與標籤集合，與順序無關', () => {
    assert.equal(clusterKey('main_a', ['t2', 't1']), clusterKey('main_a', ['t1', 't2']));
    assert.notEqual(clusterKey('main_a', ['t1', 't2']), clusterKey('main_b', ['t1', 't2']));
    assert.notEqual(clusterKey('main_a', ['t1', 't2']), clusterKey('main_a', ['t1', 't2', 't3']));
  });
});

describe('預算分群：查表', () => {
  afterEach(() => setInterestTagClustersForTests({ entries: {} }));

  test('TC4 命中時回傳群，群內依課程數排序並帶完整標籤資料', () => {
    setInterestTagClustersForTests({ entries: { [clusterKey('main_a', IDS)]: { clusters: GOOD } } });
    const result = lookupTagClusters('main_a', TAGS);
    assert.deepEqual(result.map(cluster => cluster.label), ['外語學習', '文學閱讀', '其他']);
    assert.deepEqual(result[0].tags.map(item => item.tagId), ['t1', 't3']);
    assert.equal(result[0].tags[0].courseCount, 9);
  });

  test('TC5 候選池的標籤變了（多一個或少一個），查不到，交給呼叫端退回完整清單', () => {
    setInterestTagClustersForTests({ entries: { [clusterKey('main_a', IDS)]: { clusters: GOOD } } });
    assert.equal(lookupTagClusters('main_a', TAGS.slice(0, 6)), null);
    assert.equal(lookupTagClusters('main_a', [...TAGS, tag('t8', 1)]), null);
    assert.equal(lookupTagClusters('main_other', TAGS), null);
  });

  test('TC6 存檔內容與鍵對不上（群員不完整）時不使用，也不把漏掉的標籤塞進「其他」', () => {
    setInterestTagClustersForTests({ entries: { [clusterKey('main_a', IDS)]: { clusters: GOOD.slice(0, 2) } } });
    assert.equal(lookupTagClusters('main_a', TAGS), null);
  });
});

describe('預算分群：模型輸出轉換', () => {
  test('TC7 編號轉成標籤 ID，「其他」用固定 ID，編號超出範圍的丟掉（之後驗證會判定不完整）', () => {
    const clusters = toClusters({
      clusters: [
        { label: '外語學習', refs: [1, 3] },
        { label: '其他', refs: [6, 7] },
        { label: '文學閱讀', refs: [2, 4, 5, 99] },
      ],
    }, TAGS);
    assert.deepEqual(clusters.map(cluster => [cluster.clusterId, cluster.tagIds]), [
      ['c1', ['t1', 't3']], ['other', ['t6', 't7']], ['c2', ['t2', 't4', 't5']],
    ]);
    assert.equal(validateClusters(clusters, IDS).ok, true);
    assert.equal(validateClusters(toClusters({ clusters: [{ label: 'a', refs: [1, 2] }, { label: 'b', refs: [3, 4] }] }, TAGS), IDS).reason, 'missing_tag');
  });
});
