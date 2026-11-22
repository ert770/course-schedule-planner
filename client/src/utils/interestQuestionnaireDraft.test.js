import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  allEffectiveDirections,
  buildConfirmDraft,
  directionKey,
  effectiveDirections,
  finalizeSelections,
  isDetailStillValid,
  savedDirectionsFrom,
  setTopicChecked,
  toggleDirection,
  toggleTopic,
  visibleTopics,
} from './interestQuestionnaireDraft.js';

const dir = (group, categoryId, extra = {}) => ({ group, categoryId, aliasIds: [], title: categoryId, level: 'main', ...extra });

test('QD1 方向不限數量（2026-11-22 拿掉兩項上限），換一組前選的仍保留；再點一次取消', () => {
  let selected = [];
  for (const id of ['a', 'b', 'c', 'd']) selected = toggleDirection(selected, dir('outside', id));
  assert.deepEqual(selected.map(item => item.categoryId), ['a', 'b', 'c', 'd']);
  assert.deepEqual(toggleDirection(selected, dir('outside', 'a')).map(item => item.categoryId), ['b', 'c', 'd']);
});

test('QD2 併過的選項以別名比對，已存的子類別 ID 視為同一個方向', () => {
  const saved = dir('department', 'sub_old');
  const option = dir('department', 'sub_new', { aliasIds: ['sub_old'] });
  assert.deepEqual(toggleDirection([saved], option), []);
});

test('QD3 細項同樣不限數量', () => {
  assert.deepEqual(toggleTopic(['t1', 't2'], 't3'), ['t1', 't2', 't3']);
  assert.deepEqual(toggleTopic(['t1', 't2'], 't1'), ['t2']);
});

test('QD4 還沒答與略過都沿用已保存的方向；作答後才以作答結果為準', () => {
  const saved = savedDirectionsFrom([{ group: 'outside', categoryId: 'a', tagIds: ['t1'] }], {
    directions: [{ group: 'outside', categoryId: 'a', title: '語言', categoryLabel: '語言、文學與溝通', available: true }],
  });
  assert.equal(saved[0].title, '語言');
  assert.deepEqual(effectiveDirections('outside', {}, saved).map(item => item.categoryId), ['a']);
  assert.deepEqual(effectiveDirections('outside', { outside: { status: 'skipped', selected: [] } }, saved).map(item => item.categoryId), ['a']);
  assert.deepEqual(effectiveDirections('outside', { outside: { status: 'answered', selected: [] } }, saved), []);
});

test('QD5 有效方向依本系、通識、系外與被選順序排列', () => {
  const answers = {
    outside: { status: 'answered', selected: [dir('outside', 'o1')] },
    department: { status: 'answered', selected: [dir('department', 'd2'), dir('department', 'd1')] },
  };
  assert.deepEqual(allEffectiveDirections(answers, []).map(item => item.categoryId), ['d2', 'd1', 'o1']);
});

test('QD6 上一題修改後不再包含追問所依據的方向，追問答案從摘要移除', () => {
  const detail = { target: { group: 'outside', categoryId: 'a' }, shown: [{ tagId: 't1', name: '日文' }], selected: ['t1'], skipped: false };
  assert.equal(isDetailStillValid(detail, [dir('outside', 'a')]), true);
  assert.equal(isDetailStillValid(detail, [dir('outside', 'b')]), false);
  const draft = buildConfirmDraft({ directions: [dir('outside', 'b')], detail });
  assert.deepEqual(draft.topics, []);
});

test('QD7 寬泛方向不展開：只選方向、略過追問時，tagIds 為空，看過的細項列出但不勾', () => {
  const detail = { target: { group: 'outside', categoryId: 'a' }, shown: [{ tagId: 't1', name: '日文' }, { tagId: 't2', name: '韓文' }], selected: [], skipped: true };
  const draft = buildConfirmDraft({ directions: [dir('outside', 'a')], detail });
  assert.deepEqual(draft.topics.map(topic => [topic.tagId, topic.checked]), [['t1', false], ['t2', false]]);
  assert.deepEqual(finalizeSelections(draft, new Set()), [{ group: 'outside', categoryId: 'a', level: 'main', mode: 'followup', tagIds: [] }]);
});

test('QD8 確認的細項寫進對應方向；細項頁預先勾好的已存主題保留', () => {
  // 細項頁會預先勾好已存的 t9，所以作答結果包含 t9。
  const detail = { target: { group: 'outside', categoryId: 'a' }, shown: [{ tagId: 't9', name: '西班牙文' }, { tagId: 't2', name: '韓文' }], selected: ['t9', 't2'], skipped: false };
  const draft = buildConfirmDraft({
    directions: [dir('outside', 'a')],
    savedSelections: [{ group: 'outside', categoryId: 'a', tagIds: ['t9'] }],
    savedTopicNames: new Map([['t9', '西班牙文']]),
    detail,
  });
  assert.deepEqual(finalizeSelections(draft, new Set())[0].tagIds, ['t9', 't2']);
});

