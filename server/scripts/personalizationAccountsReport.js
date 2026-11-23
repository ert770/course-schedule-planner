// 全部帳號的個人化表現報告（唯讀，2026-11-22 課程主題問答接管線第 4 段起使用）。
//
// 每個有偏好資料的帳號都用 `generateForUser()` 排一次課（與 `POST /api/schedule/generate` 同一個函式），
// 偏好用 `getUserPreferences()` 讀（併入修課紀錄與畢業缺口），並和 app.js 一樣載入 HiGHS。
// 不帶 surface／trigger，所以不寫曝光事件；不改任何帳號的偏好。正常排課會更新標籤興趣快取，這裡也會。
//
// 用法（在 server/ 底下）：
//   node scripts/personalizationAccountsReport.js --out=<path.json>              帳號現有偏好
//   node scripts/personalizationAccountsReport.js --simulate --out=<path.json>   加上模擬問答勾選
// 改動前後各跑一次，再比較兩份 JSON。
//
// --simulate：大部分帳號沒做過問答，只看真實資料看不出改動的效果。模擬方式比照 2026-11-20 Step G：
// 每組（本系、通識、系外）取問答第一個方向，勾該方向課程數最多的 3 個標籤；只加在記憶體裡的 prefs，
// 不保存，也不呼叫語言模型。帳號原本的問答勾選與舊關鍵字照舊保留。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(scriptDir, '..', '.env'), quiet: true });
dotenv.config({ path: path.join(scriptDir, '..', '..', '.env'), quiet: true });

const { getAll } = await import('../src/db/database.js');
const { resolveIdentityFrom } = await import('../src/services/identityService.js');
const { getUserPreferences } = await import('../src/services/memoryService.js');
const { generateForUser } = await import('../src/services/scheduleService.js');
const { getHighsRuntime } = await import('../src/skills/optimization/highsRuntime.js');
const { setSchedulingHighsRuntime } = await import('../src/skills/scheduler.js');
const { resolveInterestTags } = await import('../src/data/interestTagCatalog.js');
const { resolveInterestSelections } = await import('../src/data/interestSelections.js');
const { readInterestPreferences } = await import('../src/data/interestPreferences.js');

const { getInterestTopicGroups } = await import('../src/services/interestMenuService.js');
const { orderDirections, detailCandidatesFor } = await import('../src/services/interestQuestionnaireService.js');

const outArg = process.argv.find(arg => arg.startsWith('--out='));
const outPath = outArg ? outArg.slice('--out='.length) : null;
const simulate = process.argv.includes('--simulate');
const SIMULATED_TAGS_PER_GROUP = 3;

async function simulatedSelections(prefs) {
  const menu = await getInterestTopicGroups({
    department: prefs.department, gradeLevel: prefs.gradeLevel, className: prefs.className,
  });
  if (!menu.scopeReady) return [];
  return menu.topicGroups.flatMap(group => {
    const [first] = orderDirections(group.key, group.options ?? []);
    if (!first) return [];
    const tagIds = detailCandidatesFor(menu, group.key, first.id)
      .slice(0, SIMULATED_TAGS_PER_GROUP)
      .map(tag => tag.tagId ?? tag.id);
    return tagIds.length ? [{ group: group.key, categoryId: first.id, mode: 'followup', tagIds }] : [];
  });
}

try {
  setSchedulingHighsRuntime(await getHighsRuntime());
} catch (error) {
  console.warn(`HiGHS 載入失敗：${error.message}`);
}

const isRequired = course => course.category === '必修' || course.type === '必修';
const courseTagIds = course => new Set(resolveInterestTags(course.ragTag ?? []).tags.map(tag => tag.canonicalTagId));
const round = value => (Number.isFinite(value) ? Math.round(value * 1000) / 1000 : null);
const componentOf = (course, name) => course.recommendationReason?.scoreBreakdown
  ?.find(item => item.component === name)?.value ?? 0;

function hitRate(courses, selectedIds) {
  const electives = courses.filter(course => !isRequired(course));
  if (selectedIds.size === 0 || electives.length === 0) return { hits: 0, total: electives.length, rate: null };
  const hits = electives.filter(course => [...courseTagIds(course)].some(id => selectedIds.has(id))).length;
  return { hits, total: electives.length, rate: round(hits / electives.length) };
}

const users = await getAll('users');
const prefRows = await getAll('user_preferences');
const rows = [];
const skipped = [];

const onlyAccounts = process.argv.find(item => item.startsWith('--accounts='))?.slice('--accounts='.length).split(',');
// --targets=<json>：{ userId: [tagId…] }，例如舊關鍵字轉移清單（legacyInterestMigration.js --plan-out）。
// 改動前後用同一份目標標籤算命中率，才能比較。
const targetsArg = process.argv.find(item => item.startsWith('--targets='))?.slice('--targets='.length);
const targetsByUser = targetsArg ? JSON.parse(fs.readFileSync(targetsArg, 'utf8')) : null;
// --profile-identity：不在 users.json 的帳號（例如 1804… Persona）直接用 Profile 列的 MySQL user_id。
const profileIdentity = process.argv.includes('--profile-identity');
// --prefs-override=<backup.json>：[{ userId, preferencesJson }]，只在記憶體裡換回備份的偏好（不寫資料庫）。
// 用於轉移後重建「轉移前」的基準線（ADR-032）。
const overrideArg = process.argv.find(item => item.startsWith('--prefs-override='))?.slice('--prefs-override='.length);
const overrides = overrideArg
  ? new Map(JSON.parse(fs.readFileSync(overrideArg, 'utf8')).map(item => [String(item.userId), item.preferencesJson]))
  : new Map();
