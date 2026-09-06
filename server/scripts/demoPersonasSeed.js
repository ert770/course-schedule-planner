// 三位組員的 demo persona 資料匯入。
//
// 預設只做 dry-run。正式修改 shared MySQL 必須同時傳入
// --apply 與 --confirm-shared-mysql。修課來源預設為目前 Windows 使用者的
// OneDrive/Downloads，也可用 --source-dir=... 覆寫。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { v5 as uuidv5 } from 'uuid';

import { closePool, queryRows, withTransaction } from '../src/db/mysql.js';
import { parseCourseHistoryMarkdown } from '../src/data/courseHistoryMarkdown.js';
import {
  DEMO_PERSONAS,
  DEMO_REFERENCE_TIME,
  DEMO_UUID_NAMESPACE,
  buildDemoPersonaEvents,
  demoPersonaCanonicalId,
  learnDemoPersonaWeights,
} from '../src/data/demoPersonas.js';
import { PRIVACY_POLICY_VERSION, PRIVACY_PURPOSES, PRIVACY_RETENTION } from '../src/data/privacyPolicy.js';
import { deriveSubjectId, toMysqlDate } from '../src/services/privacyService.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '..', '.env'), quiet: true });
dotenv.config({ path: path.resolve(__dirname, '..', '..', '.env'), quiet: true });

const argv = process.argv.slice(2);
const flags = new Set(argv.filter(value => !value.includes('=')));
const apply = flags.has('--apply');
const confirmed = flags.has('--confirm-shared-mysql');
const sourceDirArg = argv.find(value => value.startsWith('--source-dir='));
const sourceDir = sourceDirArg
  ? path.resolve(sourceDirArg.slice('--source-dir='.length))
  : path.join(os.homedir(), 'OneDrive', 'Downloads');

const HISTORY_SOURCE = 'demo_markdown_20260906';
const CONSENT_SOURCE = 'demo_seed';
const REFERENCE_TIME = new Date(DEMO_REFERENCE_TIME);
const LEARNED_EXPIRES_AT = new Date(
  REFERENCE_TIME.getTime() + PRIVACY_RETENTION.interactionEventDays * 86400000
);

function deterministicUuid(value) {
  return uuidv5(value, DEMO_UUID_NAMESPACE);
}

function readHistories() {
  return DEMO_PERSONAS.map(persona => {
    const filePath = path.join(sourceDir, persona.historyFileName);
    if (!fs.existsSync(filePath)) throw new Error(`找不到修課資料：${filePath}`);
    const parsed = parseCourseHistoryMarkdown(fs.readFileSync(filePath, 'utf8'), {
      sourceName: persona.historyFileName,
    });
    return { persona, filePath, ...parsed };
  });
}

async function loadCourseRefs() {
  const rows = await queryRows(
    `SELECT s.section_id, c.subid3
       FROM Course_Sections s
       JOIN Courses c ON c.course_id = s.course_id
      WHERE c.subid3 IS NOT NULL AND TRIM(c.subid3) <> ''
      ORDER BY s.section_id
      LIMIT 50`
  );
  if (rows.length < 50) throw new Error(`建立 demo 事件需要 50 門真實課程，目前只有 ${rows.length} 門`);
  return rows.map(row => ({
    sectionId: Number(row.section_id),
    catalogCourseCode: String(row.subid3),
  }));
}

function buildPayloads(histories, courseRefs) {
  return histories.map(history => {
    const subjectId = deriveSubjectId(demoPersonaCanonicalId(history.persona));
    const events = buildDemoPersonaEvents(history.persona, courseRefs);
    const learned = learnDemoPersonaWeights(history.persona, events);
    return { ...history, subjectId, events, learned };
  });
}

async function loadExistingState(payloads) {
  const state = [];
  for (const payload of payloads) {
    const [profile] = await queryRows(
      'SELECT user_id, name, preference_tags FROM User_Profiles WHERE user_id = ?',
      [payload.persona.userId]
    );
    const historyRows = await queryRows(
      'SELECT history_id, source FROM User_Course_History WHERE user_id = ?',
      [payload.persona.userId]
    );
    const eventRows = await queryRows(
      'SELECT event_id FROM Interaction_Events WHERE subject_id = ?',
      [payload.subjectId]
    );
    const consentRows = await queryRows(
      'SELECT consent_id, source FROM Privacy_Consents WHERE subject_id = ?',
      [payload.subjectId]
    );
    const weightRows = await queryRows(
      'SELECT subject_id, model_version FROM Learned_Preference_Weights WHERE subject_id = ?',
      [payload.subjectId]
    );
    state.push({ profile, historyRows, eventRows, consentRows, weightRows });
  }
  return state;
}

