// 一次性轉移：把舊的文字興趣欄位（preferences_json.values.interests／preferredKeywords）
// 轉成課程主題問答的勾選（interestSelections），再刪除舊值（ADR-032，2026-11-23 使用者決定先轉移再刪除）。
//
// 預設 dry-run：只讀，列出每個帳號的轉移清單與捨棄的詞。帶 --apply 才寫入，寫入前先把原始 preferencesJson
// 整份備份到 server/backups/（.gitignore 已排除），寫完逐一讀回核對。
//
// 對應規則（與學生在問答細項頁勾選時同一份候選池）：
//   1. 詞 → resolveInterestTags()（不事先篩可選性，由候選方向決定）。
//   2. 依本系 → 通識 → 系外、各組方向的既定順序，找第一個候選標籤含該標籤的方向，作為 (group, categoryId)。
//   3. 與已存的 interestSelections 合併（同一方向併入 tagIds，不覆蓋原有勾選）。
//   4. 經 sanitizeInterestSelectionsForSave() 驗證，與學生自己存檔同一套規則。
// 對應不到的詞列為捨棄。
//
// 用法（在 server/ 底下）：
//   node scripts/legacyInterestMigration.js            dry-run
//   node scripts/legacyInterestMigration.js --apply    寫入（會刪除舊值，只能用備份還原）

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { resolveInterestTags } from '../src/data/interestTagCatalog.js';
import { INTEREST_SELECTION_GROUPS, normalizeInterestSelections } from '../src/data/interestPreferences.js';

// 2026-11-23 使用者要求：對不上的詞由系統代為判斷補勾（每筆標註方式，報告逐筆列出）。
//   prefix：目錄裡找不到這個詞時，取名稱以它開頭的標籤（與舊興趣軸比對課程的規則相同）。
//   similar：標籤存在但不在候選池時，用相近標籤表（tagVectorNeighbors，s_vec 用的那份）
//            取候選池裡相似度 ≥ SIMILAR_MIN 的最相近標籤，最多 SIMILAR_MAX_PER_TERM 個。
// 0.70：使用者 2026-11-23 決定（0.75 只救回 4 筆，0.70 多救回 AI 應用→AI工具等 3 筆）。
export const SIMILAR_MIN = Number(process.argv.find(arg => arg.startsWith('--similar-min='))?.split('=')[1]) || 0.7;
export const SIMILAR_MAX_PER_TERM = 2;
export const PREFIX_MAX_PER_TERM = 3;

export const LEGACY_DROP_REASON = Object.freeze({
  NO_TAG: 'no_matching_tag',
  NOT_IN_POOL: 'not_in_candidate_pool',
});

/** 從原始 preferencesJson（或 profile 頂層）讀出舊關鍵字，去重。 */
export function readLegacyTerms(row = {}) {
  const values = row?.preferencesJson?.values ?? {};
  const list = value => (Array.isArray(value) ? value : [])
    .map(item => String(item ?? '').trim()).filter(Boolean);
  return [...new Set([
    ...list(row.interests ?? values.interests),
    ...list(row.preferredKeywords ?? values.preferredKeywords),
  ])];
}

/**
 * 純函式：把舊關鍵字對應成問答勾選。
 * @param input.terms              舊關鍵字
 * @param input.existingSelections 已存的 interestSelections
 * @param input.directions         依 group 排好的方向：`[{ group, categoryId, tagIds:Set }]`（本系→通識→系外）
 * @param input.resolveTags        測試用注入，預設 resolveInterestTags
 * @returns `{ selections, mapped, dropped }`
 */