test('QD9 明確移除可撤回；移除單一方向時，其他方向確認的共用標籤保留', () => {
  const directions = [dir('generalEducation', 'g'), dir('outside', 'o')];
  const draft = buildConfirmDraft({
    directions,
    savedSelections: [
      { group: 'generalEducation', categoryId: 'g', tagIds: ['shared'] },
      { group: 'outside', categoryId: 'o', tagIds: ['shared'] },
    ],
    savedTopicNames: new Map([['shared', '日文']]),
  });
  // 同一標籤由兩組選到：畫面只列一項。
  assert.equal(visibleTopics(draft, new Set()).length, 1);

  const removed = new Set([directionKey('outside', 'o')]);
  assert.deepEqual(finalizeSelections(draft, removed), [
    { group: 'generalEducation', categoryId: 'g', level: 'main', mode: 'followup', tagIds: ['shared'] },
  ]);
  // 撤回：移出 removed 集合即恢復。
  assert.equal(finalizeSelections(draft, new Set()).length, 2);
});

test('QD10 取消勾選一個主題會在所有方向底下一起取消，可再勾回', () => {
  const draft = buildConfirmDraft({
    directions: [dir('generalEducation', 'g'), dir('outside', 'o')],
    savedSelections: [
      { group: 'generalEducation', categoryId: 'g', tagIds: ['shared'] },
      { group: 'outside', categoryId: 'o', tagIds: ['shared'] },
    ],
  });
  const unchecked = setTopicChecked(draft, 'shared', false);
  assert.deepEqual(finalizeSelections(unchecked, new Set()).map(item => item.tagIds), [[], []]);
  const rechecked = setTopicChecked(unchecked, 'shared', true);
  assert.deepEqual(finalizeSelections(rechecked, new Set()).map(item => item.tagIds), [['shared'], ['shared']]);
});

test('QD11 只有一個有效細項的方向，在確認頁列為可勾選、預設不勾', () => {
  const draft = buildConfirmDraft({
    directions: [dir('generalEducation', 'g')],
    checkableTopics: [{ group: 'generalEducation', categoryId: 'g', tagId: 'only', name: '永續' }],
  });
  assert.deepEqual(draft.topics.map(topic => [topic.tagId, topic.checked]), [['only', false]]);
});

test('QD12 三組各自的追問答案都會寫進各自的方向；某組方向被改掉時只移除那一組的追問答案', () => {
  const details = [
    { target: { group: 'department', categoryId: 'd' }, shown: [{ tagId: 'td', name: '機器學習' }], selected: ['td'], skipped: false },
    { target: { group: 'generalEducation', categoryId: 'g' }, shown: [{ tagId: 'tg', name: '歷史' }], selected: ['tg'], skipped: false },
    { target: { group: 'outside', categoryId: 'o' }, shown: [{ tagId: 'to', name: '日語' }], selected: ['to'], skipped: false },
  ];
  const all = buildConfirmDraft({
    directions: [dir('department', 'd', { level: 'sub' }), dir('generalEducation', 'g'), dir('outside', 'o')],
    details,
  });
  assert.deepEqual(finalizeSelections(all, new Set()).map(item => [item.group, item.tagIds]), [
    ['department', ['td']], ['generalEducation', ['tg']], ['outside', ['to']],
  ]);
  const changed = buildConfirmDraft({ directions: [dir('department', 'd', { level: 'sub' }), dir('outside', 'o')], details });
  assert.deepEqual(changed.topics.map(topic => topic.tagId), ['td', 'to']);
});

test('QD13 細項頁有作答時以作答為準（取消勾選的已存標籤不保留）；按略過時已存標籤照舊保留', () => {
  const directions = [dir('outside', 'o')];
  const savedSelections = [{ group: 'outside', categoryId: 'o', tagIds: ['t1', 't2'] }];
  const answered = buildConfirmDraft({
    directions, savedSelections,
    details: [{ target: { group: 'outside', categoryId: 'o' }, shown: [{ tagId: 't2', name: '韓文' }], selected: ['t2'], skipped: false }],
  });
  assert.deepEqual(finalizeSelections(answered, new Set())[0].tagIds, ['t2']);
  const skipped = buildConfirmDraft({
    directions, savedSelections,
    details: [{ target: { group: 'outside', categoryId: 'o' }, shown: [], selected: [], skipped: true }],
  });
  assert.deepEqual(finalizeSelections(skipped, new Set())[0].tagIds, ['t1', 't2']);
});