function assertSafeExistingState(payloads, existingState) {
  payloads.forEach((payload, index) => {
    const state = existingState[index];
    if (!state.profile) throw new Error(`User_Profiles.user_id=${payload.persona.userId} 不存在`);
    if (state.profile.name !== payload.persona.name) {
      throw new Error(
        `user ${payload.persona.userId} 姓名不符：預期 ${payload.persona.name}，實際 ${state.profile.name}`
      );
    }
    if (state.historyRows.some(row => row.source !== HISTORY_SOURCE)) {
      throw new Error(`user ${payload.persona.userId} 已有非 demo 的歷史修課資料，拒絕覆寫`);
    }
    const expectedEventIds = new Set(payload.events.map(event => event.eventId));
    if (state.eventRows.some(row => !expectedEventIds.has(row.event_id))) {
      throw new Error(`user ${payload.persona.userId} 已有非本 seed 的互動事件，拒絕混寫`);
    }
    if (state.consentRows.some(row => row.source !== CONSENT_SOURCE)) {
      throw new Error(`user ${payload.persona.userId} 已有非 demo 的 consent，拒絕代替使用者改寫`);
    }
    if (state.weightRows.length > 0 && state.eventRows.length === 0) {
      throw new Error(`user ${payload.persona.userId} 已有非本 seed 可證明的 learned weights，拒絕覆寫`);
    }
  });
}

const HISTORY_SQL = `INSERT INTO User_Course_History
  (user_id, catalog_course_code, academic_year, semester, course_name, score,
   letter_grade, credits, passed, requirement_type, general_education_category,
   graduation_category, source)
 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
 ON DUPLICATE KEY UPDATE
   course_name = VALUES(course_name), score = VALUES(score), letter_grade = VALUES(letter_grade),
   credits = VALUES(credits), passed = VALUES(passed), requirement_type = VALUES(requirement_type),
   general_education_category = VALUES(general_education_category),
   graduation_category = VALUES(graduation_category), source = VALUES(source)`;

function historyParams(userId, entry) {
  return [
    userId, entry.courseCode, entry.academicYear, entry.semester, entry.courseName,
    entry.score, entry.letterGrade, entry.credits, entry.passed ? 1 : 0,
    entry.requirementType, entry.generalEducationCategory, entry.graduationCategory, HISTORY_SOURCE,
  ];
}

const EVENT_SQL = `INSERT INTO Interaction_Events
  (event_id, subject_id, event_type, occurred_at, expires_at, request_id, action_id,
   idempotency_key, catalog_course_code, section_id, academic_year, semester,
   plan_id, variant_id, plan_rank, course_rank, source, feedback_reason,
   schema_version, profile_schema_version, model_version, recommendation_reason_version,
   exposure_json)
 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
 ON DUPLICATE KEY UPDATE
   occurred_at = VALUES(occurred_at), expires_at = VALUES(expires_at),
   request_id = VALUES(request_id), action_id = VALUES(action_id),
   idempotency_key = VALUES(idempotency_key), catalog_course_code = VALUES(catalog_course_code),
   section_id = VALUES(section_id), academic_year = VALUES(academic_year),
   semester = VALUES(semester), plan_id = VALUES(plan_id), variant_id = VALUES(variant_id),
   plan_rank = VALUES(plan_rank), course_rank = VALUES(course_rank), source = VALUES(source),
   feedback_reason = VALUES(feedback_reason), schema_version = VALUES(schema_version),
   profile_schema_version = VALUES(profile_schema_version), model_version = VALUES(model_version),
   recommendation_reason_version = VALUES(recommendation_reason_version),
   exposure_json = VALUES(exposure_json)`;

