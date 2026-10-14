// 重建 interestTagCatalog.json（importInterestTagCatalog.py）之後，依當學期課程重算每個標準標籤的資格，
// 寫回目錄。規則就是 buildInterestTagEligibility()：至少 2 門課才可跨課比對、出現比例超過 2% 為高頻、
// GENERIC_INTEREST_TAGS 為通用詞。2026-10-14 以舊目錄驗證過：同一規則重算的結果與舊目錄存的資格完全一致。
//
// 對資料庫只讀（課程）。不加 --write 時只印摘要、不改檔案。
// 用法：node scripts/recountInterestTagEligibility.js [--write] [--version=rag-tag-eligibility-2026-10-14-v1]

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(scriptDir, '..', '.env'), quiet: true });
dotenv.config({ path: path.resolve(scriptDir, '..', '..', '.env'), quiet: true });

const { getAll } = await import('../src/db/database.js');
const { closePool, isMysqlConfigured } = await import('../src/db/mysql.js');
const { buildInterestTagEligibility } = await import('../src/data/interestTagEligibility.js');

const args = process.argv.slice(2);
const WRITE = args.includes('--write');
const VERSION = args.find(arg => arg.startsWith('--version='))?.split('=')[1] ?? 'rag-tag-eligibility-2026-10-14-v1';
const REVIEWED_ON = VERSION.match(/\d{4}-\d{2}-\d{2}/)?.[0] ?? new Date().toISOString().slice(0, 10);
const catalogFile = path.resolve(scriptDir, '..', 'src', 'data', 'interestTagCatalog.json');

// 「資格是依哪一份課程資料算的」：buildInterestTagEligibility() 回傳的 courses（課號、名稱、班次數、
// 標準標籤 ID）JSON 的 SHA-256。2026-10-09 舊快照的雜湊算法沒有留下紀錄，無法與這個值比較。
function membershipHash(result) {
  return crypto.createHash('sha256').update(JSON.stringify(result.courses)).digest('hex');
}

try {
  if (!isMysqlConfigured()) throw new Error('未設定 MySQL（DB_*），無法重算。');
  const catalog = JSON.parse(fs.readFileSync(catalogFile, 'utf8'));
  const result = buildInterestTagEligibility(await getAll('courses'));
  const byId = new Map(result.tags.map(tag => [tag.canonicalTagId, tag]));
  const missing = catalog.canonicalTags.filter(tag => !byId.has(tag.id));
  if (missing.length) throw new Error(`有 ${missing.length} 個目錄標籤沒有重算結果，例：${missing[0].name}`);

  const summary = { ...result.summary, catalogVersion: catalog.catalogVersion };
  console.log(JSON.stringify(summary, null, 2));
  if (!WRITE) {
    console.log('未加 --write，目錄未修改。');
  } else {
    for (const tag of catalog.canonicalTags) {
      const item = byId.get(tag.id);
      tag.eligibility = {
        status: 'reviewed_post_alias_course_recount',
        interestLearningEligible: item.interestLearningEligible,
        crossCourseMatchEligible: item.crossCourseMatchEligible,
        exclusionReason: item.exclusionReason ?? null,
        courseCount: item.courseCount,
        courseRatio: item.courseRatio,
        version: VERSION,
      };
    }
    catalog.eligibilityRecount = {
      version: VERSION,
      source: 'mysql-course-api',
      computedAt: new Date().toISOString(),
      reviewedOn: REVIEWED_ON,
      courseMembershipSha256: membershipHash(result),
      summary,
    };
    catalog.generatedFrom = {
      ...catalog.generatedFrom,
      eligibilityStatus: 'reviewed_post_alias_course_recount',
      frequencySnapshotUsableForEligibility: true,
    };
    fs.writeFileSync(catalogFile, `${JSON.stringify(catalog, null, 2)}\n`);
    console.log(`已寫回 ${catalogFile}`);
  }
} finally {
  await closePool();
}
