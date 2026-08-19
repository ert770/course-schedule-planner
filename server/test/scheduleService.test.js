// Codex adversarial review（2026-08-17）發現：評價資料查詢原本沒有獨立容錯，
// 一旦 `getAll('reviews')` reject（資料庫暫時性錯誤、schema 不同步、逾時），
// 整個排課請求會直接以 500 失敗——即使 scheduler.js 明確支援評價資料缺席
// （`reviewDataLoaded: false` + 中性分計分）。同時發現找不到候選課的早退路徑
// 遺漏了 `reviewDataLoaded` 欄位，違反「成功與失敗回應都帶這個欄位」的既有契約。
//
// `generateForUser()` 本身是重度 I/O 的整合函式（`getUserPreferences`、
// `getAll('courses')`、`searchCoursesForSchedule` 皆需要 DB 或完整 identity/prefs
// 情境），因此把「評價查詢失敗容錯」與「無候選回應形狀」各自抽成可獨立測試的
// 純函式／小函式，不必連真實資料庫或建置完整排課情境就能釘住這兩個修復。

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { loadCourseReviewsSafely, buildNoCandidatesResult } from '../src/services/scheduleService.js';

describe('loadCourseReviewsSafely：評價查詢失敗不得讓排課請求整體失敗', () => {
  test('loader 成功時回傳其解析結果', async () => {
    const reviews = [{ id: 1 }];
    const result = await loadCourseReviewsSafely(async () => reviews);

    assert.equal(result, reviews);
  });

  test('loader reject 時回傳空陣列，不向外拋出例外', async () => {
    const result = await loadCourseReviewsSafely(async () => {
      throw new Error('DB timeout');
    });

    assert.deepEqual(result, []);
  });

  test('loader 同步拋出例外時同樣回傳空陣列', async () => {
    const result = await loadCourseReviewsSafely(() => {
      throw new Error('schema mismatch');
    });

    assert.deepEqual(result, []);
  });
});

describe('buildNoCandidatesResult：無候選課的回應必須帶 reviewDataLoaded', () => {
  test('reviewDataLoaded 為 true 時如實回傳', () => {
    const result = buildNoCandidatesResult(true);

    assert.equal(result.reviewDataLoaded, true);
    assert.equal(result.success, false);
    assert.deepEqual(result.schedule, []);
  });

  test('reviewDataLoaded 為 false 時如實回傳，而不是缺少這個欄位', () => {
    const result = buildNoCandidatesResult(false);

    assert.equal(result.reviewDataLoaded, false);
    assert.ok('reviewDataLoaded' in result, '欄位必須存在，呼叫端才能分辨 false 與欄位不存在');
  });
});
