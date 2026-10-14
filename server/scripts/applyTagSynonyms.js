// 把使用者審核通過的同義詞寫入 server/src/data/interestTagAliases.json（別名 → 標準標籤），
// 之後由 importInterestTagCatalog.py 重建目錄、recountInterestTagEligibility.js 重算資格。
// 流程見 docs/CHANGE_REPORTS/2026-10-14-tag-synonym-merge.md。
//
// 1. 讀 scripts/lib/readSynonymDecisions.py 產生的核准配對。
// 2. 以聯集合併成群組；群組內出現課數最多的當標準標籤（同數時取已是別名目標、名稱較短者），
//    與候選清單（tagSynonymCandidates.js）的規則相同。
// 3. 被併入的標籤，其名稱與所有原始寫法（目錄的 sourceRows.rawTag）都寫成別名，
//    否則匯入腳本會把寫法不同的原始標籤留成獨立標籤。
// 4. 既有別名的目標若被併入別的標籤，改指向新的標準標籤（避免別名鏈）。
// 5. 另輸出「舊標籤 ID → 新標準標籤名稱」對照，供降權名單與事件快照轉換。
//
// 對資料庫不讀也不寫。
// 用法：node scripts/applyTagSynonyms.js --decisions=simulation-runs/tag-synonym-candidates/approved.json

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const { interestTagCatalog, interestTagAliases } = await import('../src/data/interestTagCatalog.js');

const args = process.argv.slice(2);
const decisionsFile = args.find(arg => arg.startsWith('--decisions='))?.split('=')[1];
if (!decisionsFile) { console.error('請指定 --decisions=<檔案>'); process.exit(1); }
const aliasesFile = path.resolve(scriptDir, '..', 'src', 'data', 'interestTagAliases.json');
const mappingFile = path.resolve(scriptDir, '..', 'simulation-runs', 'tag-synonym-candidates', 'merge-mapping.json');

const decisions = JSON.parse(fs.readFileSync(path.resolve(decisionsFile), 'utf8'));
const byId = new Map(interestTagCatalog.canonicalTags.map(tag => [tag.id, tag]));
const courseCount = id => byId.get(id)?.eligibility?.courseCount ?? 0;
const aliasTargets = new Set(Object.values(interestTagAliases.aliases ?? {}));

for (const pair of decisions.approved) {
  for (const [id, name] of [[pair.aliasId, pair.alias], [pair.canonicalId, pair.canonical]]) {
    if (byId.get(id)?.name !== name) throw new Error(`審核表的標籤與目錄不符：${id} ${name}`);
  }
}

// 聯集合併。
const parent = new Map();
const find = id => {
  if (!parent.has(id)) parent.set(id, id);
  const root = parent.get(id);
  if (root === id) return id;
  const top = find(root);
  parent.set(id, top);
  return top;
};
for (const pair of decisions.approved) parent.set(find(pair.aliasId), find(pair.canonicalId));
const groups = new Map();
for (const id of parent.keys()) {
  const root = find(id);
  if (!groups.has(root)) groups.set(root, []);
  groups.get(root).push(id);
}

const mergedGroups = [...groups.values()].map(ids => {
  const sorted = [...ids].sort((a, b) => (
    courseCount(b) - courseCount(a)
    || Number(aliasTargets.has(byId.get(b).name)) - Number(aliasTargets.has(byId.get(a).name))
    || byId.get(a).name.length - byId.get(b).name.length
    || byId.get(a).name.localeCompare(byId.get(b).name, 'zh-Hant')
  ));
  return { canonical: sorted[0], members: sorted.slice(1) };
}).sort((a, b) => courseCount(b.canonical) - courseCount(a.canonical));

// 別名：被併入標籤的名稱與所有原始寫法 → 標準標籤名稱。
const aliases = { ...(interestTagAliases.aliases ?? {}) };
const mergedInto = new Map();
for (const group of mergedGroups) {
  const canonicalName = byId.get(group.canonical).name;
  for (const id of group.members) {
    const tag = byId.get(id);
    mergedInto.set(tag.name, canonicalName);
    const rawForms = new Set([tag.name, ...tag.categoryAssignments.flatMap(item => item.sourceRows.map(row => row.rawTag))]);
    for (const raw of rawForms) aliases[raw] = canonicalName;
  }
}
// 既有別名的目標被併入別的標籤時改指向新的標準標籤。
let retargeted = 0;
for (const [alias, target] of Object.entries(aliases)) {
  if (mergedInto.has(target)) { aliases[alias] = mergedInto.get(target); retargeted += 1; }
}
const sortedAliases = Object.fromEntries(Object.entries(aliases).sort(([a], [b]) => a.localeCompare(b, 'zh-Hant')));

const output = {
  schemaVersion: 1,
  aliases: sortedAliases,
  reviewedSynonymMerge: {
    reviewedOn: '2026-10-14',
    source: 'docs/CHANGE_REPORTS/2026-10-14-tag-synonym-candidates.xlsx（使用者審核）',
    approvedPairs: decisions.approved.length,
    groups: mergedGroups.length,
    mergedTags: mergedGroups.reduce((sum, group) => sum + group.members.length, 0),
  },
};
fs.writeFileSync(aliasesFile, `${JSON.stringify(output, null, 2)}\n`);
fs.writeFileSync(mappingFile, JSON.stringify({
  groups: mergedGroups.map(group => ({
    canonical: { id: group.canonical, name: byId.get(group.canonical).name, courses: courseCount(group.canonical) },
    members: group.members.map(id => ({ id, name: byId.get(id).name, courses: courseCount(id) })),
  })),
  mergedIdToCanonicalName: Object.fromEntries(mergedGroups.flatMap(group => group.members.map(id => [id, byId.get(group.canonical).name]))),
}, null, 1));
console.log(JSON.stringify({
  approvedPairs: decisions.approved.length,
  groups: mergedGroups.length,
  mergedTags: output.reviewedSynonymMerge.mergedTags,
  aliasEntries: Object.keys(sortedAliases).length,
  previousAliasEntries: Object.keys(interestTagAliases.aliases ?? {}).length,
  retargetedExistingAliases: retargeted,
  largestGroup: Math.max(...mergedGroups.map(group => group.members.length + 1)),
}, null, 2));
