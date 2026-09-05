// Roadmap #2：interaction event 的**唯一**持久化位置。
//
// #29 的 `data/interactionEventSchema.js` 刻意保持純函式（正規化、驗證、
// migration、idempotency 判定），本模組是它與儲存體之間的那一層，負責三件
// #29 明文交給 #2 的事：
//
//   1. **consent 先於寫入**。`personalization_learning` 是可選用途且預設關閉；
//      未同意時整批丟棄，不緩衝、不排隊、不落地（#33 驗收標準）。
//   2. **canonical ID 不進儲存體**。#29 的 envelope 帶 canonical `userId`，
//      寫入前一律換成 #33 的 HMAC `subject_id`；`docs/DATA_SCHEMA.md` 明文
//      禁止兩者一起持久化，因此 SQL 裡沒有任何學號欄位。
//   3. **去重同時由應用層與 DB 保證**。應用層用 `resolveIdempotentAppend()`
//      判定 append／duplicate／conflict；`(subject_id, idempotency_key)` 的
//      UNIQUE 索引則擋下並行請求擠過「檢查」與「寫入」之間空隙的那一種重複。
import { isMysqlConfigured, queryRows, withTransaction } from '../db/mysql.js';
import { PRIVACY_PURPOSES, PRIVACY_RETENTION } from '../data/privacyPolicy.js';
import { PROFILE_SCHEMA_VERSION } from '../data/profileSchema.js';
import {
  deriveSubjectId,
  hasCurrentPurposeConsent,
  isPrivacyEnforcementEnabled,
  readSubjectState,
  toMysqlDate,
  useMemoryStore,
} from './privacyService.js';
import {
  createInteractionEvent,
  INTERACTION_EVENT_TYPES,
  INTERACTION_SOURCES,
  resolveIdempotentAppend,
} from '../data/interactionEventSchema.js';
import { logger } from '../utils/logger.js';
import { SCORING_POLICY_VERSION } from '../skills/scoringPolicy.js';

// 產生這批推薦的模型版本。#7 用連續權重向量取代固定 variant 時要一併改這個值，
// 否則 #30 會把兩種不同模型產生的曝光混為一談。
export const INTERACTION_MODEL_VERSION = SCORING_POLICY_VERSION;

const memoryStore = { events: [] };

export function resetInteractionEventStoreForTests() {
  memoryStore.events = [];
}

function expiryFrom(timestamp) {
  return new Date(new Date(timestamp).getTime() + PRIVACY_RETENTION.interactionEventDays * 86400000);
}

// 把資料列還原成 #29 的巢狀 event shape，供 `resolveIdempotentAppend()` 比對。
// `userId` 只在記憶體中還原成 canonical ID——它是比對用的欄位，不曾被寫進資料庫。
function rowToEvent(row, canonicalId) {
  const catalogCourseCode = row.catalogCourseCode ?? row.catalog_course_code ?? null;
  const sectionId = row.sectionId ?? row.section_id ?? null;
  const planId = row.planId ?? row.plan_id ?? null;
  const variantId = row.variantId ?? row.variant_id ?? null;
  const exposure = row.exposureJson ?? row.exposure_json ?? null;
  return {
    schemaVersion: Number(row.schemaVersion ?? row.schema_version),
    eventId: row.eventId ?? row.event_id,
    eventType: row.eventType ?? row.event_type,
    userId: String(canonicalId),
    timestamp: new Date(row.occurredAt ?? row.occurred_at).toISOString(),
    requestId: row.requestId ?? row.request_id,
    actionId: row.actionId ?? row.action_id,
    idempotencyKey: row.idempotencyKey ?? row.idempotency_key,
    course: catalogCourseCode === null && sectionId === null
      ? null
      : { catalogCourseCode, sectionId: sectionId === null ? null : Number(sectionId) },
    term: {
      academicYear: Number(row.academicYear ?? row.academic_year),
      semester: row.semester,
    },
    plan: planId === null && variantId === null ? null : { planId, variantId },
    position: {
      planRank: row.planRank ?? row.plan_rank ?? null,
      courseRank: row.courseRank ?? row.course_rank ?? null,
    },
    exposureContext: typeof exposure === 'string' ? JSON.parse(exposure) : exposure,
    versionSnapshot: {
      profileSchemaVersion: Number(row.profileSchemaVersion ?? row.profile_schema_version),
      modelVersion: row.modelVersion ?? row.model_version,
      recommendationReasonVersion:
        row.recommendationReasonVersion ?? row.recommendation_reason_version ?? null,
    },
    source: row.source ?? null,
    feedbackReason: row.feedbackReason ?? row.feedback_reason ?? null,
  };
}

