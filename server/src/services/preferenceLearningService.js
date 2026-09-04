// Roadmap #30：`preferenceLearning.js`（純函式）與儲存體之間的那一層。
//
// 跟 `interactionEventService.js` 對 #29 的關係一樣：這裡負責純函式模組
// 明文交出去的三件事——consent 先於任何運算與寫入、canonical ID 不進儲存體
// （鍵一律是 #33 的 HMAC `subject_id`）、以及跟 `Interaction_Events` 同一套
// 「有 MySQL 用 MySQL、測試環境用記憶體」的切換規則。
//
// `Learned_Preference_Weights` 是**推導狀態**，不是像 `Interaction_Events`
// 那樣的事實紀錄：每次重算直接覆寫同一列（`subject_id` 是主鍵），不留歷史。
// 這是刻意的——真正的事實來源是互動事件本身，權重永遠可以從那裡重新推導出來，
// 保留多版本歷史只會製造第二個要保持同步的真相來源。
import { isMysqlConfigured, queryRows } from '../db/mysql.js';
import { PRIVACY_RETENTION } from '../data/privacyPolicy.js';
import { deriveSubjectId, toMysqlDate, useMemoryStore } from './privacyService.js';
import { hasPersonalizationConsent, getInteractionEventsForExport } from './interactionEventService.js';
import { getUserPreferences } from './memoryService.js';
import {
  PREFERENCE_AXES,
  SUFFICIENCY_STATUS,
  learnPreferenceWeights,
} from '../skills/preferenceLearning.js';

const memoryStore = { weights: new Map() };

export function resetLearnedWeightsStoreForTests() {
  memoryStore.weights = new Map();
}

function nowDate() {
  return new Date();
}

function expiryFrom(computedAt) {
  return new Date(computedAt.getTime() + PRIVACY_RETENTION.interactionEventDays * 86400000);
}

// 使用者目前的顯式設定，形狀同 `scheduler.js` 的 `buildPreferenceProfile()`。
//
// **只有 `compact` 今天真的有對應的已存欄位**（`preferenceTags` 的
// `#盡量集中排課` → `preferCompact`）。`easy`／`interest` 在現行 Profile schema
// 裡沒有對應的顯式勾選——`interest` 是刻意設計成只在單次請求時由使用者輸入
// （`#10` 明文：`interests` 不從 `preferenceTags` 回填，因為排課偏好 ≠ 興趣
// 主題），`easy` 則從來沒有一個「我要涼課優先」的 checkbox。因此這兩軸的顯式
// 基準今天恆為 0，不是遺漏——沒有顯式設定的地方就該是 0，不是用推論冒充。
function deriveExplicitProfile(prefs) {
  return {
    interest: 0,
    compact: prefs?.preferCompact ? 1 : 0,
    easy: 0,
  };
}

function toRow(subjectId, result, computedAt) {
  return {
    subjectId,
    modelVersion: result.modelVersion,
    interestWeight: result.weights.interest,
    compactWeight: result.weights.compact,
    easyWeight: result.weights.easy,
    sufficiencyStatus: result.sufficiency.status,
    usableEventCount: result.sufficiency.usableEventCount,
    requiredEventCount: result.sufficiency.requiredEventCount,
    evidence: result.evidence,
    computedAt: computedAt.toISOString(),
    expiresAt: expiryFrom(computedAt).toISOString(),
  };
}

function rowToWeights(row) {
  if (!row) return null;
  const evidence = row.evidence ?? row.evidence_json;
  const computedAt = row.computedAt ?? row.computed_at;
  return {
    modelVersion: row.modelVersion ?? row.model_version,
    weights: {
      interest: Number(row.interestWeight ?? row.interest_weight),
      compact: Number(row.compactWeight ?? row.compact_weight),
      easy: Number(row.easyWeight ?? row.easy_weight),
    },
    sufficiency: {
      status: row.sufficiencyStatus ?? row.sufficiency_status,
      usableEventCount: Number(row.usableEventCount ?? row.usable_event_count),
      requiredEventCount: Number(row.requiredEventCount ?? row.required_event_count),
    },
    evidence: typeof evidence === 'string' ? JSON.parse(evidence) : evidence,
    computedAt: computedAt instanceof Date ? computedAt.toISOString() : computedAt,
  };
}

