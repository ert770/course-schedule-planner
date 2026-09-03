// 版本化的畢業規則解析（Roadmap #23）。
//
// **為什麼需要這一層**：`graduationRequirements.js` 原本是單一 Map，只以系所全名為鍵。
// 同一位學生無法在不同規則版本下比較差異，也無法表達「這份學分認列是依哪一版算的」。
// 本模組補上 `program + degree + admissionYear + ruleVersion` 這組鍵，並回報每次解析
// 實際套用了哪一版、是不是退回了預設版本。
//
// **寫法沿用 `generalEducationCatalog.js` 的 `GENERAL_EDUCATION_RULES`**
// （`version`／`academicYearFrom`／`academicYearTo`／`sourceUrl` + 解析函式），
// 不另發明一套版本化寫法——通識那邊已經證明這個形狀夠用。
//
// **目前只有一版真實資料。** 逢甲只公布了 114 學年度必選修科目表，112／113 的 PDF
// 尚未取得。因此「同一位學生在不同版本下比較差異」在**系所學分維度是空的**——
// 架構支援多版本，資料只有一版。這件事由 `appliedFallbackVersion` 誠實表達出來，
// 不是靜默當成該學生入學年度的規則。
//
// 通識維度是另一回事：`generalEducationCatalog.js` 有 `through-111`／`112-114`／
// `from-115` 三個**真實**版本，那一維確實做得到版本比較。

import {
  GRADUATION_REQUIREMENTS_114,
  GRADUATION_REQUIREMENTS_114_SOURCE_URL,
} from './graduationRequirements.js';

// 目前對照表收錄的全部是學士班課程。碩博班沒有資料，不猜。
export const DEGREE_BACHELOR = 'bachelor';
export const SUPPORTED_DEGREES = Object.freeze([DEGREE_BACHELOR]);

export const GRADUATION_RULE_VERSIONS = Object.freeze([
  Object.freeze({
    version: '114',
    degree: DEGREE_BACHELOR,
    // `academicYearTo: null` 代表「目前最新一版，適用 114 以後尚未另行公布者」。
    academicYearFrom: 114,
    academicYearTo: null,
    sourceUrl: GRADUATION_REQUIREMENTS_114_SOURCE_URL,
    requirements: GRADUATION_REQUIREMENTS_114,
  }),
]);

// 沒有版本涵蓋某個入學年度時要退回哪一版。取 `academicYearFrom` 最大者，
// 而不是寫死 `[0]`——日後補進 112／113 版時這裡不需要跟著改。
const LATEST_VERSION = GRADUATION_RULE_VERSIONS
  .reduce((latest, entry) => (entry.academicYearFrom > latest.academicYearFrom ? entry : latest));

export const LATEST_GRADUATION_RULE_VERSION = LATEST_VERSION.version;

// 入學年度採民國學年度（112、113、114…）。不合法值一律回 null，不強行轉換——
// 「不知道入學年度」與「入學年度是 0」是不同的狀態。
export function normalizeAdmissionYear(value) {
  if (value === null || value === undefined || value === '') return null;

  const year = Number(value);
  if (!Number.isInteger(year) || year < 90 || year > 200) return null;
  return year;
}

function versionCovers(entry, admissionYear) {
  if (admissionYear === null) return false;
  if (entry.academicYearFrom !== null && admissionYear < entry.academicYearFrom) return false;
  if (entry.academicYearTo !== null && admissionYear > entry.academicYearTo) return false;
  return true;
}

function coverageOf(entry) {
  return { from: entry.academicYearFrom, to: entry.academicYearTo };
}

// 找出某個入學年度適用的版本。找不到時回傳最新一版並說明理由，
// **不回傳 null**——畢業進度不能因為缺少歷史版本就整個算不出來，
// 但也不能假裝套用的就是該學年度的規則。
export function resolveGraduationRuleVersion(admissionYear, degree = DEGREE_BACHELOR) {
  const year = normalizeAdmissionYear(admissionYear);
  const candidates = GRADUATION_RULE_VERSIONS.filter(entry => entry.degree === degree);

  if (candidates.length === 0) {
    return {
      entry: LATEST_VERSION,
      appliedFallbackVersion: true,
      fallbackReason: `目前沒有 ${degree} 學制的畢業規則資料，已套用 `
        + `${LATEST_VERSION.version} 學年度學士班規則；此結果僅供參考。`,
    };
  }

  const matched = candidates.find(entry => versionCovers(entry, year));
  if (matched) {
    return { entry: matched, appliedFallbackVersion: false, fallbackReason: null };
  }

  const fallback = candidates
    .reduce((latest, entry) => (entry.academicYearFrom > latest.academicYearFrom ? entry : latest));

  const fallbackReason = year === null
    ? `入學年度未知，已套用 ${fallback.version} 學年度規則；此結果僅供參考。`
    : `目前只有 ${fallback.version} 學年度必選修科目表，`
      + `${year} 學年度入學適用的版本尚未取得，已套用 ${fallback.version} 學年度規則；`
      + '此結果僅供參考。';

  return { entry: fallback, appliedFallbackVersion: true, fallbackReason };
}

// 解析一位學生適用的畢業規則。
//
// `program` 是系所全名（對照表的鍵），`degree` 目前只有 `bachelor` 有資料，
// `admissionYear` 為 null 代表未知——三者都不猜，缺了就在回傳裡說明。
export function resolveGraduationRule({ program, degree = DEGREE_BACHELOR, admissionYear } = {}) {
  const { entry, appliedFallbackVersion, fallbackReason } =
    resolveGraduationRuleVersion(admissionYear, degree);

  const requirement = entry.requirements.get(String(program || '').trim()) || null;

  return {
    requirement,
    program: String(program || '').trim() || null,
    degree,
    admissionYear: normalizeAdmissionYear(admissionYear),
    ruleVersion: entry.version,
    ruleSource: entry.sourceUrl,
    coverage: coverageOf(entry),
    // 對照表本身標記「抽取結果可疑、尚待人工複核」的系所，旗標往下傳，
    // 讓每一筆認列都帶得到，而不是只在畫面上出現一句警告。
    needsVerification: requirement?.needsVerification === true,
    appliedFallbackVersion,
    fallbackReason,
  };
}

// 可用版本清單，供文件與測試核對「目前到底有幾版真實資料」。
export function listGraduationRuleVersions() {
  return GRADUATION_RULE_VERSIONS.map(entry => ({
    version: entry.version,
    degree: entry.degree,
    coverage: coverageOf(entry),
    sourceUrl: entry.sourceUrl,
    programCount: entry.requirements.size,
  }));
}

export default {
  DEGREE_BACHELOR,
  SUPPORTED_DEGREES,
  GRADUATION_RULE_VERSIONS,
  LATEST_GRADUATION_RULE_VERSION,
  normalizeAdmissionYear,
  resolveGraduationRuleVersion,
  resolveGraduationRule,
  listGraduationRuleVersions,
};