async function loadByIdempotencyKey(subjectId, canonicalId, idempotencyKey) {
  if (useMemoryStore()) {
    return memoryStore.events
      .filter(row => row.subjectId === subjectId && row.idempotencyKey === idempotencyKey)
      .map(row => rowToEvent(row, canonicalId));
  }
  const rows = await queryRows(
    'SELECT * FROM Interaction_Events WHERE subject_id = ? AND idempotency_key = ?',
    [subjectId, idempotencyKey]
  );
  return rows.map(row => rowToEvent(row, canonicalId));
}

function isDuplicateKeyError(err) {
  return err?.code === 'ER_DUP_ENTRY' || err?.errno === 1062;
}

// 已撤回服務的 subject 不得再產生任何事件。丟這個 sentinel 而不是靜默略過，
// 呼叫端才能把它回報成 `rejected`，不會讓刪除後的寫入看起來像成功。
class SubjectWithdrawnError extends Error {
  constructor() {
    super('這個 subject 已撤回服務，不再接受互動事件');
    this.name = 'SubjectWithdrawnError';
  }
}

// 對抗式審查發現：`personalization_learning` 的同意檢查原本只在交易**之外**
// 做一次，跟撤回服務不共用同一把鎖——一個已經讀到「同意」的請求，可以在
// 使用者按下「取消同意」之後才真正寫入。這裡在拿到 `Privacy_Subject_State`
// 的列鎖之後**重新確認**一次，讀到的必然是鎖釋放前最後一次撤回之後的狀態。
class ConsentRevokedError extends Error {
  constructor() {
    super('個人化學習的同意已撤回或不是目前版本，寫入前重新確認未通過');
    this.name = 'ConsentRevokedError';
  }
}

function assertWritable(state) {
  // 沒有 subject 列代表從來沒有記錄過 consent；有 `serviceWithdrawnAt` 代表帳號已刪除。
  if (!state || state.serviceWithdrawnAt) throw new SubjectWithdrawnError();
}

async function assertCurrentlyConsented(subjectId, connection = null) {
  const consented = await hasCurrentPurposeConsent(
    subjectId, PRIVACY_PURPOSES.PERSONALIZATION_LEARNING, connection
  );
  if (!consented) throw new ConsentRevokedError();
}

function memoryEventRow(subjectId, event, occurredAt, expiresAt) {
  return {
      subjectId,
      eventId: event.eventId,
      eventType: event.eventType,
      occurredAt: occurredAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
      requestId: event.requestId,
      actionId: event.actionId,
      idempotencyKey: event.idempotencyKey,
      catalogCourseCode: event.course?.catalogCourseCode ?? null,
      sectionId: event.course?.sectionId ?? null,
      academicYear: event.term.academicYear,
      semester: event.term.semester,
      planId: event.plan?.planId ?? null,
      variantId: event.plan?.variantId ?? null,
      planRank: event.position.planRank,
      courseRank: event.position.courseRank,
      source: event.source,
      feedbackReason: event.feedbackReason,
      schemaVersion: event.schemaVersion,
      profileSchemaVersion: event.versionSnapshot.profileSchemaVersion,
      modelVersion: event.versionSnapshot.modelVersion,
    recommendationReasonVersion: event.versionSnapshot.recommendationReasonVersion,
    exposureJson: event.exposureContext,
  };
}

