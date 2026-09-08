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
import { ACTIVE_TERM } from '../data/activeTerm.js';
import { deriveSubjectId, toMysqlDate, useMemoryStore, writeAudit } from './privacyService.js';
import {
  hasPersonalizationConsent,
  getInteractionEventsForExport,
  getLatestInteractionEventTime,
  deleteInteractionEvents,
} from './interactionEventService.js';
import { getUserPreferences } from './memoryService.js';
import {
  PREFERENCE_AXES,
  SUFFICIENCY_STATUS,
  PREFERENCE_LEARNING_MODEL_VERSION,
  REQUIRED_USABLE_EVENT_COUNT,
  learnPreferenceWeights,
  computeLearnedBoosts,
} from '../skills/preferenceLearning.js';

// Roadmap #5B（2026-09-05）：學到的權重已接進排課——但只在**方案層**。
// `scheduler.js` 的 `evaluatePreference()`（決定五個方案哪一個主推）會透過
// `getSchedulingPreferenceWeights()` 讀取並套用；`computeScoreComponents()`／
// `scoreCourse()`（決定單一門課的名次）**沒有**接，那是 `#7` 用連續權重向量
// 取代五個固定 variant 時的工作。呼叫端（`getPersonalizationSource()` 的
// 回傳、`PreferenceSourceBadge` 的文案）不必因此再改——`appliedToScheduling`
// 的語意本來就只承諾「有進排課決策」，不是「每個層級都用到」。
export const LEARNED_WEIGHTS_APPLIED_TO_SCHEDULING = true;

// Roadmap #31：`getPersonalizationSource()` 的過期判定用——純時間衰減即使
// 沒有新事件也會讓結果隨時間改變，因此已存的權重列即使沒有新事件也要有個
// 上限重算頻率。一天遠低於 `PREFERENCE_DECAY_HALF_LIFE_DAYS`（120 天），
// 成本是每人每天最多一次重算，且不可能讓來源標示明顯落後。
const STALENESS_TTL_MS = 24 * 60 * 60 * 1000;

const memoryStore = { weights: new Map() };

export function resetLearnedWeightsStoreForTests() {
  memoryStore.weights = new Map();
}

/**
 * 測試用：直接寫入一列指定 `modelVersion` 的已存權重，不經過
 * `learnPreferenceWeights()`。用來驗證「已存列的 modelVersion 跟現行版本不符
 * 時會被視為過期並重算」——`learnPreferenceWeights()` 從不產出舊版字串，
 * 沒有其他管道能讓一列停留在 `#31` 升版前的 `v1`，只能用測試專用的方式
 * 直接竄改。與 `privacyService.js` 的 `seedOutdatedConsentForTests()` 同一個模式。
 */
export async function seedStaleModelVersionForTests(subjectId, { modelVersion = 'preference-learning-v1', computedAt = new Date() } = {}) {
  await upsertRow({
    subjectId,
    modelVersion,
    interestWeight: 0,
    compactWeight: 0.5,
    easyWeight: 0,
    sufficiencyStatus: SUFFICIENCY_STATUS.SUFFICIENT,
    usableEventCount: REQUIRED_USABLE_EVENT_COUNT,
    requiredEventCount: REQUIRED_USABLE_EVENT_COUNT,
    evidence: { interest: [], compact: [], easy: [] },
    computedAt: computedAt.toISOString(),
    expiresAt: expiryFrom(computedAt).toISOString(),
  });
}

function nowDate() {
  return new Date();
}

function expiryFrom(computedAt) {
  return new Date(computedAt.getTime() + PRIVACY_RETENTION.interactionEventDays * 86400000);
}

