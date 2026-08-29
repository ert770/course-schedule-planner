import { after, before, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { app } from '../src/app.js';
import {
  hasCurrentPurposeConsent,
  markServiceWithdrawn,
  recordConsentChoices,
  resetPrivacyMemoryStoreForTests,
  seedOutdatedConsentForTests,
} from '../src/services/privacyService.js';
import {
  cleanupExpiredInteractionEvents,
  countRecentEvents,
  deleteInteractionEvents,
  getInteractionEventsForExport,
  recordInteractionEvents,
  resetInteractionEventStoreForTests,
  wouldExceedDailyQuota,
} from '../src/services/interactionEventService.js';
import { resetRateLimiterForTests } from '../src/utils/rateLimiter.js';
import { recordScheduleFeedback } from '../src/services/scheduleFeedbackService.js';
import { annotateScheduleIdentifiers } from '../src/services/scheduleService.js';
import { deriveSubjectId } from '../src/services/privacyService.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const demo = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', 'data', 'users.json'), 'utf8'))[0];

const identityA = { canonicalId: demo.studentId };
const identityB = { canonicalId: 'D0000002' };
const REQUEST_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ACTION_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const OTHER_ACTION_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

let server;
let baseUrl;
let cookie;

// `source` 預設為 explicit_selection，不是 system_recommendation：對抗式審查
// 之後，`system_recommendation` 來源的 course_withdrawn／recommendation_accepted
// 都要對照一次真實曝光紀錄（見 IL-13e～g、IL-17），大多數這裡的測試測的是
// 完全無關的行為（去重、原因、保存期限、刪除隔離），不該每個都得先造一筆
// 曝光才能測——真正要測 system_recommendation 來源驗證的測試會自己覆寫。
function baseDraft(overrides = {}) {
  return {
    eventType: 'course_withdrawn',
    requestId: REQUEST_ID,
    actionId: ACTION_ID,
    course: { catalogCourseCode: 'IECS3002', sectionId: 101 },
    term: { academicYear: 114, semester: '下學期' },
    source: 'explicit_selection',
    feedbackReason: 'time',
    versionSnapshot: { recommendationReasonVersion: null },
    ...overrides,
  };
}

// 回饋的來源驗證改為對照曝光事件，因此每個 feedback 測試都要先有一次真實曝光。
// `displayedSet` 只含 101——102 是「有進候選但沒顯示」，正是不能被退選的那一種。
// 對抗式審查修正後，`recommendation_exposed` 只有伺服器自己（帶
// `allowExposureWrite:true`）能寫入——這裡模擬的正是「伺服器在產生推薦時
// 自己寫的那一筆」，不是「client 宣稱看過推薦」，因此仍要帶這個旗標，
// 否則連測試 fixture 都會被剛加上的來源限制擋下。
async function recordExposure(identity = identityA) {
  return recordInteractionEvents(identity, [baseDraft({
    eventType: 'recommendation_exposed',
    course: null,
    feedbackReason: null,
    actionId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    plan: { planId: `${REQUEST_ID}:required_first`, variantId: 'required_first' },
    position: { planRank: 1, courseRank: null },
    exposureContext: {
      surface: 'chat',
      trigger: 'chat_tool',
      candidateSet: [
        { catalogCourseCode: 'IECS3002', sectionId: 101 },
        { catalogCourseCode: 'IECS3059', sectionId: 102 },
      ],
      displayedSet: [{ catalogCourseCode: 'IECS3002', sectionId: 101 }],
    },
  })], { allowExposureWrite: true });
}

async function feedbackEventCount() {
  return (await getInteractionEventsForExport(identityA))
    .filter(event => event.eventType !== 'recommendation_exposed').length;
}

async function grantPersonalization(identity, granted = true) {
  await recordConsentChoices(identity, {
    service_processing: true,
    personalization_learning: granted,
    aggregate_research: false,
  });
}