const INSERT_EVENT_SQL = `INSERT INTO Interaction_Events
      (event_id, subject_id, event_type, occurred_at, expires_at, request_id, action_id,
       idempotency_key, catalog_course_code, section_id, academic_year, semester,
       plan_id, variant_id, plan_rank, course_rank, source, feedback_reason,
       schema_version, profile_schema_version, model_version, recommendation_reason_version,
       exposure_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

function insertParams(subjectId, event, occurredAt, expiresAt) {
  return [
    event.eventId, subjectId, event.eventType, toMysqlDate(occurredAt), toMysqlDate(expiresAt),
    event.requestId, event.actionId, event.idempotencyKey,
    event.course?.catalogCourseCode ?? null, event.course?.sectionId ?? null,
    event.term.academicYear, event.term.semester,
    event.plan?.planId ?? null, event.plan?.variantId ?? null,
    event.position.planRank, event.position.courseRank,
    event.source, event.feedbackReason,
    event.schemaVersion, event.versionSnapshot.profileSchemaVersion,
    event.versionSnapshot.modelVersion, event.versionSnapshot.recommendationReasonVersion,
    event.exposureContext === null ? null : JSON.stringify(event.exposureContext),
  ];
}

// 「確認未撤回、確認仍同意」與「寫入」必須在同一個交易、同一把列鎖底下完成。
//
// 先前的寫法是 `touchSubject()` 直接 upsert 再 insert，兩者各自 autocommit，
// 而且 consent 只在交易**之外**查過一次：
//
//   1. 一個已通過檢查、正在執行中的請求，可以在帳號刪除**跑完之後**才落地，
//      甚至把已被刪掉的 subject 列重新建回來——刪除 API 回報成功，資料卻還在。
//   2. `personalization_learning` 被撤回，跟寫入事件不共用任何鎖，因此
//      「讀到同意」與「真正寫入」之間可以夾進一次撤回而完全不會被發現。
//
// 現在流程固定為 SELECT ... FOR UPDATE 鎖住 `Privacy_Subject_State` 那一列
// → 檢查 `service_withdrawn_at` → **在鎖底下重新查一次 consent** → 更新
// `last_active_at` → INSERT。`markServiceWithdrawn()`／`recordConsentChoices()`
// 的寫入（撤回帳號／撤回同意）都會先取得同一把列鎖才能真正生效，因此並行的
// 寫入只有兩種結局：搶在撤回之前落地（帳號刪除的情況會隨後被清掉），
// 或是等到鎖釋放後看到已撤回而被拒絕。不會有「consent 顯示已撤回、
// 資料庫卻還在累積」這種狀態。
async function insertEvent(subjectId, event) {
  const occurredAt = new Date(event.timestamp);
  const expiresAt = expiryFrom(event.timestamp);

  if (useMemoryStore()) {
    assertWritable(await readSubjectState(subjectId));
    await assertCurrentlyConsented(subjectId);
    // 模擬 MySQL 的 `(subject_id, idempotency_key)` UNIQUE 索引，讓記憶體
    // store 在測試裡也能重現「並行請求都通過檢查、只有一個真的寫得進去」
    // 的競態，兩種儲存體對這個不變量的行為才一致。
    if (memoryStore.events.some(row => row.subjectId === subjectId && row.idempotencyKey === event.idempotencyKey)) {
      const dup = new Error('ER_DUP_ENTRY (memory store simulation)');
      dup.code = 'ER_DUP_ENTRY';
      throw dup;
    }
    memoryStore.events.push(memoryEventRow(subjectId, event, occurredAt, expiresAt));
    return;
  }

  await withTransaction(async connection => {
    assertWritable(await readSubjectState(subjectId, connection));
    await assertCurrentlyConsented(subjectId, connection);
    await connection.execute(
      'UPDATE Privacy_Subject_State SET last_active_at = ?, updated_at = ? WHERE subject_id = ?',
      [toMysqlDate(occurredAt), toMysqlDate(occurredAt), subjectId]
    );
    await connection.execute(INSERT_EVENT_SQL, insertParams(subjectId, event, occurredAt, expiresAt));
  });
}

export async function hasPersonalizationConsent(identity) {
  // enforcement 關閉的環境沒有 consent 資料可讀。此時**不記錄**，與「使用者
  // 沒有同意」一致——寧可少一批開發期的雜訊事件，也不要累積無法追溯 consent
  // 依據的資料。
  if (!isPrivacyEnforcementEnabled()) return false;
  // 對抗式審查發現：這裡原本只查 `granted`，沒有比對 `policyVersion`——
  // 使用者在舊版政策下同意過一次，換了新版政策也不會被要求重新同意。
  // `hasCurrentPurposeConsent()` 同時檢查兩者，跟 `service_processing`
  // （見 `getConsentStatus()`）用的標準一致。這裡只是快速前置過濾；
  // 真正權威的判定在 `insertEvent()` 的交易鎖底下重新做一次。
  return hasCurrentPurposeConsent(
    deriveSubjectId(identity.canonicalId), PRIVACY_PURPOSES.PERSONALIZATION_LEARNING
  );
}

// 需要對照曝光紀錄驗證來源的事件：宣稱「這是系統推薦的」就必須真的對得上
// 系統實際產生、實際顯示過的那一次推薦，不能只看格式合不合法。
//
// 對抗式審查發現：`/api/interactions` 原本把 client 送的 draft 直接丟進
// `createInteractionEvent()`，格式驗證只檢查 UUID、enum、`displayedSet ⊆
// candidateSet` 這類**內部一致性**，從未確認「這個 requestId 真的是伺服器
// 產生過的一次推薦」。任何登入帳號都能自己捏一組`recommendation_exposed`，
// 再捏一組`recommendation_accepted`／`course_withdrawn`對上它——等於自己發
// 證明、自己拿證明驗證自己。#2 的資料會直接餵給 #30 的偏好學習，這種資料
// 不誠實比沒有資料更糟。
function requiresExposureProof(event) {
  if (event.eventType === INTERACTION_EVENT_TYPES.RECOMMENDATION_ACCEPTED) return true;
  return event.eventType === INTERACTION_EVENT_TYPES.COURSE_WITHDRAWN
    && event.source === INTERACTION_SOURCES.SYSTEM_RECOMMENDATION;
}

