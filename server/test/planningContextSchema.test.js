// `POST /api/chat` 的 `planningContext` 形狀驗證。
//
// 純函式測試。路由確實有接上這些規則、以及三態 `planningContextStatus` 的實際行為，
// 由真實帳號的瀏覽器實測作證——在 Windows 上，起 `app.js` 的測試檔即使斷言全過，
// 程序仍會因殘留 handle 不結束（`authRoutes`／`privacyRoutes`／`scheduleRoutes`／
// `interactionEvents` 都有這個既有問題），不值得為此再增加一個。
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  AVOIDANCE_SCOPES,
  deriveAvoidanceScope,
  derivePendingReason,
  validatePlanningContext,
} from '../src/data/planningContextSchema.js';

describe('避開範圍由退課原因推導', () => {
  test('內容與負擔 → 整個課號（換班次沒有意義）', () => {
    assert.equal(deriveAvoidanceScope('content'), AVOIDANCE_SCOPES.CATALOG_COURSE);
    assert.equal(deriveAvoidanceScope('workload'), AVOIDANCE_SCOPES.CATALOG_COURSE);
  });

  test('教師 → 只避開該教師，其他教師的同課仍可排', () => {
    assert.equal(deriveAvoidanceScope('instructor'), AVOIDANCE_SCOPES.INSTRUCTOR);
  });

  // 這三個原因對「課程內容偏好」是中性的，同一門課的其他班次仍然合理。
  test('時段、額滿、資格、其他、未知 → 保守地只避開該班次', () => {
    for (const reason of ['time', 'full', 'eligibility', 'other', null]) {
      assert.equal(deriveAvoidanceScope(reason), AVOIDANCE_SCOPES.SECTION, `reason=${reason}`);
    }
  });

  test('原因未知才算待補；已有原因不再追問', () => {
    assert.equal(derivePendingReason(null), true);
    assert.equal(derivePendingReason(undefined), true);
    assert.equal(derivePendingReason('workload'), false);
  });
});

describe('planningContext 形狀驗證', () => {
  test('省略或 null 都合法，代表這次沒有規劃狀態', () => {
    assert.deepEqual(validatePlanningContext(undefined), { error: null, value: null });
    assert.deepEqual(validatePlanningContext(null), { error: null, value: null });
  });

  test('合法輸入正規化成兩份課程清單', () => {
    const { error, value } = validatePlanningContext({
      requestId: 'req-1',
      activePlanId: 'plan-1',
      activeVariantId: 'variant-1',
      currentCourses: [{ sectionId: 101 }, { sectionId: '102' }],
      removedCourses: [{ sectionId: 103, reason: 'workload' }],
    });

    assert.equal(error, null);
    assert.deepEqual(value.currentCourses, [{ sectionId: 101 }, { sectionId: 102 }]);
    assert.deepEqual(value.removedCourses, [{
      sectionId: 103, reason: 'workload', scope: 'catalog_course', pendingReason: false,
    }]);
  });

  // 送 `{ reason: 'time', scope: 'catalog_course' }` 就能把「這個時段不方便」
  // 放大成排除整門課——那是使用者沒有說過的話。
  test('client 送的 scope 與 pendingReason 一律忽略，由 reason 重算', () => {
    const { value } = validatePlanningContext({
      removedCourses: [{ sectionId: 1, reason: 'time', scope: 'catalog_course', pendingReason: false }],
    });

    assert.equal(value.removedCourses[0].scope, 'section');
    assert.equal(value.removedCourses[0].pendingReason, false);
  });

  test('原因未填時標成待補，範圍保守地只到班次', () => {
    const { value } = validatePlanningContext({ removedCourses: [{ sectionId: 1 }] });

    assert.equal(value.removedCourses[0].reason, null);
    assert.equal(value.removedCourses[0].scope, 'section');
    assert.equal(value.removedCourses[0].pendingReason, true);
  });

  test('reason 沿用 interactionEventSchema 的值域，不另立一套', () => {
    const { error } = validatePlanningContext({
      removedCourses: [{ sectionId: 1, reason: 'too-hard' }],
    });
    assert.match(error, /reason 不在允許清單/u);
  });

  test('型別錯誤在邊界擋下', () => {
    assert.match(validatePlanningContext([]).error, /必須是物件/u);
    assert.match(validatePlanningContext({ requestId: 42 }).error, /requestId/u);
    assert.match(validatePlanningContext({ currentCourses: 'x' }).error, /必須是陣列/u);
    assert.match(validatePlanningContext({ removedCourses: [null] }).error, /必須是物件/u);
    assert.match(validatePlanningContext({ removedCourses: [{ sectionId: 0 }] }).error, /正整數/u);
    assert.match(validatePlanningContext({ removedCourses: [{ sectionId: 'abc' }] }).error, /正整數/u);
  });

  // 這份資料會進 system prompt。沒有上限的話，一個壞掉或惡意的 client
  // 可以用課號把 prompt 撐爆。
  test('課程數有上限', () => {
    const many = Array.from({ length: 31 }, (_, index) => ({ sectionId: index + 1 }));
    assert.match(validatePlanningContext({ currentCourses: many }).error, /最多 30 筆/u);
  });

  test('重覆的 sectionId 去重而不是報錯（那是前端序列化的結果，不該中斷對話）', () => {
    const { value } = validatePlanningContext({
      currentCourses: [{ sectionId: 7 }, { sectionId: 7 }],
    });
    assert.deepEqual(value.currentCourses, [{ sectionId: 7 }]);
  });
});