before(async () => {
  process.env.NODE_ENV = 'test';
  process.env.PRIVACY_STORE = 'memory';
  process.env.PRIVACY_ENFORCEMENT_ENABLED = 'true';
  process.env.ANALYTICS_ID_SECRET = 'interaction-test-analytics-secret-32-chars';
  process.env.PRIVACY_DATA_KEY_V1 = Buffer.alloc(32, 5).toString('base64');
  delete process.env.GEMINI_API_KEY;
  server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}/api`;
  const login = await fetch(`${baseUrl}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ studentId: demo.studentId, password: demo.password }),
  });
  cookie = login.headers.get('set-cookie').split(';')[0];
});

after(() => new Promise((resolve, reject) => server.close(err => (err ? reject(err) : resolve()))));

beforeEach(() => {
  resetPrivacyMemoryStoreForTests();
  resetInteractionEventStoreForTests();
});

describe('#2 consent boundary', () => {
  test('IL-1 未同意 personalization_learning 時回 recorded:false 且一列都不寫入', async () => {
    await grantPersonalization(identityA, false);
    const result = await recordInteractionEvents(identityA, [baseDraft()]);
    assert.equal(result.recorded, false);
    assert.equal(result.reason, 'CONSENT_NOT_GRANTED');
    assert.deepEqual(await getInteractionEventsForExport(identityA), []);
  });

  test('IL-1b 路由層同樣回 200 而非 428——可選用途不該把使用者推到同意牆', async () => {
    await grantPersonalization(identityA, false);
    const response = await fetch(`${baseUrl}/interactions`, {
      method: 'POST',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ events: [baseDraft()] }),
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.recorded, false);
    assert.equal(body.reason, 'CONSENT_NOT_GRANTED');
  });

  test('IL-2 同意後寫入，且儲存的資料完全不含學號', async () => {
    await grantPersonalization(identityA);
    const result = await recordInteractionEvents(identityA, [baseDraft()]);
    assert.equal(result.recorded, 1);
    assert.equal(result.results[0].status, 'append');

    const stored = await getInteractionEventsForExport(identityA);
    assert.equal(stored.length, 1);
    // 假名邊界：整筆資料序列化之後不得出現學號，也不得出現 subject ID。
    const serialized = JSON.stringify(stored);
    assert.equal(serialized.includes(demo.studentId), false);
    assert.equal(serialized.includes(deriveSubjectId(identityA.canonicalId)), false);
    assert.equal(stored[0].versionSnapshot.modelVersion, 'scheduler-greedy-v1');
    assert.equal(stored[0].versionSnapshot.recommendationReasonVersion, null);
  });

  test('IL-2b 曝光事件的資料一樣完全不含學號（伺服器寫入路徑）', async () => {
    await grantPersonalization(identityA);
    await recordExposure();
    const stored = await getInteractionEventsForExport(identityA);
    const serialized = JSON.stringify(stored);
    assert.equal(serialized.includes(demo.studentId), false);
    assert.equal(serialized.includes(deriveSubjectId(identityA.canonicalId)), false);
    const exposureRow = stored.find(event => event.eventType === 'recommendation_exposed');
    assert.equal(exposureRow.exposureContext.displayedSet.length, 1);
  });
});

describe('#2 idempotency', () => {
  test('IL-3 同一 action 重送視為 duplicate，仍只有一列', async () => {
    await grantPersonalization(identityA);
    assert.equal((await recordInteractionEvents(identityA, [baseDraft()])).results[0].status, 'append');
    const second = await recordInteractionEvents(identityA, [baseDraft()]);
    assert.equal(second.results[0].status, 'duplicate');
    assert.equal((await getInteractionEventsForExport(identityA)).length, 1);
  });

  test('IL-4 相同 key 但 payload 改變回 conflict，不覆寫既有事件', async () => {
    await grantPersonalization(identityA);
    await recordInteractionEvents(identityA, [baseDraft()]);
    const conflicting = await recordInteractionEvents(identityA, [baseDraft({ feedbackReason: 'workload' })]);
    assert.equal(conflicting.results[0].status, 'conflict');
    const stored = await getInteractionEventsForExport(identityA);
    assert.equal(stored.length, 1);
    assert.equal(stored[0].feedbackReason, 'time');
  });

  test('IL-3b 不同 actionId 是不同的操作，兩筆都寫入', async () => {
    await grantPersonalization(identityA);
    await recordInteractionEvents(identityA, [baseDraft()]);
    await recordInteractionEvents(identityA, [baseDraft({ actionId: OTHER_ACTION_ID })]);
    assert.equal((await getInteractionEventsForExport(identityA)).length, 2);
  });
});