export function planLegacyInterestMigration({
  terms = [], existingSelections = [], directions = [], resolveTags = resolveInterestTags,
  catalogTags = [], similarity = new Map(),
} = {}) {
  const selections = normalizeInterestSelections(existingSelections).map(item => ({ ...item, tagIds: [...item.tagIds] }));
  const keyOf = item => `${item.group}\u0000${item.categoryId}`;
  const byKey = new Map(selections.map(item => [keyOf(item), item]));
  const mapped = [];
  const dropped = [];

  const nameOf = new Map(catalogTags.map(tag => [tag.id, tag.name]));
  const directionOf = tagId => directions.find(item => item.tagIds.has(tagId));
  const place = (term, tagId, tagName, method, extra = {}) => {
    const direction = directionOf(tagId);
    if (!direction) return false;
    const key = keyOf(direction);
    if (!byKey.has(key)) {
      const created = { group: direction.group, categoryId: direction.categoryId, mode: 'followup', tagIds: [] };
      byKey.set(key, created);
      selections.push(created);
    }
    const target = byKey.get(key);
    if (!target.tagIds.includes(tagId)) target.tagIds.push(tagId);
    mapped.push({ term, tagId, tagName, method, group: direction.group, categoryId: direction.categoryId, ...extra });
    return true;
  };
  const normalize = value => String(value ?? '').trim().toLowerCase();

  for (const term of terms) {
    // 不事先用「可選標籤」篩：候選方向本身已套用與問答相同的規則（一般方向只收可選標籤，
    // 「人工智慧」策畫選項另收人工智慧、機器學習等 too_common 標籤，ADR-026）。
    const tags = resolveTags([term]).tags
      .map(tag => ({ id: tag.canonicalTagId ?? tag.id, name: tag.canonicalName ?? tag.name }));
    let placedAny = false;

    if (tags.length === 0) {
      // prefix：與舊興趣軸 matchesInterestKeyword 的「標籤以關鍵字開頭」同一規則。
      const needle = normalize(term);
      const prefixed = needle ? catalogTags.filter(tag => normalize(tag.name).startsWith(needle) && directionOf(tag.id)) : [];
      for (const tag of prefixed.slice(0, PREFIX_MAX_PER_TERM)) {
        placedAny = place(term, tag.id, tag.name, 'prefix') || placedAny;
      }
      if (!placedAny) dropped.push({ term, reason: LEGACY_DROP_REASON.NO_TAG });
      continue;
    }

    for (const tag of tags) placedAny = place(term, tag.id, tag.name, 'exact') || placedAny;
    if (!placedAny) {
      // similar：候選池裡最相近的標籤。
      const neighbors = new Map();
      for (const tag of tags) {
        for (const [id, value] of similarity.get(tag.id) ?? []) {
          if (value >= SIMILAR_MIN && directionOf(id) && !(neighbors.get(id) >= value)) neighbors.set(id, value);
        }
      }
      const best = [...neighbors].sort((a, b) => b[1] - a[1]).slice(0, SIMILAR_MAX_PER_TERM);
      for (const [id, value] of best) {
        placedAny = place(term, id, nameOf.get(id) ?? id, 'similar', { similarity: Math.round(value * 1000) / 1000 }) || placedAny;
      }
    }
    if (!placedAny) dropped.push({ term, reason: LEGACY_DROP_REASON.NOT_IN_POOL });
  }
  return { selections: normalizeInterestSelections(selections), mapped, dropped };
}

/** 學生選單 → 依 group 與方向既定順序排好的候選方向。 */
export function directionsFromMenu(menu, { orderDirections, detailCandidatesFor }) {
  if (!menu?.scopeReady) return [];
  return INTEREST_SELECTION_GROUPS.flatMap(group => {
    const options = menu.topicGroups.find(item => item.key === group)?.options ?? [];
    return orderDirections(group, options).map(option => ({
      group,
      categoryId: option.id,
      tagIds: new Set(detailCandidatesFor(menu, group, option.id).map(tag => tag.tagId)),
    }));
  });
}