// `exposureCache` 是單次批次呼叫內的記憶——同一批事件常常共用同一個
// requestId（例如「接受方案」+「順便退掉其中一門」），沒必要查兩次。
async function assertProvenance(identity, event, exposureCache) {
  if (event.eventType === INTERACTION_EVENT_TYPES.RECOMMENDATION_EXPOSED) {
    // `recommendation_exposed` 只由伺服器在產生推薦的當下寫入（見
    // `services/scheduleService.js`），一般呼叫端一律拒絕——即使格式完全
    // 合法。這是唯一真正權威的曝光紀錄來源，不能讓 client 自己宣稱。
    throw new Error('recommendation_exposed 只能由伺服器在產生推薦時寫入，不接受用戶端提交。');
  }
  if (!requiresExposureProof(event)) return;

  let exposure = exposureCache.get(event.requestId);
  if (exposure === undefined) {
    exposure = await findExposure(identity, event.requestId);
    exposureCache.set(event.requestId, exposure);
  }
  if (!exposure) {
    throw new Error(
      `requestId ${event.requestId} 沒有對應的推薦曝光紀錄，無法確認這是系統實際顯示過的推薦。`
    );
  }

  if (event.eventType === INTERACTION_EVENT_TYPES.RECOMMENDATION_ACCEPTED) {
    // roadmap #27：使用者可能切到方案切換列裡任一個當次曝光顯示過的方案再
    // 接受，不是只有主推方案（`exposure.planId`）——用 `displayedPlanIds`
    // 判斷「這是不是真的顯示過」，而不是「是不是主推的那一個」。
    if (exposure.displayedPlanIds.length === 0
      || !event.plan?.planId
      || !exposure.displayedPlanIds.includes(event.plan.planId)) {
      throw new Error(
        `planId 不是該次推薦實際顯示過的方案之一`
        + `（應為 ${exposure.displayedPlanIds.join('、') || '無可接受方案'}）。`
      );
    }
    const policy = exposure.planPolicies.find(item => item.planId === event.plan.planId);
    if (policy && policy.variantId !== event.plan.variantId) {
      throw new Error('variantId 與伺服器記錄的方案不符');
    }
    return;
  }

  if (!exposure.displayedSectionIds.has(event.course?.sectionId)) {
    throw new Error(
      `班次 ${event.course?.sectionId} 不在該次推薦實際顯示的課表中，不能標記為系統推薦來源的退選。`
    );
  }
}