describe('#2 event semantics', () => {
  test('IL-5 displayedSet 不是 candidateSet 子集時整筆拒絕', async () => {
    await grantPersonalization(identityA);
    const result = await recordInteractionEvents(identityA, [baseDraft({
      eventType: 'recommendation_exposed',
      course: null,
      feedbackReason: null,
      exposureContext: {
        surface: 'dashboard',
        trigger: 'initial_load',
        candidateSet: [{ catalogCourseCode: 'IECS3002', sectionId: 101 }],
        displayedSet: [{ catalogCourseCode: 'IECS3059', sectionId: 102 }],
      },
    })]);
    assert.equal(result.results[0].status, 'rejected');
    assert.match(result.results[0].errors[0], /displayedSet/u);
    assert.equal((await getInteractionEventsForExport(identityA)).length, 0);
  });

  test('IL-6 必修接受保留 source=required，不混成興趣正回饋', async () => {
    await grantPersonalization(identityA);
    await recordInteractionEvents(identityA, [baseDraft({
      eventType: 'course_selected',
      source: 'required',
      feedbackReason: null,
    })]);
    const [stored] = await getInteractionEventsForExport(identityA);
    assert.equal(stored.source, 'required');
  });

  test('IL-7 七個 feedbackReason 全數保存；非移除事件夾帶原因即拒絕', async () => {
    await grantPersonalization(identityA);
    const reasons = ['time', 'content', 'instructor', 'workload', 'full', 'eligibility', 'other'];
    await recordInteractionEvents(identityA, reasons.map((reason, index) => baseDraft({
      actionId: `dddddddd-dddd-4ddd-8ddd-${String(index).padStart(12, '0')}`,
      course: { catalogCourseCode: 'IECS3002', sectionId: 101 + index },
      feedbackReason: reason,
    })));
    const stored = await getInteractionEventsForExport(identityA);
    assert.deepEqual(stored.map(event => event.feedbackReason).sort(), [...reasons].sort());

    const invalid = await recordInteractionEvents(identityA, [baseDraft({
      actionId: OTHER_ACTION_ID,
      eventType: 'course_viewed',
      feedbackReason: 'content',
    })]);
    assert.equal(invalid.results[0].status, 'rejected');
  });

  test('IL-7b 略過原因時記成 null，不猜一個值', async () => {
    await grantPersonalization(identityA);
    await recordInteractionEvents(identityA, [baseDraft({ feedbackReason: null })]);
    const [stored] = await getInteractionEventsForExport(identityA);
    assert.equal(stored.feedbackReason, null);
  });
});

