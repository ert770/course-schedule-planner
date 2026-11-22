// 課程主題問答細項頁的「中層」：預先算好的標籤分群（設計稿 `docs/PLANS/2026-11-22-interest-questionnaire-funnel-design.md`）。
//
// 分群由 `scripts/buildInterestTagClusters.js` 離線呼叫語言模型產生，驗證完整後才寫進
// `interestTagClusters.json`。學生作答時**只查表、不呼叫模型**：
//   - 不用等 5～12 秒（spike 2 實測）；
//   - 同一版本每次看到的分群相同（模型重跑的一致度中位只有 0.90，靠保存結果解決）。
//
// 鍵是「方向 ID＋排序後的標籤 ID」，候選池一變（多一門課、少一個標籤），鍵就不同、查不到，
// 呼叫端退回完整清單。查到了還要再核對群員與目前的標籤完全相同，任何不符都當作沒有分群，
// **不把對不上的標籤塞進「其他」**：那會讓學生更難找到它。
//
// 分群只是導覽：群本身不保存、不計分，只有學生勾選的標籤 ID 會存進 interestSelections（ADR-027）。

import fs from 'node:fs';
import { sha256Hex } from '../utils/hash.js';

export const OTHER_CLUSTER_ID = 'other';
const fileUrl = new URL('./interestTagClusters.json', import.meta.url);

function loadFile() {
  try {
    return JSON.parse(fs.readFileSync(fileUrl, 'utf8'));
  } catch {
    // 檔案不存在或壞掉：等於全部沒有分群，問答照樣能用（完整清單）。
    return { entries: {} };
  }
}

let store = loadFile();

/** 測試用：換成指定內容；不帶參數則重新讀檔。 */
export function setInterestTagClustersForTests(value) {
  store = value ?? loadFile();
}

export function clusterKey(categoryId, tagIds) {
  return sha256Hex({ categoryId: String(categoryId), tagIds: [...new Set(tagIds)].sort() });
}

/**
 * 驗證一組分群是否完整（純函式，建檔腳本與執行時共用）。
 * @param clusters `[{ clusterId, label, tagIds }]`
 * @param tagIds 這個方向目前所有的標籤 ID
 * @returns `{ ok: true } | { ok: false, reason }`
 */
export function validateClusters(clusters, tagIds, { minClusters = 2, maxClusters = 4, minSize = 2, maxLabelLength = 12 } = {}) {
  if (!Array.isArray(clusters)) return { ok: false, reason: 'not_array' };
  const expected = new Set(tagIds);
  const seen = new Set();
  for (const cluster of clusters) {
    if (!cluster?.label || String(cluster.label).length > maxLabelLength) return { ok: false, reason: 'bad_label' };
    for (const tagId of cluster.tagIds ?? []) {
      if (!expected.has(tagId)) return { ok: false, reason: 'unknown_tag' };
      if (seen.has(tagId)) return { ok: false, reason: 'duplicate_tag' };
      seen.add(tagId);
    }
  }
  if (seen.size !== expected.size) return { ok: false, reason: 'missing_tag' };
  const real = clusters.filter(cluster => cluster.clusterId !== OTHER_CLUSTER_ID);
  if (real.length < minClusters || real.length > maxClusters) return { ok: false, reason: `cluster_count_${real.length}` };
  if (real.some(cluster => cluster.tagIds.length < minSize)) return { ok: false, reason: 'cluster_too_small' };
  return { ok: true };
}

/**
 * 查某個方向預先算好的分群。
 * @param tags 這個方向在候選池裡的標籤 `[{ tagId, name, courseCount, ... }]`（依課程數排序）
 * @returns `[{ clusterId, label, tags }]`（群內依 tags 原本的順序），或 null（沒有分群，呼叫端用完整清單）
 */
export function lookupTagClusters(categoryId, tags = []) {
  const tagIds = tags.map(tag => tag.tagId);
  const entry = store.entries?.[clusterKey(categoryId, tagIds)];
  if (!entry || !validateClusters(entry.clusters, tagIds).ok) return null;
  const order = new Map(tagIds.map((tagId, index) => [tagId, index]));
  const byId = new Map(tags.map(tag => [tag.tagId, tag]));
  return entry.clusters.map(cluster => ({
    clusterId: cluster.clusterId,
    label: cluster.label,
    tags: [...cluster.tagIds].sort((a, b) => order.get(a) - order.get(b)).map(tagId => byId.get(tagId)),
  }));
}

export function tagClustersVersion() {
  return { promptVersion: store.promptVersion ?? null, model: store.model ?? null, generatedAt: store.generatedAt ?? null };
}

export default { clusterKey, validateClusters, lookupTagClusters, tagClustersVersion, OTHER_CLUSTER_ID };