async function upsertRow(row) {
  if (useMemoryStore()) {
    memoryStore.weights.set(row.subjectId, row);
    return;
  }
  if (!isMysqlConfigured()) return;
  await queryRows(
    `INSERT INTO Learned_Preference_Weights
      (subject_id, model_version, interest_weight, compact_weight, easy_weight,
       sufficiency_status, usable_event_count, required_event_count, evidence_json,
       computed_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       model_version = VALUES(model_version),
       interest_weight = VALUES(interest_weight),
       compact_weight = VALUES(compact_weight),
       easy_weight = VALUES(easy_weight),
       sufficiency_status = VALUES(sufficiency_status),
       usable_event_count = VALUES(usable_event_count),
       required_event_count = VALUES(required_event_count),
       evidence_json = VALUES(evidence_json),
       computed_at = VALUES(computed_at),
       expires_at = VALUES(expires_at)`,
    [
      row.subjectId, row.modelVersion, row.interestWeight, row.compactWeight, row.easyWeight,
      row.sufficiencyStatus, row.usableEventCount, row.requiredEventCount, JSON.stringify(row.evidence),
      toMysqlDate(row.computedAt), toMysqlDate(row.expiresAt),
    ]
  );
}

/**
 * 對指定使用者重算一次偏好權重並覆寫儲存的那一列。
 *
 * **這輪不接進排課**（見 roadmap #30 的 3.6）——這個函式的輸出目前只寫進
 * `Learned_Preference_Weights`，`buildScheduleConstraints()`／
 * `buildPreferenceProfile()` 都不讀它。
 */
export async function recomputeLearnedWeights(identity, options = {}) {
  const subjectId = deriveSubjectId(identity.canonicalId);

  if (!await hasPersonalizationConsent(identity)) {
    return {
      modelVersion: null,
      weights: null,
      sufficiency: { status: SUFFICIENCY_STATUS.NO_CONSENT, usableEventCount: 0, requiredEventCount: null, missingAxes: PREFERENCE_AXES },
      evidence: null,
    };
  }

  // `options.prefs`：已載入的 profile，比照 `scheduleService.generateForUser()`
  // 的同名參數——避免重複查詢，也讓測試能在不具備真實 `numericId`（Profile
  // 讀取需要對得到 `User_Course_History.user_id`）的合成身分上跑，不必每個
  // 單元測試都連一次真實 MySQL。production 呼叫端不傳這個參數。
  const [events, prefs] = await Promise.all([
    getInteractionEventsForExport(identity),
    options.prefs ?? getUserPreferences(identity),
  ]);

  const result = learnPreferenceWeights(events, { explicitProfile: deriveExplicitProfile(prefs) });
  await upsertRow(toRow(subjectId, result, nowDate()));
  return result;
}

/** 讀取目前存的那一列，不重算。供 `#33` 的匯出路徑使用。 */
export async function getStoredLearnedWeights(identity) {
  const subjectId = deriveSubjectId(identity.canonicalId);
  if (useMemoryStore()) {
    return rowToWeights(memoryStore.weights.get(subjectId) ?? null);
  }
  if (!isMysqlConfigured()) return null;
  const rows = await queryRows('SELECT * FROM Learned_Preference_Weights WHERE subject_id = ?', [subjectId]);
  return rowToWeights(rows[0] ?? null);
}

/** 供 `#33` 刪除路徑使用，`subjectId` 已由呼叫端算好（與 `deleteInteractionEvents` 同介面）。 */
export async function deleteLearnedWeights(subjectId) {
  if (useMemoryStore()) {
    const existed = memoryStore.weights.delete(subjectId);
    return { learnedWeightsDeleted: existed ? 1 : 0 };
  }
  if (!isMysqlConfigured()) return { learnedWeightsDeleted: 0 };
  const result = await queryRows('DELETE FROM Learned_Preference_Weights WHERE subject_id = ?', [subjectId]);
  return { learnedWeightsDeleted: Number(result.affectedRows || 0) };
}

export async function cleanupExpiredLearnedWeights({ dryRun = true } = {}) {
  const now = nowDate();
  if (useMemoryStore()) {
    const expired = [...memoryStore.weights.values()].filter(row => new Date(row.expiresAt) <= now).length;
    if (!dryRun) {
      for (const [key, row] of memoryStore.weights) {
        if (new Date(row.expiresAt) <= now) memoryStore.weights.delete(key);
      }
    }
    return { expiredLearnedWeights: expired };
  }
  if (!isMysqlConfigured()) return { expiredLearnedWeights: 0 };
  const [count] = await queryRows(
    'SELECT COUNT(*) AS count FROM Learned_Preference_Weights WHERE expires_at <= UTC_TIMESTAMP(3)'
  );
  if (!dryRun) await queryRows('DELETE FROM Learned_Preference_Weights WHERE expires_at <= UTC_TIMESTAMP(3)');
  return { expiredLearnedWeights: Number(count.count) };
}

export default {
  recomputeLearnedWeights,
  getStoredLearnedWeights,
  deleteLearnedWeights,
  cleanupExpiredLearnedWeights,
  resetLearnedWeightsStoreForTests,
};