describe('#2 identity, retention and deletion', () => {
  test('IL-8 未登入時路由回 401，不寫入', async () => {
    await grantPersonalization(identityA);
    const response = await fetch(`${baseUrl}/interactions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ events: [baseDraft()] }),
    });
    assert.equal(response.status, 401);
    assert.equal((await getInteractionEventsForExport(identityA)).length, 0);
  });

  test('IL-9 兩個帳號的事件完全隔離', async () => {
    await grantPersonalization(identityA);
    await grantPersonalization(identityB);
    await recordInteractionEvents(identityA, [baseDraft()]);
    assert.equal((await getInteractionEventsForExport(identityA)).length, 1);
    assert.equal((await getInteractionEventsForExport(identityB)).length, 0);
  });

  test('IL-10 保存期限清理只刪過期資料', async () => {
    await grantPersonalization(identityA);
    await recordInteractionEvents(identityA, [baseDraft()]);
    const fresh = await cleanupExpiredInteractionEvents({ dryRun: true });
    assert.equal(fresh.expiredInteractionEvents, 0);
    assert.equal((await getInteractionEventsForExport(identityA)).length, 1);
  });

  test('IL-11 帳號刪除後該 subject 的事件歸零', async () => {
    await grantPersonalization(identityA);
    await recordInteractionEvents(identityA, [baseDraft()]);
    const deleted = await deleteInteractionEvents(deriveSubjectId(identityA.canonicalId));
    assert.equal(deleted.interactionEventsDeleted, 1);
    assert.equal((await getInteractionEventsForExport(identityA)).length, 0);
  });

  // 對抗式審查發現的競態：consent 紀錄依政策保留 365 天，因此刪除帳號後
  // consent 檢查仍會通過。若寫入路徑不另外看撤回狀態，一個已經通過檢查、
  // 正在執行中的請求就會在刪除完成後才落地——刪除 API 回報成功，個人資料
  // 卻又被寫回去，subject 列甚至可能被重新建起來。
  test('IL-14 已撤回服務的 subject 不得再寫入任何事件', async () => {
    await grantPersonalization(identityA);
    await markServiceWithdrawn(identityA);
    await deleteInteractionEvents(deriveSubjectId(identityA.canonicalId));

    const result = await recordInteractionEvents(identityA, [baseDraft()]);
    assert.equal(result.results[0].status, 'rejected');
    assert.match(result.results[0].errors[0], /已撤回服務/u);
    assert.equal((await getInteractionEventsForExport(identityA)).length, 0);
  });

  test('IL-14b 刪除流程先撤回再刪除，因此並行寫入不會留下殘存資料', async () => {
    await grantPersonalization(identityA);
    // 模擬「請求已通過 consent 檢查、尚未寫入」時帳號被刪除的那一瞬間。
    const inFlight = recordInteractionEvents(identityA, [baseDraft()]);
    await markServiceWithdrawn(identityA);
    await inFlight;
    await deleteInteractionEvents(deriveSubjectId(identityA.canonicalId));

    // 無論那筆寫入搶在撤回之前落地（被刪除清掉）或之後被拒絕，結果都是零列。
    assert.equal((await getInteractionEventsForExport(identityA)).length, 0);
  });

  // 對抗式審查發現：consent 檢查原本只查 `granted`，沒比對 `policyVersion`——
  // 舊版政策下同意過一次，換了新版政策也不會被要求重新同意。
  test('IL-15 舊版政策下的同意不算目前有效同意，不寫入任何事件', async () => {
    const subjectId = deriveSubjectId(identityA.canonicalId);
    seedOutdatedConsentForTests(subjectId, 'personalization_learning', {
      granted: true, policyVersion: '2020-01-01.v0',
    });
    assert.equal(
      await hasCurrentPurposeConsent(subjectId, 'personalization_learning'), false,
      '舊版政策同意不應被視為目前有效'
    );

    const result = await recordInteractionEvents(identityA, [baseDraft()]);
    assert.equal(result.recorded, false);
    assert.equal(result.reason, 'CONSENT_NOT_GRANTED');
    assert.equal((await getInteractionEventsForExport(identityA)).length, 0);
  });

  test('IL-15b 目前版本、granted:false 的同意同樣不算有效', async () => {
    const subjectId = deriveSubjectId(identityA.canonicalId);
    seedOutdatedConsentForTests(subjectId, 'personalization_learning', {
      granted: false, policyVersion: '2026-08-22.v1',
    });
    assert.equal(await hasCurrentPurposeConsent(subjectId, 'personalization_learning'), false);
  });

  // 對抗式審查發現：撞到 UNIQUE 索引時原本一律回 duplicate，沒有重新讀出
  // 真正寫進去的那筆比對。兩個並行請求用同一個 idempotency key 但內容不同
  // （這裡是不同的 feedbackReason）都可能通過「檢查時還不存在」的前置判定，
  // 只有一個能真的寫入；輸的那個必須被回報成 conflict，不能被誤報成
  // 「內容跟你送的一樣，已經記過了」。記憶體 store 現在也模擬 UNIQUE 索引
  // （見 `interactionEventService.js` 的 `insertEvent()`），這裡才測得到
  // 真正的撞鍵路徑，不只是預先檢查那一層。
  test('IL-18 並行請求撞上相同 key 但內容不同時回 conflict，不誤報 duplicate', async () => {
    await grantPersonalization(identityA);
    const [a, b] = await Promise.all([
      recordInteractionEvents(identityA, [baseDraft({ feedbackReason: 'time' })]),
      recordInteractionEvents(identityA, [baseDraft({ feedbackReason: 'content' })]),
    ]);
    const statuses = [a.results[0].status, b.results[0].status].sort();
    assert.deepEqual(statuses, ['append', 'conflict']);
    assert.equal((await getInteractionEventsForExport(identityA)).length, 1);
  });

  test('IL-18b 並行請求撞上相同 key 且內容也相同時才回 duplicate', async () => {
    await grantPersonalization(identityA);
    const [a, b] = await Promise.all([
      recordInteractionEvents(identityA, [baseDraft()]),
      recordInteractionEvents(identityA, [baseDraft()]),
    ]);
    const statuses = [a.results[0].status, b.results[0].status].sort();
    assert.deepEqual(statuses, ['append', 'duplicate']);
    assert.equal((await getInteractionEventsForExport(identityA)).length, 1);
  });
});

describe('#2 provenance enforced at the single write path (not just the Agent tool)', () => {
  // 對抗式審查的核心發現：確認列的「符合」按鈕與移除原因選單原本直接打
  // `/api/interactions`，完全繞過 `scheduleFeedbackService` 的來源驗證——
  // 上一輪只把驗證接到 Agent tool 一條路徑，真正常用的非 Chat 路徑反而
  // 不設防。修法是把驗證搬進 `recordInteractionEvents()` 本身，讓它對
  // **任何**呼叫端都生效，不必知道呼叫端是誰。這裡直接呼叫
  // `recordInteractionEvents()`（confirm bar／removal dialog 實際呼叫的
  // 那一層），不經過 scheduleFeedbackService，證明繞不過去。
  test('IL-17 client 自己捏一組 recommendation_exposed 一律拒絕，即使格式完全合法', async () => {
    await grantPersonalization(identityA);
    const result = await recordInteractionEvents(identityA, [baseDraft({
      eventType: 'recommendation_exposed',
      course: null,
      feedbackReason: null,
      source: 'system_recommendation',
      exposureContext: {
        surface: 'dashboard',
        trigger: 'initial_load',
        candidateSet: [{ catalogCourseCode: 'IECS3002', sectionId: 101 }],
        displayedSet: [{ catalogCourseCode: 'IECS3002', sectionId: 101 }],
      },
    })]);
    assert.equal(result.results[0].status, 'rejected');
    assert.match(result.results[0].errors[0], /只能由伺服器/u);
    assert.equal((await getInteractionEventsForExport(identityA)).length, 0);
  });

  test('IL-17b 直接呼叫 recordInteractionEvents 送出 system_recommendation 來源的 course_withdrawn，沒有曝光紀錄一律拒絕', async () => {
    await grantPersonalization(identityA);
    // 刻意不呼叫 recordExposure()：模擬確認列／移除選單直接打
    // /api/interactions、繞過 scheduleFeedbackService 的情境。
    const result = await recordInteractionEvents(identityA, [baseDraft({ source: 'system_recommendation' })]);
    assert.equal(result.results[0].status, 'rejected');
    assert.match(result.results[0].errors[0], /沒有對應的推薦曝光紀錄/u);
    assert.equal((await getInteractionEventsForExport(identityA)).length, 0);
  });

  test('IL-17c 曝光紀錄存在且班次確實顯示過時，直接呼叫 recordInteractionEvents 就能成功——不必經過 Agent tool', async () => {
    await grantPersonalization(identityA);
    await recordExposure();
    const result = await recordInteractionEvents(identityA, [baseDraft({ source: 'system_recommendation' })]);
    assert.equal(result.results[0].status, 'append');
  });

  test('IL-17d 允許伺服器自己寫曝光事件（allowExposureWrite:true），且此時不做來源驗證', async () => {
    await grantPersonalization(identityA);
    const result = await recordInteractionEvents(identityA, [baseDraft({
      eventType: 'recommendation_exposed',
      course: null,
      feedbackReason: null,
      source: 'system_recommendation',
      exposureContext: {
        surface: 'dashboard',
        trigger: 'initial_load',
        candidateSet: [{ catalogCourseCode: 'IECS3002', sectionId: 101 }],
        displayedSet: [{ catalogCourseCode: 'IECS3002', sectionId: 101 }],
      },
    })], { allowExposureWrite: true });
    assert.equal(result.results[0].status, 'append');
  });
});

describe('#2 recommendation identifiers and post-schedule confirmation', () => {
  test('IL-12 排課回應帶 requestId，每個方案帶 planId 與 variantId', () => {
    const result = annotateScheduleIdentifiers(
      { success: true, plans: [{ id: 'required_first' }, { id: 'compact' }] },
      REQUEST_ID
    );
    assert.equal(result.requestId, REQUEST_ID);
    assert.deepEqual(result.plans.map(plan => plan.planId), [
      `${REQUEST_ID}:required_first`,
      `${REQUEST_ID}:compact`,
    ]);
    assert.deepEqual(result.plans.map(plan => plan.variantId), ['required_first', 'compact']);
  });

  test('IL-12b 失敗回應也帶識別碼，曝光事件才指認得到那一次推薦', () => {
    const failed = annotateScheduleIdentifiers({ success: false, plans: [] }, REQUEST_ID);
    assert.equal(failed.requestId, REQUEST_ID);
  });

  test('IL-13 record_schedule_feedback 產生接受與退選事件', async () => {
    await grantPersonalization(identityA);
    await recordExposure();

    const result = await recordScheduleFeedback(identityA, {
      requestId: REQUEST_ID,
      planId: `${REQUEST_ID}:required_first`,
      accepted: true,
      rejectedCourses: [{ sectionId: 101, reason: 'time' }],
    });

    assert.equal(result.success, true);
    assert.equal(result.recorded, 2);
    const stored = await getInteractionEventsForExport(identityA);
    const accepted = stored.find(event => event.eventType === 'recommendation_accepted');
    const withdrawn = stored.find(event => event.eventType === 'course_withdrawn');
    assert.equal(accepted.plan.variantId, 'required_first');
    assert.equal(accepted.source, 'system_recommendation');
    assert.equal(withdrawn.feedbackReason, 'time');
    assert.equal(withdrawn.course.catalogCourseCode, 'IECS3002');
  });

  test('IL-13b 重送同一份確認為 duplicate，不會重複計為兩次接受', async () => {
    await grantPersonalization(identityA);
    await recordExposure();
    const args = { requestId: REQUEST_ID, accepted: true };
    await recordScheduleFeedback(identityA, args);
    const again = await recordScheduleFeedback(identityA, args);
    assert.equal(again.results[0].status, 'duplicate');
    assert.equal(
      (await getInteractionEventsForExport(identityA))
        .filter(event => event.eventType === 'recommendation_accepted').length,
      1
    );
  });

  test('IL-13c requestId 造假或原因不合法時明確回報，不寫入', async () => {
    await grantPersonalization(identityA);
    await recordExposure();

    assert.match((await recordScheduleFeedback(identityA, {
      requestId: '不是 UUID', accepted: true,
    })).error, /requestId/u);

    assert.match((await recordScheduleFeedback(identityA, {
      requestId: REQUEST_ID,
      accepted: false,
      rejectedCourses: [{ sectionId: 101, reason: '太難了' }],
    })).error, /reason/u);

    assert.equal(await feedbackEventCount(), 0);
  });

  test('IL-13d 使用者尚未回答時不得代為記錄', async () => {
    await grantPersonalization(identityA);
    await recordExposure();
    const result = await recordScheduleFeedback(identityA, { requestId: REQUEST_ID, accepted: false });
    assert.match(result.error, /尚未表達/u);
    assert.equal(await feedbackEventCount(), 0);
  });

  // 以下三項是對抗式審查點出的核心缺口：模型可以編出格式完全合法、但這位使用者
  // 從來沒看過的推薦。只驗格式等於沒驗；要驗的是「這真的出現在你說的那份推薦
  // 課表裡嗎」。
  test('IL-13e 沒有對應曝光紀錄的 requestId 一律拒絕', async () => {
    await grantPersonalization(identityA);
    await recordExposure();
    const forged = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
    const result = await recordScheduleFeedback(identityA, { requestId: forged, accepted: true });
    assert.match(result.error, /找不到 requestId/u);
    assert.equal(await feedbackEventCount(), 0);
  });

  test('IL-13f 別人的推薦不能拿來當自己的回饋來源', async () => {
    await grantPersonalization(identityA);
    await grantPersonalization(identityB);
    await recordExposure(identityA);
    // B 帳號用 A 的 requestId：曝光查詢以 subject 為範圍，查無此紀錄。
    const result = await recordScheduleFeedback(identityB, { requestId: REQUEST_ID, accepted: true });
    assert.match(result.error, /找不到 requestId/u);
  });

  test('IL-13g 捏造的 variant 與未顯示過的課程都被拒絕', async () => {
    await grantPersonalization(identityA);
    await recordExposure();

    assert.match((await recordScheduleFeedback(identityA, {
      requestId: REQUEST_ID,
      planId: `${REQUEST_ID}:max_credits`,
      accepted: true,
    })).error, /不是該次推薦實際顯示的方案/u);

    // 102 有進 candidateSet 但沒有被顯示；使用者不可能退掉沒看過的課。
    assert.match((await recordScheduleFeedback(identityA, {
      requestId: REQUEST_ID,
      accepted: false,
      rejectedCourses: [{ sectionId: 102, reason: 'time' }],
    })).error, /不在該次推薦實際顯示的課表中/u);

    assert.equal(await feedbackEventCount(), 0);
  });
});

// 對抗式審查發現：`/api/interactions` 除了 50 筆／請求的批次上限，沒有任何
// 節流——同一個帳號可以無限次呼叫，造成資料庫無界成長。這裡在 HTTP 層驗證
// 節流真的生效，不只是單元測試那個節流器函式本身。
describe('#2 /api/interactions rate limiting and daily quota', () => {
  test('IL-19 每分鐘請求數超過上限回 429，不繼續寫入', async () => {
    resetRateLimiterForTests();
    await grantPersonalization(identityA);
    let lastStatus = 200;
    for (let i = 0; i < 25; i++) {
      const response = await fetch(`${baseUrl}/interactions`, {
        method: 'POST',
        headers: { Cookie: cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ events: [] }),
      });
      lastStatus = response.status;
      if (lastStatus === 429) {
        const body = await response.json();
        assert.equal(body.code, 'RATE_LIMITED');
        break;
      }
    }
    assert.equal(lastStatus, 429, '20 次以內應該要觸發節流，實際沒有觸發');
    resetRateLimiterForTests();
  });

  // `wouldExceedDailyQuota()` 的 `limit` 由呼叫端傳入（見
  // `interactionEventService.js`），不用真的塞到 2000 筆才測得到「超過」
  // 這個分支——路由層用的就是同一支函式，只是把 2000 換成一個小數字。
  test('IL-20 每日事件量配額：未超過時允許，超過時擋下', async () => {
    await grantPersonalization(identityA);
    const many = Array.from({ length: 3 }, (_, i) => baseDraft({
      actionId: `99999999-9999-4999-8999-${String(i).padStart(12, '0')}`,
      course: { catalogCourseCode: 'IECS3002', sectionId: 200 + i },
    }));
    await recordInteractionEvents(identityA, many);
    assert.equal(await countRecentEvents(identityA, 24), 3);

    assert.equal(await wouldExceedDailyQuota(identityA, 2, 5), false, '3+2=5，剛好等於上限不算超過');
    assert.equal(await wouldExceedDailyQuota(identityA, 3, 5), true, '3+3=6，超過上限 5');
  });
});