/**
 * 記錄一批互動事件。
 *
 * @param identity `resolveIdentity()` 的結果。
 * @param inputs   #29 shape 的 event draft 陣列；envelope 欄位一律由 server 覆寫。
 * @param options  `{ allowExposureWrite }`——只有伺服器在產生推薦的當下
 *                 （`services/scheduleService.js`）才可傳 `true`；一般呼叫端
 *                 （含 `/api/interactions`）一律不帶，`recommendation_exposed`
 *                 因此永遠會被拒絕。
 * @returns `{ recorded, reason?, results: [{ actionId, eventType, status, errors? }] }`
 *          `status` 為 append｜duplicate｜conflict｜rejected。
 */
export async function recordInteractionEvents(identity, inputs = [], options = {}) {
  const drafts = Array.isArray(inputs) ? inputs : [];
  if (!await hasPersonalizationConsent(identity)) {
    return { recorded: false, reason: 'CONSENT_NOT_GRANTED', results: [] };
  }

  const subjectId = deriveSubjectId(identity.canonicalId);
  const results = [];
  const exposureCache = new Map();

  for (const draft of drafts) {
    let event;
    try {
      event = createInteractionEvent(identity, {
        ...draft,
        exposureContext: draft?.eventType === INTERACTION_EVENT_TYPES.RECOMMENDATION_EXPOSED
          ? draft?.exposureContext : null,
        // 版本快照是**系統當下的事實**，不是呼叫端可以宣告的東西。
        // 前端送什麼都以 server 目前的版本為準。
        versionSnapshot: {
          ...(draft?.versionSnapshot || {}),
          profileSchemaVersion: PROFILE_SCHEMA_VERSION,
          modelVersion: INTERACTION_MODEL_VERSION,
        },
      });
    } catch (err) {
      results.push({
        actionId: draft?.actionId ?? null,
        eventType: draft?.eventType ?? null,
        status: 'rejected',
        errors: [err.message],
      });
      continue;
    }

    if (event.eventType === INTERACTION_EVENT_TYPES.RECOMMENDATION_EXPOSED && options.allowExposureWrite) {
      // 伺服器自己寫曝光事件時跳過來源驗證——它就是來源本身。
    } else {
      try {
        await assertProvenance(identity, event, exposureCache);
      } catch (err) {
        results.push({
          actionId: event.actionId, eventType: event.eventType, status: 'rejected', errors: [err.message],
        });
        continue;
      }
    }

    const existing = await loadByIdempotencyKey(subjectId, identity.canonicalId, event.idempotencyKey);
    const resolution = resolveIdempotentAppend(existing, event);
    if (resolution.status !== 'append') {
      results.push({ actionId: event.actionId, eventType: event.eventType, status: resolution.status });
      continue;
    }

    try {
      await insertEvent(subjectId, event);
      results.push({ actionId: event.actionId, eventType: event.eventType, status: 'append' });
    } catch (err) {
      if (isDuplicateKeyError(err)) {
        // 對抗式審查發現：並行的兩個請求可能用同一個 idempotency key
        // 但內容不同（例如同一次移除，一個填 time、一個填 content）；
        // 兩者在上面的 `resolveIdempotentAppend()` 檢查時都可能還沒看到
        // 對方，於是都嘗試 INSERT，UNIQUE 索引只讓一個成功。先前這裡對
        // 撞鍵一律回 duplicate，完全沒有重新讀出真正寫進去的那筆比對，
        // 等於把「內容不同、只是撞在一起」錯報成「跟你送的一樣」。
        // 現在撞鍵後重新查一次、重新跑一次同一套判定，內容不同才回
        // duplicate 誤報的問題就不會發生。
        const winner = await loadByIdempotencyKey(subjectId, identity.canonicalId, event.idempotencyKey);
        const resolved = resolveIdempotentAppend(winner, event);
        results.push({
          actionId: event.actionId,
          eventType: event.eventType,
          status: resolved.status === 'append' ? 'duplicate' : resolved.status,
        });
        continue;
      }
      if (err instanceof SubjectWithdrawnError || err instanceof ConsentRevokedError) {
        results.push({
          actionId: event.actionId,
          eventType: event.eventType,
          status: 'rejected',
          errors: [err.message],
        });
        continue;
      }
      throw err;
    }
  }

  const recorded = results.filter(result => result.status === 'append').length;
  if (recorded > 0) {
    logger.debug(`已記錄 ${recorded} 筆互動事件（內容不記錄）`, { label: 'Interaction' });
  }
  return { recorded, results };
}

