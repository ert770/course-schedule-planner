// roadmap #15 + Codex adversarial review 修正（2026-08-20）：`POST /api/schedule/validate`
// 原本只在請求帶有非空 constraints 時才額外跑 validateScheduleAgainstConstraints()，
// 但現行唯一的實際呼叫形狀是只送 `{courses}`（`client/src` 目前完全沒有呼叫這支
// 端點，其他呼叫端可能沿用文件記載的最小形狀），導致共同必修（roadmap #15）等不
// 需要 constraints 就能檢查的規則被空 constraints 連帶跳過。這個測試檔案釘住
// 修正後的行為：即使不帶 constraints，extended 檢查一律執行。

import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { app } from '../src/app.js';
import { closePool } from '../src/db/mysql.js';
import { makeCourse } from './fixtures.js';

let server;
let baseUrl;

before(async () => {
  server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}/api`;
});

after(async () => {
  await new Promise((resolve, reject) => server.close(err => (err ? reject(err) : resolve())));
  await closePool();
});

async function postValidate(body) {
  const response = await fetch(`${baseUrl}/schedule/validate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: response.status, json: await response.json() };
}

describe('POST /api/schedule/validate（Codex adversarial review 修正）', () => {
  test('只送 {courses}（無 constraints）：extended 欄位一律出現，且非法課表不再被誤判為 valid', async () => {
    // 這門「實習」帶著 corequisiteRole／corequisiteCode 標記（模擬
    // generateSchedule() 產出的配對課表，使用者事後把正課那一半移除
    // 再送回來驗證），但候選課表裡沒有它的正課。
    const internshipOnly = {
      ...makeCourse(2, {
        catalogCourseCode: 'STAT1002P', name: '統計學(二)實習', credits: 0,
        dayOfWeek: 3, startPeriod: 5, endPeriod: 5,
      }),
      corequisiteRole: 'internship',
      corequisiteCode: 'STAT1002',
    };

    const { status, json } = await postValidate({ courses: [internshipOnly] });

    assert.equal(status, 200);
    // 修正前：省略 constraints 時完全不會出現這三個欄位。
    assert.ok('hardConstraintsValid' in json, 'hardConstraintsValid 欄位應一律出現，不受 constraints 是否為空影響');
    assert.equal(json.hardConstraintsValid, false);
    assert.ok(json.violations.some(v => v.constraintId === 'COREQUISITE_PAIR_INCOMPLETE'));
  });

  test('只送 {courses}，課表本身沒有任何共同必修課程：COREQUISITE_PAIR_INCOMPLETE 誠實列在 unchecked，不假裝檢查過', async () => {
    const plain = makeCourse(1, { catalogCourseCode: 'IECS1001', name: '一般課程' });

    const { json } = await postValidate({ courses: [plain] });

    assert.equal(json.hardConstraintsValid, true);
    assert.ok(json.unchecked.includes('COREQUISITE_PAIR_INCOMPLETE'));
  });

  test('完整配對課表（兩門課皆帶 corequisiteRole 且互相出現）：COREQUISITE_PAIR_INCOMPLETE 不觸發違規', async () => {
    const regular = {
      ...makeCourse(1, { catalogCourseCode: 'STAT1002', name: '統計學(二)' }),
      corequisiteRole: 'regular',
      corequisiteCode: 'STAT1002P',
    };
    const internship = {
      ...makeCourse(2, {
        catalogCourseCode: 'STAT1002P', name: '統計學(二)實習', credits: 0,
        dayOfWeek: 3, startPeriod: 5, endPeriod: 5,
      }),
      corequisiteRole: 'internship',
      corequisiteCode: 'STAT1002',
    };

    const { json } = await postValidate({ courses: [regular, internship] });

    assert.equal(json.hardConstraintsValid, true);
    assert.ok(!json.violations.some(v => v.constraintId === 'COREQUISITE_PAIR_INCOMPLETE'));
    assert.ok(!json.unchecked.includes('COREQUISITE_PAIR_INCOMPLETE'));
  });
});
