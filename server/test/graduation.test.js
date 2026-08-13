// 畢業頁只信官方對照表（`server/src/routes/graduation.js` 的 `resolveRequiredCredits()`）。
//
// `routes/graduation.js` 先前零測試覆蓋——本檔是第一份。專案沒有 supertest 之類的
// HTTP 路由測試設施，因此把「department requirement → required／totalRequired／warning」
// 這段判斷抽成純函式並匯出，跟同檔案既有的 `toCreditBreakdown()`／`hasCourseHistory()`
// 同樣風格，不必啟動整個 Express app 就能測。

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { resolveRequiredCredits } from '../src/routes/graduation.js';
import { getGraduationRequirement } from '../src/data/graduationRequirements.js';

// 命名對照 docs/TEST_PLAN.md 的 G5／G6——沿用「G」代表 Graduation，
// 接續既有 G1-G4（畢業學分計算的 nonGraduation 排除），避免與那組 ID 混淆。
describe('G5-G6 resolveRequiredCredits：只信官方對照表', () => {
  test('G5 查不到系所時 required／totalRequired 皆為 null，並回傳指定警告', () => {
    const result = resolveRequiredCredits(null);

    assert.equal(result.required, null);
    assert.equal(result.totalRequired, null);
    assert.equal(result.warning, '此系所不存在，請檢查是否輸入錯誤');
  });

  test('G6 查得到系所時回傳正確的學分拆解，不帶警告', () => {
    // 先前這裡查不到系所會退回 user.requiredCredits——那個欄位已刪，不該再有
    // 任何「使用者自帶值」的後備路徑，查得到就是查得到，只用官方對照表的數字。
    const requirement = {
      total: 128,
      deptRequired: 63,
      deptElective: 28,
      outsideElective: 9,
      generalBasic: 16,
      generalElective: 12,
      unspecified: 0,
    };

    const result = resolveRequiredCredits(requirement);

    assert.deepEqual(result.required, {
      required: 63,
      elective: 28,
      general: 28,
      external: 9,
      unspecified: 0,
    });
    assert.equal(result.totalRequired, 128);
    assert.equal(result.warning, null);
  });

  test('G6 資訊工程學系（現有官方對照表查得到的系所）不觸發警告', () => {
    // 對照現實資料，確保正常路徑不受這次改動影響。
    const requirement = getGraduationRequirement('資訊工程學系');
    assert.ok(requirement, '對照表應查得到資訊工程學系');

    const result = resolveRequiredCredits(requirement);

    assert.equal(result.warning, null);
    assert.equal(result.totalRequired, requirement.total);
  });
});