async function main() {
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const { default: dotenv } = await import('dotenv');
  dotenv.config({ path: path.join(scriptDir, '..', '.env'), quiet: true });
  dotenv.config({ path: path.join(scriptDir, '..', '..', '.env'), quiet: true });

  const apply = process.argv.includes('--apply');
  const { getAll } = await import('../src/db/database.js');
  const { getUserPreferences, updateUserPreferences } = await import('../src/services/memoryService.js');
  const { getInterestTopicGroups } = await import('../src/services/interestMenuService.js');
  const { orderDirections, detailCandidatesFor } = await import('../src/services/interestQuestionnaireService.js');
  const { sanitizeInterestSelectionsForSave } = await import('../src/services/interestSelectionService.js');
  const { interestTagCatalog } = await import('../src/data/interestTagCatalog.js');
  const { getTagSimilarity } = await import('../src/services/userTagVectorService.js');
  const catalogTags = interestTagCatalog.canonicalTags.map(tag => ({ id: tag.id, name: tag.name }));
  const similarity = getTagSimilarity();

  const rows = (await getAll('user_preferences')).filter(row => readLegacyTerms(row).length > 0);
  // 身分直接由 Profile 列組成：部分帳號（例如 1804… 的 Persona）不在 users.json，
  // 但 Profile 列有 MySQL 的 user_id，讀修課紀錄與寫入都靠它。
  const identityOf = row => ({
    found: true,
    canonicalId: String(row.userId),
    studentId: row.studentId ?? String(row.userId),
    numericId: row.mysqlUserId !== undefined && row.mysqlUserId !== null ? String(row.mysqlUserId) : null,
  });
  const plans = [];
  for (const row of rows) {
    const identity = identityOf(row);
    const prefs = await getUserPreferences(identity);
    const filters = { department: prefs.department, gradeLevel: prefs.gradeLevel, className: prefs.className };
    const menu = await getInterestTopicGroups(filters);
    const directions = directionsFromMenu(menu, { orderDirections, detailCandidatesFor });
    const terms = readLegacyTerms(row);
    const planned = planLegacyInterestMigration({
      terms, existingSelections: prefs.interestSelections, directions, catalogTags, similarity,
    });
    const sanitized = await sanitizeInterestSelectionsForSave({
      selections: planned.selections, previousSelections: prefs.interestSelections, filters,
    });
    plans.push({
      identity,
      userId: String(row.userId), className: prefs.className ?? null, scopeReady: Boolean(menu?.scopeReady),
      terms, mapped: planned.mapped, dropped: planned.dropped,
      before: (prefs.interestSelections ?? []).reduce((sum, item) => sum + item.tagIds.length, 0),
      after: sanitized.selections.reduce((sum, item) => sum + item.tagIds.length, 0),
      status: sanitized.status, warnings: sanitized.warnings, selections: sanitized.selections,
      originalPreferencesJson: row.preferencesJson ?? null,
    });
  }

  for (const plan of plans) {
    const label = item => (item.method === 'exact' ? '' : item.method === 'prefix' ? '〔開頭〕' : `〔相近 ${item.similarity}〕`);
    const mappedText = plan.mapped.map(item => `${item.term}→${item.tagName}${label(item)}`).join('、') || '（無）';
    const droppedText = plan.dropped.map(item => `${item.term}（${item.reason}）`).join('、') || '（無）';
    console.log(`${plan.userId} ${plan.className ?? ''} 勾選標籤 ${plan.before}→${plan.after}（${plan.status}${plan.warnings.length ? `，警告 ${plan.warnings.length}` : ''}）`);
    console.log(`  對應：${mappedText}`);
    console.log(`  捨棄：${droppedText}`);
  }
  console.log(`\n帳號 ${plans.length}；詞 ${plans.reduce((s, p) => s + p.terms.length, 0)}；`
    + `捨棄 ${plans.reduce((s, p) => s + p.dropped.length, 0)}；模式 ${apply ? 'APPLY' : 'dry-run'}`);

  // --plan-out=<json>：每個帳號舊關鍵字對應到的標籤（給 personalizationAccountsReport.js --targets 用）。
  const planOut = process.argv.find(arg => arg.startsWith('--plan-out='))?.slice('--plan-out='.length);
  if (planOut) {
    fs.writeFileSync(planOut, `${JSON.stringify(Object.fromEntries(plans.map(plan => [
      plan.userId, [...new Set(plan.mapped.map(item => item.tagId))],
    ])), null, 2)}
`, 'utf8');
    console.log(`轉移清單：${planOut}`);
  }

  if (!apply) process.exit(0);

  const backupDir = path.join(scriptDir, '..', 'backups');
  fs.mkdirSync(backupDir, { recursive: true });
  const backupPath = path.join(backupDir, 'legacy-interests-2026-11-23.json');
  if (fs.existsSync(backupPath)) throw new Error(`備份檔已存在，拒絕覆蓋：${backupPath}`);
  fs.writeFileSync(backupPath, `${JSON.stringify(plans.map(plan => ({
    userId: plan.userId, preferencesJson: plan.originalPreferencesJson,
  })), null, 2)}\n`, 'utf8');
  console.log(`備份：${backupPath}`);

  let ok = 0;
  for (const plan of plans) {
    const { identity } = plan;
    // interests／preferredKeywords 給空陣列：舊版 mergeInterestPreferences 會寫成 []，
    // 新版讀取已不回傳這兩個鍵，下一次任何寫入時會整個刪掉（見 interestPreferences.js）。
    await updateUserPreferences(identity, {
      interestSelections: plan.selections, interests: [], preferredKeywords: [],
    });
    const back = await getUserPreferences(identity);
    const values = back.preferencesJson?.values ?? {};
    const tags = (back.interestSelections ?? []).reduce((sum, item) => sum + item.tagIds.length, 0);
    const legacyLeft = (values.interests?.length ?? 0) + (values.preferredKeywords?.length ?? 0);
    const good = tags === plan.after && legacyLeft === 0;
    if (good) ok += 1;
    console.log(`${plan.userId} 寫入${good ? '成功' : '核對失敗'}：勾選 ${tags}（預期 ${plan.after}），舊關鍵字殘留 ${legacyLeft}`);
  }
  console.log(`核對通過 ${ok}/${plans.length}`);
  process.exit(ok === plans.length ? 0 : 1);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error(error);
    process.exit(1);
  });
}
