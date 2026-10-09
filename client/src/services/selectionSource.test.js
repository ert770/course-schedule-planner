import assert from 'node:assert/strict';
import test from 'node:test';
import { EXPLORATION_SOURCE, resolveSelectionSource } from './selectionSource.js';

test('沒有覆寫值時沿用原本的判定', () => {
  assert.equal(resolveSelectionSource('explicit_selection', undefined), 'explicit_selection');
  assert.equal(resolveSelectionSource('system_recommendation', undefined), 'system_recommendation');
});

test('從探索清單加入的課標為 exploration', () => {
  assert.equal(EXPLORATION_SOURCE, 'exploration');
  assert.equal(resolveSelectionSource('explicit_selection', 'exploration'), 'exploration');
  assert.equal(resolveSelectionSource('system_recommendation', 'exploration'), 'exploration');
});

// 頁面不能藉由覆寫值把課標成必修或系統推薦。
test('exploration 以外的覆寫值一律忽略', () => {
  for (const override of ['required', 'system_recommendation', 'explicit_selection', 'anything', '', null, 42]) {
    assert.equal(resolveSelectionSource('explicit_selection', override), 'explicit_selection', String(override));
  }
});

test('排課引擎判定為本人必修的課不會被改標', () => {
  assert.equal(resolveSelectionSource('required', 'exploration'), 'required');
});