// 讀出「這位使用者確實看過的那一次推薦」，供回饋來源驗證使用。
//
// 為什麼用曝光事件而不是另建一張推薦快照表：`recommendation_exposed` 已經記下
// 這個 subject、這個 requestId、主推方案的 planId，以及 ordered candidateSet 與
// displayedSet。它就是「系統當時對這個人顯示了什麼」的權威紀錄，再存一份等於
// 同一份事實存兩處，而且會為尚未同意個人化的使用者建立新的個資。
// 取這位使用者「最近一次」推薦曝光的 requestId。
//
// **為什麼需要這個**：`requestId` 只出現在排課那一輪的 tool 結果裡，而
// `saveChatExchange()` 只保存使用者訊息與最終文字回覆——下一輪重建對話時
// tool 結果已經不存在，模型手上沒有任何合法的 requestId 可用。結果是
// `record_schedule_feedback` 實際上永遠呼叫不成功：Agent 問了「這份課表符合
// 需求嗎」，使用者答了，訊號卻無處可記。
//
// 改由伺服器把「最近一次推薦是哪一次」直接告訴模型，而不是讓模型自己記或猜。
// 這不會鬆動 `scheduleFeedbackService` 的來源驗證——那裡仍然要對照曝光紀錄，
// 這裡只是把本來就存在資料庫裡的事實補回模型的視野。
export async function findLatestExposureRequestId(identity, surface = 'chat') {
  if (!isPrivacyEnforcementEnabled()) return null;
  const subjectId = deriveSubjectId(identity.canonicalId);
  let rows;
  if (useMemoryStore()) {
    rows = [...memoryStore.events]
      .filter(item => item.subjectId === subjectId && item.eventType === 'recommendation_exposed')
      .sort((a, b) => new Date(b.occurredAt) - new Date(a.occurredAt))
      .slice(0, 10);
  } else if (isMysqlConfigured()) {
    rows = await queryRows(
      `SELECT * FROM Interaction_Events
        WHERE subject_id = ? AND event_type = 'recommendation_exposed'
        ORDER BY occurred_at DESC LIMIT 10`,
      [subjectId]
    );
  }
  if (!rows?.length) return null;

  // 只認同一個介面產生的推薦。排課頁一載入就會自動排一次課並寫下
  // `dashboard / initial_load` 曝光，若不分介面地取「最新一筆」，對話中要記錄的
  // 回饋會對到使用者根本沒在聊天裡看過的那一份課表，sectionId 因此對不上而被拒。
  const events = rows.map(row => rowToEvent(row, identity.canonicalId));
  const match = events.find(event => event.exposureContext?.surface === surface) ?? null;
  if (!match) return null;
  return {
    requestId: match.requestId,
    planId: match.plan?.planId ?? null,
    // 課程的 sectionId 和 requestId 一樣，只出現在那一輪的 tool 結果裡。模型只記得
    // 自己寫過的課名，配不出 id，於是 record_schedule_feedback 會帶著空的
    // rejectedCourses 被後端拒絕。這裡把「那份課表有哪些課」一併帶出去。
    displayedSet: (match.exposureContext?.displayedSet || []).map(course => ({
      sectionId: course.sectionId,
      catalogCourseCode: course.catalogCourseCode,
    })),
  };
}