// 使用者目前的顯式設定，形狀同 `scheduler.js` 的 `buildPreferenceProfile()`。
// 這是學習器的**先驗強度基準**，不是排課要用的最終權重——後者的方向與大小
// 由 `scheduler.js` 的 `axisWeight()` 另外算，見下方 `easy` 的說明。
//
// **只有 `compact` 今天真的有對應的已存欄位**（`preferenceTags` 的
// `#盡量集中排課` → `preferCompact`）。`interest` 是刻意設計成只在單次請求時由
// 使用者輸入（`#10` 明文：`interests` 不從 `preferenceTags` 回填，因為排課偏好
// ≠ 興趣主題），因此這一軸的顯式基準恆為 0，不是遺漏。
//
// **roadmap #5B 之後，`#涼課優先`／`#挑戰難課` 已經是真的 checkbox，但 `easy`
// 這裡仍然刻意維持 0。** 把它設成 1 會讓 `foldAxis()` 的下限
// （`Math.max(clamp01(shrunk), prior)`）把學到的值釘死在 1，
// `computeLearnedBoosts()` 算出的 boost 永遠是 0，easy 軸就再也學不動——
// 這個 profile 只負責「先驗有多強」，方向與下限的保證改由排課端
// （`scheduler.js` 的 `resolveEasyDirection()` 與 `EXPLICIT_AXIS_BASE`）
// 各自負責，兩個保證分開放才都成立。
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

  // Roadmap #31：`now`／`activeTerm` 預設用真正的時鐘與系統目前學期，
  // 呼叫端（測試）可覆寫成固定值以保持可重播——與 `options.prefs` 同一個
  // 模式。省略時退回 `nowDate()`／`ACTIVE_TERM`，行為即時間衰減與學期降權
  // 都套用最新狀態。
  const now = options.now ?? nowDate();
  const activeTerm = options.activeTerm ?? ACTIVE_TERM;

  const result = learnPreferenceWeights(events, {
    explicitProfile: deriveExplicitProfile(prefs),
    now,
    activeTerm,
  });
  await upsertRow(toRow(subjectId, result, new Date(now)));
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

/**
 * Roadmap #5B：排課要用的權重。**只讀已存的那一列，絕不重算。**
 *
 * 與 `getPersonalizationSource()` 的差別是刻意的：那支是給來源標示 UI 的，
 * 允許過期時順手重算（一次全量事件掃描**加一次寫入**）；排課是熱路徑，
 * 每次產生課表都會走一次，不能把一次讀取變成一次全量重算加一次寫入。
 * 這裡的語意因此是「用上一次算好的結果」，落後由回傳的 `computedAt` 誠實
 * 揭露，不隱藏。
 *
 * **使用時重新檢查 consent，不倚賴 `#31` 的撤回鉤子已經刪掉那一列**——
 * 「用了已撤回同意的資料推導出的權重」正是 `#33` 存在要防的失敗，多一次
 * 查詢換這個保證是值得的。
 *
 * @returns `{ applied, reason, boosts, modelVersion, computedAt, sufficiency }`。
 *          `applied !== true` 時 `scheduler.js` 一律退回今天的顯式 0/1 行為。
 *          `reason` ∈ `no-consent | absent | stale-model-version | insufficient | applied`。
 */
