// 協同過濾與 User Embedding 構想階段 7：課程共現表（Course_Neighbors）的建立、儲存與讀取。
//
// - 貢獻者：現行政策下同時同意 personalization_learning 與 collaborative_learning 的人
//   （privacyService.listCollaborativeContributors）。學號只在讀取修課歷史時使用，
//   共現表只存課號、相似度與共現人數，不存任何 subject 或學號。
// - 正式儲存的表只由真人組成；Persona（帳號 9001～9010）與 demo（同意來源不是隱私中心）只能在 dry-run 驗證管線時加入。
// - 每次重建整張換新（新的 build 寫入後刪除舊 build），撤回同意的人下一次重建起就不在表內。
// - 每 24 小時重建一次；有人撤回 collaborative_learning 時提前重建。
import crypto from 'node:crypto';
import { ACTIVE_TERM } from '../data/activeTerm.js';
import { PRIVACY_RETENTION } from '../data/privacyPolicy.js';
import { getAll } from '../db/database.js';
import { isMysqlConfigured, queryRows, withTransaction } from '../db/mysql.js';
import { resolveIdentityFrom } from './identityService.js';
import { isPersonaAccount } from '../data/simulatedAccounts.js';
import { deriveSubjectId, listCollaborativeContributors, toMysqlDate } from './privacyService.js';
import { getUserPreferences } from './memoryService.js';
import { getInteractionEventsForExport } from './interactionEventService.js';
import {
  CF_DEFAULTS,
  CF_MODEL_VERSION,
  buildCourseNeighbors,
  buildUserCourseSignals,
  evaluateCfActivationGate,
} from '../skills/itemItemCf.js';
import { logger } from '../utils/logger.js';

export const COURSE_NEIGHBOR_REBUILD_INTERVAL_MS = 24 * 60 * 60 * 1000;
const READ_CACHE_TTL_MS = 10 * 60 * 1000;
const INSERT_BATCH_SIZE = 500;

let memoryBuild = null;
let readCache = null;

function retainedEvents(events, now) {
  const retentionMs = PRIVACY_RETENTION.interactionEventDays * 86400000;
  return events.filter(event => {
    const time = Date.parse(event.timestamp ?? '');
    return Number.isFinite(time) && now.getTime() - time <= retentionMs;
  });
}

/** 讀取每位貢獻者的課程訊號。學號只在這裡用來讀修課歷史，不進入輸出。 */
export async function collectContributorSignals({ includeSimulated = false, now = new Date(), deps = {} } = {}) {
  const contributors = await (deps.listContributors ?? listCollaborativeContributors)();
  const users = await (deps.loadUsers ?? (() => getAll('users')))();
  const loadProfile = deps.loadProfile ?? getUserPreferences;
  const loadEvents = deps.loadEvents ?? getInteractionEventsForExport;
  const results = [];
  let skippedSimulated = 0;
  for (const user of users) {
    const identity = resolveIdentityFrom(users, user.studentId ?? user.id);
    if (!identity.found) continue;
    const consent = contributors.get(deriveSubjectId(identity.canonicalId));
    if (!consent) continue;
    // Persona 帳號一律視為模擬，不論同意是在哪裡做的。
    const info = { ...consent, simulated: consent.simulated || isPersonaAccount(user) };
    if (info.simulated && !includeSimulated) { skippedSimulated += 1; continue; }
    try {
      const profile = await loadProfile(identity);
      const events = retainedEvents(await loadEvents(identity), now);
      const signals = buildUserCourseSignals({
        courseHistory: profile?.courseHistory ?? [], events, now: now.toISOString(), activeTerm: ACTIVE_TERM,
      });
      results.push({ signals, simulated: info.simulated });
    } catch (error) {
      logger.warn(`共現表：略過一位貢獻者（${error.message}）`, { label: 'CF' });
    }
  }
  return { contributors: results, consentedTotal: contributors.size, skippedSimulated };
}

/** 建立新的共現表；persist 時整張換新。回傳彙總，不含任何個人資料。 */
export async function rebuildCourseNeighbors({
  persist = true, includeSimulated = false, now = new Date(), deps = {},
} = {}) {
  if (persist && includeSimulated) {
    throw new Error('Persona／demo 的資料只能用於 dry-run，不得寫入正式共現表');
  }
  const collected = await collectContributorSignals({ includeSimulated, now, deps });
  const { neighbors, stats } = buildCourseNeighbors(collected.contributors);
  const gate = evaluateCfActivationGate(collected.contributors, stats.keptPairs);
  const build = {
    buildId: crypto.randomUUID(),
    modelVersion: CF_MODEL_VERSION,
    computedAt: now.toISOString(),
    settings: { ...CF_DEFAULTS },
    stats: { ...stats, consentedTotal: collected.consentedTotal, skippedSimulated: collected.skippedSimulated },
    gate,
    neighbors,
  };
  if (persist) await (deps.saveBuild ?? saveBuild)(build);
  return build;
}