export async function findExposure(identity, requestId) {
  if (!isPrivacyEnforcementEnabled()) return null;
  const subjectId = deriveSubjectId(identity.canonicalId);
  let row;
  if (useMemoryStore()) {
    row = memoryStore.events.find(item => (
      item.subjectId === subjectId
      && item.requestId === requestId
      && item.eventType === 'recommendation_exposed'
    ));
  } else if (isMysqlConfigured()) {
    [row] = await queryRows(
      `SELECT * FROM Interaction_Events
        WHERE subject_id = ? AND request_id = ? AND event_type = 'recommendation_exposed'
        ORDER BY occurred_at DESC LIMIT 1`,
      [subjectId, requestId]
    );
  }
  if (!row) return null;
  const event = rowToEvent(row, identity.canonicalId);
  // roadmap #27：`displayedPlanIds` 才是「使用者這次真的看得到、能接受的
  // 方案清單」。舊事件（#27 之前寫入的）沒有這個欄位，退回只認主推
  // `plan.planId` 那一個——維持既有資料的相容性，不因為補了欄位就讓歷史
  // 事件全部驗證失敗。
  const displayedPlanIds = event.exposureContext?.displayedPlanIds?.length > 0
    ? event.exposureContext.displayedPlanIds
    : [event.plan?.planId].filter(Boolean);
  return {
    requestId: event.requestId,
    planId: event.plan?.planId ?? null,
    variantId: event.plan?.variantId ?? null,
    displayedPlanIds,
    planPolicies: event.exposureContext?.planPolicies ?? [],
    // 學期取自曝光事件本身，而不是回饋當下的 ACTIVE_TERM——回饋可能跨到
    // 下一個學期才送出，那時的系統常數已經不是當初推薦的那個學期。
    term: event.term,
    displayedSectionIds: new Set(
      (event.exposureContext?.displayedSet || []).map(course => course.sectionId)
    ),
    displayedCourses: new Map(
      (event.exposureContext?.displayedSet || [])
        .map(course => [course.sectionId, course.catalogCourseCode])
    ),
  };
}

// 每日事件量配額，供 `routes/interactions.js` 擋掉無界成長用（對抗式審查
// 發現：50 筆／請求的批次上限不是節流，帳號可以無限次呼叫）。用資料庫
// COUNT 而非行程內計數器，是因為配額必須撐過伺服器重啟——記憶體節流器
// （見 `utils/rateLimiter.js`）處理的是短時間突發流量，兩者職責不同。
export async function countRecentEvents(identity, sinceHoursAgo) {
  const subjectId = deriveSubjectId(identity.canonicalId);
  const since = new Date(Date.now() - sinceHoursAgo * 3600000);
  if (useMemoryStore()) {
    return memoryStore.events.filter(row => (
      row.subjectId === subjectId && new Date(row.occurredAt) >= since
    )).length;
  }
  if (!isMysqlConfigured()) return 0;
  const [row] = await queryRows(
    'SELECT COUNT(*) AS count FROM Interaction_Events WHERE subject_id = ? AND occurred_at >= ?',
    [subjectId, toMysqlDate(since)]
  );
  return Number(row.count);
}

// `limit` 由呼叫端傳入而非在這裡寫死，讓路由的實際門檻可以測試時用小數字
// 驗證邊界，不必真的塞幾千筆事件才測得到「超過」的分支。
export async function wouldExceedDailyQuota(identity, incomingCount, limit) {
  const recent = await countRecentEvents(identity, 24);
  return recent + incomingCount > limit;
}