function eventParams(subjectId, event) {
  const expiresAt = new Date(
    new Date(event.timestamp).getTime() + PRIVACY_RETENTION.interactionEventDays * 86400000
  );
  return [
    event.eventId, subjectId, event.eventType, toMysqlDate(event.timestamp), toMysqlDate(expiresAt),
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

async function applyPayloads(payloads) {
  await withTransaction(async connection => {
    for (const payload of payloads) {
      const userId = payload.persona.userId;
      for (const entry of payload.entries) {
        await connection.execute(HISTORY_SQL, historyParams(userId, entry));
      }

      const [profileUpdate] = await connection.execute(
        'UPDATE User_Profiles SET preference_tags = ? WHERE user_id = ?',
        [JSON.stringify(payload.persona.preferenceTags), userId]
      );
      if (profileUpdate.affectedRows !== 1) throw new Error(`user ${userId} profile 更新失敗`);

      await connection.execute(
        `INSERT INTO Privacy_Subject_State
          (subject_id, last_active_at, service_withdrawn_at, created_at, updated_at)
         VALUES (?, ?, NULL, ?, ?)
         ON DUPLICATE KEY UPDATE
          last_active_at = VALUES(last_active_at), service_withdrawn_at = NULL,
          updated_at = VALUES(updated_at)`,
        [payload.subjectId, toMysqlDate(REFERENCE_TIME), toMysqlDate(REFERENCE_TIME), toMysqlDate(REFERENCE_TIME)]
      );

      for (const purpose of [
        PRIVACY_PURPOSES.SERVICE_PROCESSING,
        PRIVACY_PURPOSES.PERSONALIZATION_LEARNING,
      ]) {
        await connection.execute(
          `INSERT INTO Privacy_Consents
            (consent_id, subject_id, purpose, granted, policy_version, decided_at, source, request_id)
           VALUES (?, ?, ?, 1, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE
            granted = VALUES(granted), policy_version = VALUES(policy_version),
            decided_at = VALUES(decided_at), source = VALUES(source), request_id = VALUES(request_id)`,
          [
            deterministicUuid(`demo-persona-${userId}-consent-${purpose}`),
            payload.subjectId, purpose, PRIVACY_POLICY_VERSION, toMysqlDate(REFERENCE_TIME),
            CONSENT_SOURCE, `demo-persona-${userId}`,
          ]
        );
      }

      for (const event of payload.events) {
        await connection.execute(EVENT_SQL, eventParams(payload.subjectId, event));
      }

      const learned = payload.learned;
      await connection.execute(
        `INSERT INTO Learned_Preference_Weights
          (subject_id, model_version, interest_weight, compact_weight, easy_weight,
           sufficiency_status, usable_event_count, required_event_count, evidence_json,
           computed_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
          model_version = VALUES(model_version), interest_weight = VALUES(interest_weight),
          compact_weight = VALUES(compact_weight), easy_weight = VALUES(easy_weight),
          sufficiency_status = VALUES(sufficiency_status),
          usable_event_count = VALUES(usable_event_count),
          required_event_count = VALUES(required_event_count), evidence_json = VALUES(evidence_json),
          computed_at = VALUES(computed_at), expires_at = VALUES(expires_at)`,
        [
          payload.subjectId, learned.modelVersion,
          learned.weights.interest, learned.weights.compact, learned.weights.easy,
          learned.sufficiency.status, learned.sufficiency.usableEventCount,
          learned.sufficiency.requiredEventCount, JSON.stringify(learned.evidence),
          toMysqlDate(REFERENCE_TIME), toMysqlDate(LEARNED_EXPIRES_AT),
        ]
      );
    }
  });
}

async function verification(payloads) {
  const results = [];
  for (const payload of payloads) {
    const [profile] = await queryRows(
      'SELECT preference_tags FROM User_Profiles WHERE user_id = ?',
      [payload.persona.userId]
    );
    const [history] = await queryRows(
      'SELECT COUNT(*) AS count FROM User_Course_History WHERE user_id = ? AND source = ?',
      [payload.persona.userId, HISTORY_SOURCE]
    );
    const [events] = await queryRows(
      'SELECT COUNT(*) AS count FROM Interaction_Events WHERE subject_id = ?',
      [payload.subjectId]
    );
    const [weights] = await queryRows(
      `SELECT model_version, interest_weight, compact_weight, easy_weight,
              sufficiency_status, usable_event_count
         FROM Learned_Preference_Weights WHERE subject_id = ?`,
      [payload.subjectId]
    );
    results.push({
      userId: payload.persona.userId,
      name: payload.persona.name,
      historyRows: Number(history.count),
      preferenceTags: typeof profile.preference_tags === 'string'
        ? JSON.parse(profile.preference_tags) : profile.preference_tags,
      interactionEvents: Number(events.count),
      learnedWeights: weights ? {
        modelVersion: weights.model_version,
        interest: Number(weights.interest_weight),
        compact: Number(weights.compact_weight),
        easy: Number(weights.easy_weight),
        status: weights.sufficiency_status,
        usableEventCount: Number(weights.usable_event_count),
      } : null,
    });
  }
  return results;
}

async function run() {
  const histories = readHistories();
  const courseRefs = await loadCourseRefs();
  const payloads = buildPayloads(histories, courseRefs);
  const existingState = await loadExistingState(payloads);
  assertSafeExistingState(payloads, existingState);

  console.log(JSON.stringify({
    mode: apply ? 'apply' : 'dry-run',
    sourceDir,
    personas: payloads.map((payload, index) => ({
      userId: payload.persona.userId,
      name: payload.persona.name,
      historyRows: payload.entries.length,
      skippedWithoutCourseCode: payload.skippedWithoutCourseCode,
      duplicateRows: payload.duplicateRows,
      warnings: payload.warnings,
      preferenceTags: payload.persona.preferenceTags,
      interactionEvents: payload.events.length,
      learnedWeights: payload.learned.weights,
      sufficiency: payload.learned.sufficiency,
      existing: {
        historyRows: existingState[index].historyRows.length,
        interactionEvents: existingState[index].eventRows.length,
        learnedWeightRows: existingState[index].weightRows.length,
      },
    })),
  }, null, 2));

  if (!apply) return;
  if (!confirmed) throw new Error('修改 shared MySQL 前必須加上 --confirm-shared-mysql');
  await applyPayloads(payloads);
  console.log(JSON.stringify({ applied: true, verification: await verification(payloads) }, null, 2));
}

run().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
}).finally(() => closePool());
