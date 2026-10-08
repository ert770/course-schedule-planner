import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(scriptDir, '..', '.env'), quiet: true });
dotenv.config({ path: path.resolve(scriptDir, '..', '..', '.env'), quiet: true });

const { isMysqlConfigured, closePool } = await import('../src/db/mysql.js');
const { getAll } = await import('../src/db/database.js');
const { buildInterestTagEligibility } = await import('../src/data/interestTagEligibility.js');

function printSummary(result) {
  const { summary, tags, unknownTags } = result;
  const frequent = tags.slice(0, 20).map(tag => (
    `- ${tag.canonicalName}: ${tag.courseCount}/${summary.courseCount} 門課 `
      + `(${(tag.courseRatio * 100).toFixed(2)}%)，學習=${tag.interestLearningEligible}，`
      + `跨課配對=${tag.crossCourseMatchEligible}`
  ));
  const unknownSample = unknownTags.slice(0, 20).map(item => (
    `- ${item.rawTag}（課號 ${item.courseKey}，${item.status}）`
  ));

  process.stdout.write([
    '# rag_tag 合併後資格唯讀報告',
    '',
    `- 目錄版本：${summary.catalogVersion}`,
    `- 課程班次：${summary.sectionCount}`,
    `- 穩定課號合併後課程數：${summary.courseCount}`,
    `- 無穩定課號而略過的班次：${summary.skippedSectionCount}`,
    `- Canonical 標籤數：${summary.canonicalTagCount}`,
    `- 可更新興趣：${summary.interestLearningEligibleCount}`,
    `- 可跨課匹配：${summary.crossCourseMatchEligibleCount}`,
    `- 原因數量：通用 ${summary.ineligibleReasonCounts.explicit_generic}、`
      + `高頻 ${summary.ineligibleReasonCounts.too_common}、單課 ${summary.ineligibleReasonCounts.single_course}`,
    `- 無法映射的課程標籤：${summary.unknownCourseTagCount}`,
    `- 門檻：至少 ${summary.thresholds.minCourseCount} 門課；高頻排除比例 > `
      + `${(summary.thresholds.maxCourseRatio * 100).toFixed(2)}%`,
    '',
    '## 出現課數最多的前 20 個 canonical 標籤',
    ...(frequent.length ? frequent : ['- 無標籤資料']),
    '',
    '## 無法映射標籤樣本（最多 20 筆）',
    ...(unknownSample.length ? unknownSample : ['- 無']),
    '',
    '此工具只輸出計算結果，不更新目錄或資料庫。未列在此摘要的標籤可用 --json 輸出完整結果。',
    '',
  ].join('\n'));
}

let exitCode = 0;
try {
  if (!isMysqlConfigured()) {
    throw Object.assign(new Error('MySQL is not configured'), { code: 'MYSQL_NOT_CONFIGURED' });
  }
  const courses = await getAll('courses');
  const result = buildInterestTagEligibility(courses);
  if (process.argv.includes('--json')) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } else {
    printSummary(result);
  }
} catch (error) {
  const code = error?.code ? `（${error.code}）` : '';
  process.stderr.write(
    `無法讀取 MySQL 課程資料${code}。資格未寫入，目錄仍維持待重算狀態。\n`,
  );
  exitCode = 2;
} finally {
  await closePool();
}

process.exitCode = exitCode;