for (const row of prefRows) {
  if (onlyAccounts && !onlyAccounts.includes(String(row.userId))) continue;
  let identity = resolveIdentityFrom(users, row.userId);
  if ((!identity?.canonicalId || identity.reason) && profileIdentity && row.mysqlUserId != null) {
    identity = { found: true, canonicalId: String(row.userId), studentId: row.studentId ?? String(row.userId),
      numericId: String(row.mysqlUserId) };
  }
  if (!identity?.canonicalId || identity.reason) {
    skipped.push({ userId: row.userId, reason: identity?.reason ?? 'unresolved' });
    continue;
  }
  let prefs;
  try {
    prefs = await getUserPreferences(identity);
  } catch (error) {
    // 單一帳號讀不到（例如沒有修課紀錄對照）就略過，不中斷整批。
    skipped.push({ userId: row.userId, reason: error.code ?? error.message });
    continue;
  }
  if (overrides.has(String(row.userId))) {
    const preferencesJson = overrides.get(String(row.userId));
    const values = preferencesJson?.values ?? {};
    prefs = {
      ...prefs,
      preferencesJson,
      interestSelections: values.interestSelections ?? [],
      interests: values.interests ?? [],
      preferredKeywords: values.preferredKeywords ?? [],
    };
  }
  if (simulate) {
    const own = readInterestPreferences(prefs).interestSelections;
    const extra = (await simulatedSelections(prefs))
      .filter(item => !own.some(saved => saved.group === item.group && saved.categoryId === item.categoryId));
    prefs = { ...prefs, interestSelections: [...own, ...extra] };
  }
  const interest = readInterestPreferences(prefs);
  const selectedIds = new Set(resolveInterestSelections(interest.interestSelections).tags.map(({ tag }) => tag.id));
  const started = Date.now();
  let result;
  try {
    result = await generateForUser(identity, {}, { prefs });
  } catch (error) {
    rows.push({ account: identity.canonicalId, error: error.message });
    continue;
  }
  const plans = Array.isArray(result.plans) ? result.plans : [];
  const primary = plans.find(plan => plan.id === result.recommendedPlanId) ?? plans[0] ?? { schedule: [] };
  const allCourses = [...new Map(plans.flatMap(plan => plan.schedule ?? []).map(course => [course.id, course])).values()];
  const primaryElectives = (primary.schedule ?? []).filter(course => !isRequired(course));
  rows.push({
    account: identity.canonicalId,
    selectedTags: selectedIds.size,
    // 舊文字興趣欄位（ADR-032 後新版讀取不再回傳，記為 0）。
    legacyKeywords: (interest.interests?.length ?? 0) + (interest.preferredKeywords?.length ?? 0),
    success: result.success === true,
    ms: Date.now() - started,
    preferenceInterest: round(result.preferenceProfile?.interest ?? 0),
    hasExpressedPreference: result.hasExpressedPreference === true,
    planIds: plans.map(plan => String(plan.id).split(':').pop()),
    totalCredits: result.totalCredits ?? null,
    unmetRequirements: Array.isArray(result.unmetRequirements) ? result.unmetRequirements.length : null,
    primaryHit: hitRate(primary.schedule ?? [], selectedIds),
    ...(targetsByUser ? (() => {
      const targets = new Set(targetsByUser[String(row.userId)] ?? []);
      return { targetTags: targets.size, primaryTargetHit: hitRate(primary.schedule ?? [], targets),
        allPlansTargetHit: hitRate(allCourses, targets) };
    })() : {}),
    allPlansHit: hitRate(allCourses, selectedIds),
    primaryAvgTagInterest: round(primaryElectives.length
      ? primaryElectives.reduce((sum, course) => sum + componentOf(course, 'tagInterest'), 0) / primaryElectives.length
      : 0),
    primaryAvgInterestComponent: round(primaryElectives.length
      ? primaryElectives.reduce((sum, course) => sum + componentOf(course, 'interest'), 0) / primaryElectives.length
      : 0),
    ...(process.argv.includes('--detail') ? {
      primaryPlanId: String(primary.id ?? '').split(':').pop(),
      planStats: plans.map(plan => {
        const list = (plan.schedule ?? []).filter(course => !isRequired(course));
        return {
          planId: String(plan.id).split(':').pop(),
          avgTagInterest: round(list.length ? list.reduce((sum, course) => sum + componentOf(course, 'tagInterest'), 0) / list.length : 0),
          selectedHits: list.reduce((sum, course) => sum + [...courseTagIds(course)].filter(id => selectedIds.has(id)).length, 0),
          hitRate: hitRate(plan.schedule ?? [], selectedIds).rate,
        };
      }),
      primaryElectives: primaryElectives.map(course => ({
        name: course.name,
        tagInterest: round(componentOf(course, 'tagInterest')),
        interest: round(componentOf(course, 'interest')),
        selectedHits: [...courseTagIds(course)].filter(id => selectedIds.has(id)).length,
      })),
    } : {}),
    // 回歸比對用：每個方案的課（排序後的 section id）。
    planFingerprints: plans.map(plan => (plan.schedule ?? []).map(course => course.id).sort((a, b) => a - b).join(',')),
  });
  console.error(`${identity.canonicalId} done (${Date.now() - started} ms)`);
}

const report = { generatedAt: new Date().toISOString(), simulate, accounts: rows.length, skipped, rows };
const text = `${JSON.stringify(report, null, 2)}\n`;
if (outPath) fs.writeFileSync(outPath, text, 'utf8');
else process.stdout.write(text);
process.exit(0);
