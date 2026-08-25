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
  getConsentStatus,
  isPrivacyEnforcementEnabled,
  readSubjectState,
  toMysqlDate,
  useMemoryStore,
} from './privacyService.js';
import {
  createInteractionEvent,
  resolveIdempotentAppend,
} from '../data/interactionEventSchema.js';
import { logger } from '../utils/logger.js';

// 產生這批推薦的模型版本。#7 用連續權重向量取代固定 variant 時要一併改這個值，
// 否則 #30 會把兩種不同模型產生的曝光混為一談。
export const INTERACTION_MODEL_VERSION = 'scheduler-greedy-v1';

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

function assertWritable(state) {
  // 沒有 subject 列代表從來沒有記錄過 consent；有 `serviceWithdrawnAt` 代表帳號已刪除。
  if (!state || state.serviceWithdrawnAt) throw new SubjectWithdrawnError();
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

// 「確認未撤回」與「寫入」必須在同一個交易、同一把列鎖底下完成。
//
// 先前的寫法是 `touchSubject()` 直接 upsert 再 insert，兩者各自 autocommit：
// 一個已通過 consent 檢查、正在執行中的請求，可以在帳號刪除**跑完之後**才落地，
// 甚至把已被刪掉的 subject 列重新建回來——刪除 API 回報成功，資料卻還在。
//
// 現在流程固定為 SELECT ... FOR UPDATE → 檢查 `service_withdrawn_at` → 更新
// `last_active_at` → INSERT。刪除端則先 `markServiceWithdrawn()` 再刪資料，
// 因此並行的寫入只有兩種結局：搶在撤回之前落地（隨後被刪除清掉），
// 或是等到鎖釋放後看到已撤回而被拒絕。兩者都不會留下殘存資料。
async function insertEvent(subjectId, event) {
  const occurredAt = new Date(event.timestamp);
  const expiresAt = expiryFrom(event.timestamp);

  if (useMemoryStore()) {
    assertWritable(await readSubjectState(subjectId));
    memoryStore.events.push(memoryEventRow(subjectId, event, occurredAt, expiresAt));
    return;
  }

  await withTransaction(async connection => {
    assertWritable(await readSubjectState(subjectId, connection));
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
  const status = await getConsentStatus(identity);
  return status.consents?.[PRIVACY_PURPOSES.PERSONALIZATION_LEARNING]?.granted === true;
}

/**
 * 記錄一批互動事件。
 *
 * @param identity `resolveIdentity()` 的結果。
 * @param inputs   #29 shape 的 event draft 陣列；envelope 欄位一律由 server 覆寫。
 * @returns `{ recorded, reason?, results: [{ actionId, eventType, status, errors? }] }`
 *          `status` 為 append｜duplicate｜conflict｜rejected。
 */
export async function recordInteractionEvents(identity, inputs = []) {
  const drafts = Array.isArray(inputs) ? inputs : [];
  if (!await hasPersonalizationConsent(identity)) {
    return { recorded: false, reason: 'CONSENT_NOT_GRANTED', results: [] };
  }

  const subjectId = deriveSubjectId(identity.canonicalId);
  const results = [];

  for (const draft of drafts) {
    let event;
    try {
      event = createInteractionEvent(identity, {
        ...draft,
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
      // 並行的同一操作可能兩次都通過上面的檢查。UNIQUE 索引是最後一道，
      // 撞到就是 duplicate——不重試、不覆寫。
      if (isDuplicateKeyError(err)) {
        results.push({ actionId: event.actionId, eventType: event.eventType, status: 'duplicate' });
        continue;
      }
      if (err instanceof SubjectWithdrawnError) {
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
  return {
    requestId: event.requestId,
    planId: event.plan?.planId ?? null,
    variantId: event.plan?.variantId ?? null,
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
  getInteractionEventsForExport,
  deleteInteractionEvents,
  cleanupExpiredInteractionEvents,
  resetInteractionEventStoreForTests,
};