async function saveBuild(build) {
  if (!isMysqlConfigured()) {
    memoryBuild = build;
    readCache = null;
    return;
  }
  const rows = [];
  for (const [courseCode, list] of build.neighbors) {
    for (const item of list) rows.push([build.buildId, courseCode, item.courseCode, item.similarity, item.coCount]);
  }
  await withTransaction(async connection => {
    await connection.execute(
      `INSERT INTO Course_Neighbor_Builds
        (build_id, model_version, computed_at, contributor_count, real_contributor_count,
         eligible_real_contributor_count, neighbor_pair_count, gate_met, settings_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [build.buildId, build.modelVersion, toMysqlDate(build.computedAt), build.stats.usedContributors,
        build.gate.realContributors, build.gate.eligibleRealContributors, build.stats.keptPairs,
        build.gate.met ? 1 : 0, JSON.stringify(build.settings)]
    );
    for (let start = 0; start < rows.length; start += INSERT_BATCH_SIZE) {
      const batch = rows.slice(start, start + INSERT_BATCH_SIZE);
      await connection.execute(
        `INSERT INTO Course_Neighbors (build_id, course_code, neighbor_code, similarity, co_count)
         VALUES ${batch.map(() => '(?, ?, ?, ?, ?)').join(', ')}`,
        batch.flat()
      );
    }
    // 舊 build 的列由外鍵 ON DELETE CASCADE 一併刪除。
    await connection.execute('DELETE FROM Course_Neighbor_Builds WHERE build_id <> ?', [build.buildId]);
  });
  readCache = null;
}

/**
 * 最新的共現表（讀取快取 10 分鐘）。
 * @returns { available, reason?, buildId, computedAt, gateMet, neighbors }
 */
export async function loadLatestCourseNeighbors({ now = Date.now() } = {}) {
  if (readCache && readCache.expiresAt > now) return readCache.value;
  let value;
  if (!isMysqlConfigured()) {
    value = memoryBuild
      ? { available: true, buildId: memoryBuild.buildId, computedAt: memoryBuild.computedAt,
        gateMet: memoryBuild.gate.met, neighbors: memoryBuild.neighbors }
      : { available: false, reason: 'not_built', neighbors: new Map() };
  } else {
    try {
      const [build] = await queryRows(
        'SELECT build_id, computed_at, gate_met FROM Course_Neighbor_Builds ORDER BY computed_at DESC LIMIT 1'
      );
      if (!build) {
        value = { available: false, reason: 'not_built', neighbors: new Map() };
      } else {
        const rows = await queryRows(
          `SELECT course_code, neighbor_code, similarity, co_count FROM Course_Neighbors
            WHERE build_id = ? ORDER BY course_code, similarity DESC`,
          [build.build_id]
        );
        const neighbors = new Map();
        for (const row of rows) {
          const list = neighbors.get(row.course_code) ?? [];
          list.push({ courseCode: row.neighbor_code, similarity: Number(row.similarity), coCount: Number(row.co_count) });
          neighbors.set(row.course_code, list);
        }
        value = {
          available: true, buildId: build.build_id, computedAt: new Date(build.computed_at).toISOString(),
          gateMet: Boolean(build.gate_met), neighbors,
        };
      }
    } catch (error) {
      const missing = error?.code === 'ER_NO_SUCH_TABLE';
      if (!missing) logger.warn(`共現表讀取失敗：${error.message}`, { label: 'CF' });
      value = { available: false, reason: missing ? 'table_missing' : 'unavailable', neighbors: new Map() };
    }
  }
  readCache = { value, expiresAt: now + READ_CACHE_TTL_MS };
  return value;
}

let rebuildTimer = null;
let pendingRebuild = null;

async function rebuildIfStale() {
  const latest = await loadLatestCourseNeighbors({ now: 0 });
  if (latest.reason === 'table_missing') return; // 尚未執行 migration：不自動建表
  const age = latest.computedAt ? Date.now() - Date.parse(latest.computedAt) : Infinity;
  if (age < COURSE_NEIGHBOR_REBUILD_INTERVAL_MS) return;
  const build = await rebuildCourseNeighbors();
  logger.info(
    `共現表已重建：真人貢獻者 ${build.gate.realContributors}（達互動門檻 ${build.gate.eligibleRealContributors}）、`
      + `保留配對 ${build.stats.keptPairs}、啟用門檻${build.gate.met ? '已達到' : '未達到'}。`,
    { label: 'CF' }
  );
}

/** 有人撤回 collaborative_learning 時呼叫：數秒內重建，期間的多次撤回合併成一次。 */
export function requestCourseNeighborRebuild() {
  if (pendingRebuild) return pendingRebuild;
  pendingRebuild = new Promise(resolve => { setTimeout(resolve, 5000).unref?.(); })
    .then(() => rebuildCourseNeighbors())
    .then(build => logger.info(
      `共現表已因撤回同意提前重建：真人貢獻者 ${build.gate.realContributors}、保留配對 ${build.stats.keptPairs}。`,
      { label: 'CF' }
    ))
    .catch(error => logger.warn(`共現表重建失敗：${error.message}`, { label: 'CF' }))
    .finally(() => { pendingRebuild = null; });
  return pendingRebuild;
}

/** 伺服器啟動時呼叫：每小時檢查一次，超過 24 小時就重建。 */
export function startCourseNeighborSchedule() {
  if (rebuildTimer) return;
  const check = () => rebuildIfStale().catch(error => logger.warn(`共現表排程失敗：${error.message}`, { label: 'CF' }));
  check();
  rebuildTimer = setInterval(check, 60 * 60 * 1000);
  rebuildTimer.unref?.();
}

export function resetCourseNeighborStateForTests() {
  memoryBuild = null;
  readCache = null;
}

export default {
  collectContributorSignals,
  rebuildCourseNeighbors,
  loadLatestCourseNeighbors,
  requestCourseNeighborRebuild,
  startCourseNeighborSchedule,
};
