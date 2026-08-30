// Roadmap #24：待確認變更的 token 生命週期。
//
// 這是「使用者確認前不得永久寫入」這條規範的機制本體，因此邊界要釘死：
// 單次使用、會過期、雜湊比對、確認後回傳的是當初暫存的內容。

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  stagePendingChange,
  consumePendingChange,
  resetPendingChangesForTests,
} from '../src/services/pendingChangeService.js';

const identity = { canonicalId: 'S1130001' };
const other = { canonicalId: 'S1130002' };

beforeEach(() => resetPendingChangesForTests());

describe('PC1 正常的暫存與確認', () => {
  test('確認後回傳當初暫存的內容', () => {
    const { token } = stagePendingChange(identity, 'preferences', { noEveningClasses: true });

    assert.deepEqual(
      consumePendingChange(identity, 'preferences', token),
      { noEveningClasses: true }
    );
  });

  test('回傳的 expiresAt 是可讀的 ISO 時間', () => {
    const { expiresAt } = stagePendingChange(identity, 'preferences', { preferCompact: true });

    assert.ok(!Number.isNaN(Date.parse(expiresAt)));
  });

  // 暫存的是深拷貝：呼叫端之後改動同一個物件不該影響已暫存的內容。
  test('暫存內容不受呼叫端後續改動影響', () => {
    const changes = { targetCreditsMax: 20 };
    const { token } = stagePendingChange(identity, 'preferences', changes);
    changes.targetCreditsMax = 99;

    assert.deepEqual(consumePendingChange(identity, 'preferences', token), { targetCreditsMax: 20 });
  });
});

describe('PC2 單次使用', () => {
  test('同一個 token 只能確認一次', () => {
    const { token } = stagePendingChange(identity, 'preferences', { preferCompact: true });

    assert.ok(consumePendingChange(identity, 'preferences', token));
    assert.equal(consumePendingChange(identity, 'preferences', token), null, '重送不得再寫一次');
  });

  // 使用者改變主意重講一次時，舊的那筆就不該還能被確認。
  test('重新暫存會作廢舊的 token', () => {
    const first = stagePendingChange(identity, 'preferences', { preferCompact: true });
    stagePendingChange(identity, 'preferences', { preferCompact: false });

    assert.equal(consumePendingChange(identity, 'preferences', first.token), null);
  });
});

describe('PC3 同一回合內不得自己確認自己（真正的保證）', () => {
  // token 本身擋不住「模型在同一回合連續呼叫兩次工具」——使用者在那中間根本
  // 沒有機會說話。要求跨回合，等於要求使用者真的又送出了一則訊息。
  test('同一個 turnId 內確認會被拒絕', () => {
    const { token } = stagePendingChange(identity, 'preferences', { preferCompact: true }, {
      turnId: 'turn-1',
    });

    assert.equal(
      consumePendingChange(identity, 'preferences', token, { turnId: 'turn-1' }),
      null,
      '同回合自問自答不得寫入'
    );
  });

  test('換一個回合就可以確認', () => {
    const { token } = stagePendingChange(identity, 'preferences', { preferCompact: true }, {
      turnId: 'turn-1',
    });

    assert.deepEqual(
      consumePendingChange(identity, 'preferences', token, { turnId: 'turn-2' }),
      { preferCompact: true }
    );
  });

  test('同回合被拒之後暫存仍在，下一回合仍可確認', () => {
    const { token } = stagePendingChange(identity, 'preferences', { preferCompact: true }, {
      turnId: 'turn-1',
    });

    consumePendingChange(identity, 'preferences', token, { turnId: 'turn-1' });
    assert.ok(
      consumePendingChange(identity, 'preferences', token, { turnId: 'turn-2' }),
      '被同回合規則擋下不該把暫存一併作廢'
    );
  });
});

describe('PC4 過期', () => {
  test('超過 TTL 之後失效', () => {
    let clock = 1_000_000;
    const { token } = stagePendingChange(identity, 'preferences', { preferCompact: true }, {
      now: () => clock,
    });

    clock += 10 * 60 * 1000 + 1;
    assert.equal(
      consumePendingChange(identity, 'preferences', token, { now: () => clock }),
      null
    );
  });

  test('TTL 內仍然有效', () => {
    let clock = 1_000_000;
    const { token } = stagePendingChange(identity, 'preferences', { preferCompact: true }, {
      now: () => clock,
    });

    clock += 9 * 60 * 1000;
    assert.ok(consumePendingChange(identity, 'preferences', token, { now: () => clock }));
  });
});

describe('PC5 不接受不匹配的 token', () => {
  test('錯誤的 token 一律拒絕', () => {
    stagePendingChange(identity, 'preferences', { preferCompact: true });

    assert.equal(consumePendingChange(identity, 'preferences', 'not-the-token'), null);
    assert.equal(consumePendingChange(identity, 'preferences', ''), null);
    assert.equal(consumePendingChange(identity, 'preferences', undefined), null);
  });

  // token 綁定使用者與變更種類：偏好的 token 不能拿來確認身分更正。
  test('changeType 不同時不通用', () => {
    const { token } = stagePendingChange(identity, 'preferences', { preferCompact: true });

    assert.equal(consumePendingChange(identity, 'profile-scope', token), null);
  });

  test('別人的 token 不能用來改自己的資料', () => {
    const { token } = stagePendingChange(identity, 'preferences', { preferCompact: true });

    assert.equal(consumePendingChange(other, 'preferences', token), null);
  });

  test('沒有暫存過就確認一律失敗', () => {
    assert.equal(consumePendingChange(identity, 'preferences', 'anything'), null);
  });
});