// 本人匯出。刻意不含 `subject_id` 與 `idempotencyKey`——前者是分析用的內部識別碼，
// 匯出反而讓假名與本人身分在同一份檔案裡被綁在一起；後者是去重用的實作細節。
export async function getInteractionEventsForExport(identity) {
  if (!isPrivacyEnforcementEnabled()) return [];
  const subjectId = deriveSubjectId(identity.canonicalId);
  let rows;
  if (useMemoryStore()) {
    rows = memoryStore.events.filter(row => row.subjectId === subjectId);
  } else if (isMysqlConfigured()) {
    rows = await queryRows(
      'SELECT * FROM Interaction_Events WHERE subject_id = ? ORDER BY occurred_at',
      [subjectId]
    );
  } else {
    return [];
  }
  return rows.map(row => {
    const { userId: _userId, idempotencyKey: _idempotencyKey, ...portable } =
      rowToEvent(row, identity.canonicalId);
    return portable;
  });
}

// Roadmap #31：這個 subject 最新一筆事件的時間，用來判定已存的學習權重是否
// 過期（見 `preferenceLearningService.js` 的 `getPersonalizationSource()`）。
// 沒有事件時回傳 null，不猜測。刻意只查 `MAX(occurred_at)`，不撈整批事件
// ——這支只是「有沒有新資料」的便宜檢查，真正要重算才會呼叫
// `getInteractionEventsForExport()`。
export async function getLatestInteractionEventTime(identity) {
  const subjectId = deriveSubjectId(identity.canonicalId);
  if (useMemoryStore()) {
    const times = memoryStore.events
      .filter(row => row.subjectId === subjectId)
      .map(row => new Date(row.occurredAt).getTime());
    return times.length > 0 ? new Date(Math.max(...times)) : null;
  }
  if (!isMysqlConfigured()) return null;
  // 走既有的 idx_interaction_subject_time（subject_id, occurred_at），
  // 不需要新索引。
  const [row] = await queryRows(
    'SELECT MAX(occurred_at) AS latest FROM Interaction_Events WHERE subject_id = ?',
    [subjectId]
  );
  return row?.latest ? new Date(row.latest) : null;
}

export async function deleteInteractionEvents(subjectId) {
  if (useMemoryStore()) {
    const before = memoryStore.events.length;
    memoryStore.events = memoryStore.events.filter(row => row.subjectId !== subjectId);
    return { interactionEventsDeleted: before - memoryStore.events.length };
  }
  if (!isMysqlConfigured()) return { interactionEventsDeleted: 0 };
  const result = await queryRows('DELETE FROM Interaction_Events WHERE subject_id = ?', [subjectId]);
  return { interactionEventsDeleted: Number(result.affectedRows || 0) };
}

export async function cleanupExpiredInteractionEvents({ dryRun = true } = {}) {
  const now = new Date();
  if (useMemoryStore()) {
    const expired = memoryStore.events.filter(row => new Date(row.expiresAt) <= now).length;
    if (!dryRun) memoryStore.events = memoryStore.events.filter(row => new Date(row.expiresAt) > now);
    return { expiredInteractionEvents: expired };
  }
  if (!isMysqlConfigured()) return { expiredInteractionEvents: 0 };
  const [count] = await queryRows(
    'SELECT COUNT(*) AS count FROM Interaction_Events WHERE expires_at <= UTC_TIMESTAMP(3)'
  );
  if (!dryRun) await queryRows('DELETE FROM Interaction_Events WHERE expires_at <= UTC_TIMESTAMP(3)');
  return { expiredInteractionEvents: Number(count.count) };
}

export default {
  INTERACTION_MODEL_VERSION,
  hasPersonalizationConsent,
  recordInteractionEvents,
  findExposure,
  countRecentEvents,
  wouldExceedDailyQuota,
  getInteractionEventsForExport,
  getLatestInteractionEventTime,
  deleteInteractionEvents,
  cleanupExpiredInteractionEvents,
  resetInteractionEventStoreForTests,
};