export async function getSchedulingPreferenceWeights(identity, options = {}) {
  const absent = reason => ({
    applied: false, reason, boosts: null, modelVersion: null, computedAt: null, sufficiency: null,
  });

  if (!await hasPersonalizationConsent(identity)) return absent('no-consent');

  const stored = await getStoredLearnedWeights(identity);
  if (!stored) return absent('absent');
  if (stored.modelVersion !== PREFERENCE_LEARNING_MODEL_VERSION) return absent('stale-model-version');
  if (stored.sufficiency?.status !== SUFFICIENCY_STATUS.SUFFICIENT) return absent('insufficient');

  const explicitProfile = deriveExplicitProfile(options.prefs ?? await getUserPreferences(identity));
  return {
    applied: true,
    reason: 'applied',
    boosts: computeLearnedBoosts(stored.weights, explicitProfile),
    modelVersion: stored.modelVersion,
    computedAt: stored.computedAt,
    sufficiency: stored.sufficiency,
  };
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

/**
 * Roadmap #31：重設個人化——清掉學到的權重與作為其輸入的互動事件，
 * **不動顯式 Profile**。`User_Profiles`（偏好標籤、避開時段、學分上限）
 * 完全不在這個函式的觸及範圍內。
 *
 * 連互動事件一起刪是刻意的，不是誤刪：權重是事件的純推導，若只刪推導出的
 * 那一列，下一次讀取（`getPersonalizationSource()` 的過期重算）就會用一模
 * 一樣的事件重新算出一模一樣的值——一個會自己復原的「重設」比沒有這個功能
 * 更糟，而且直接違反「重設後 learned weights 確實清除」這條驗收標準。
 * `privacyPolicy.js` 的 `personalization_learning.data` 本來就同時列了
 * `pseudonymous_interaction_events` 與 `learned_preference_weights`，
 * 兩者是同一個 consent 涵蓋的資料，一起刪也站得住腳。
 */
export async function resetPersonalization(identity, { requestId = null } = {}) {
  const subjectId = deriveSubjectId(identity.canonicalId);
  const learned = await deleteLearnedWeights(subjectId);
  const events = await deleteInteractionEvents(subjectId);
  const deleted = { ...learned, ...events };
  await writeAudit(subjectId, 'delete', 'learned_preference_weights', 'success', deleted, requestId);
  return { ...deleted, profilePreserved: true };
}

/**
 * Roadmap #31：目前個人化用的是顯式設定、學到的權重、還是資料不足／未同意。
 *
 * **已存 + 精確過期判定，不是每次都重算**：正式環境目前沒有任何東西主動呼叫
 * `recomputeLearnedWeights()`，只讀已存的話每個人永遠是 `null`；每次都重算
 * 又讓一次 GET 付出全量事件掃描的代價。過期只在下列任一條件成立時才觸發：
 * 從沒算過、`modelVersion` 是舊版（`#31` 把 v1 升成 v2）、有新事件、
 * 或已存結果超過一天沒更新——最後一條是因為時間衰減即使沒有新事件也會讓
 * 結果隨時間改變，一天遠低於半衰期，成本可忽略。
 */
export async function getPersonalizationSource(identity, options = {}) {
  const consented = await hasPersonalizationConsent(identity);
  if (!consented) {
    return {
      source: SUFFICIENCY_STATUS.NO_CONSENT,
      appliedToScheduling: LEARNED_WEIGHTS_APPLIED_TO_SCHEDULING,
      explicitProfileEmpty: null,
      weights: null,
      explicitProfile: null,
      sufficiency: {
        status: SUFFICIENCY_STATUS.NO_CONSENT,
        usableEventCount: 0,
        requiredEventCount: null,
        missingAxes: PREFERENCE_AXES,
      },
      modelVersion: null,
      computedAt: null,
    };
  }

  const prefs = options.prefs ?? await getUserPreferences(identity);
  const explicitProfile = deriveExplicitProfile(prefs);
  const explicitProfileEmpty = PREFERENCE_AXES.every(axis => (explicitProfile[axis] ?? 0) === 0);

  // `options.now`／`options.activeTerm`：跟 `recomputeLearnedWeights()` 一樣的
  // 覆寫模式，讓測試能固定時鐘；production 呼叫端不傳，退回真實現在時間。
  const now = options.now ?? nowDate();

  let stored = await getStoredLearnedWeights(identity);
  const latestEventAt = await getLatestInteractionEventTime(identity);
  const staleByAge = stored?.computedAt
    ? new Date(now).getTime() - new Date(stored.computedAt).getTime() > STALENESS_TTL_MS
    : true;
  const staleByNewEvent = Boolean(
    stored?.computedAt && latestEventAt && new Date(latestEventAt) > new Date(stored.computedAt)
  );
  const stale = !stored || stored.modelVersion !== PREFERENCE_LEARNING_MODEL_VERSION || staleByNewEvent || staleByAge;

  if (stale) {
    await recomputeLearnedWeights(identity, { prefs, now: options.now, activeTerm: options.activeTerm });
    stored = await getStoredLearnedWeights(identity);
  }

  const sufficiency = stored?.sufficiency ?? {
    status: SUFFICIENCY_STATUS.INSUFFICIENT,
    usableEventCount: 0,
    requiredEventCount: REQUIRED_USABLE_EVENT_COUNT,
    missingAxes: PREFERENCE_AXES,
  };
  const weights = stored?.weights ?? explicitProfile;

  let source;
  if (sufficiency.status !== SUFFICIENCY_STATUS.SUFFICIENT) {
    source = SUFFICIENCY_STATUS.INSUFFICIENT;
  } else {
    // 浮點誤差留一點餘裕，不因四捨五入的雜訊就誤判成「學到了」。
    const learnedDiffers = PREFERENCE_AXES.some(
      axis => Math.abs((weights[axis] ?? 0) - (explicitProfile[axis] ?? 0)) > 0.0005
    );
    source = learnedDiffers ? 'learned' : 'explicit';
  }

  return {
    source,
    appliedToScheduling: LEARNED_WEIGHTS_APPLIED_TO_SCHEDULING,
    explicitProfileEmpty,
    weights,
    explicitProfile,
    sufficiency,
    modelVersion: stored?.modelVersion ?? null,
    computedAt: stored?.computedAt ?? null,
  };
}

export default {
  LEARNED_WEIGHTS_APPLIED_TO_SCHEDULING,
  recomputeLearnedWeights,
  getStoredLearnedWeights,
  getSchedulingPreferenceWeights,
  deleteLearnedWeights,
  cleanupExpiredLearnedWeights,
  resetPersonalization,
  getPersonalizationSource,
  resetLearnedWeightsStoreForTests,
  seedStaleModelVersionForTests,
};
