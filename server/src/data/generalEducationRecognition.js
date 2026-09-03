// 通識的畢業認列（Roadmap #23）。
//
// **與 `generalEducationCatalog.js` 的分工**：那一支只回答「某學期開設的課是不是通識、
// 當時屬於哪個領域」——那是**課程當期分類**，依課程開設學年度。本模組回答的是
// 「這位學生修過的通識課，最後算進哪一格、還缺多少」——那是**畢業認列**，
// 依**學生入學年度**。兩者用的年度不同，混在一起就會把 115 入學生的規則倒套到
// 112 入學生身上。
//
// 官方來源：`GENERAL_EDUCATION_SOURCE_URLS`（見 `generalEducationCatalog.js`），
// 其中 112 與 115 兩份改革公告是本模組所有規則的出處。

import {
  GENERAL_EDUCATION_SOURCE_URLS,
} from './generalEducationCatalog.js';

// 兩門核心必修的固定課號。
//
// **用課號不用課名**：課名可能有全形／半形或空白差異，課號是穩定鍵——這與
// roadmap #19 把已修排除從 section id 改成 `catalogCourseCode` 是同一個理由。
export const CORE_REQUIRED_COURSE_CODES = Object.freeze({
  GEG2000: '現代公民與社會實踐',
  GEK2000: '科學與人文的對話',
});

// 通識基礎必修裡「非核心必修」的部分，只能靠課名前綴辨識。
//
// **為什麼這裡不得不用課名**：英文有初級／中級／高級，課號各不相同
// （實測同一位學生就出現 `ENGL1008`、`ENGL1027`、`ENGL1048`、`ENGL1056` 四個），
// 把所有級別的課號列舉出來既不完整也會隨學年度變動。課名前綴則是穩定的。
const BASIC_REQUIRED_NAME_PREFIXES = Object.freeze([
  '中文思辨與表達',
  '大學基礎英文',
  '大學精進英文',
]);

// 通識畢業認列的版本。依**學生入學年度**選，不是依課程開設年度。
//
// 115 學年度起入學新生取消「現代公民與社會實踐」與「科學與人文的對話」兩門核心必修，
// 因此基礎必修由 16 學分降為 12（中文 4 + 英文 8）；通識選修維持 12 學分。
// 見 `docs/COURSE_SELECTION_RULES.md` 第四節與下方 `sourceUrl`。
export const GENERAL_EDUCATION_RECOGNITION_VERSIONS = Object.freeze([
  Object.freeze({
    version: '112-114',
    admissionYearFrom: 112,
    admissionYearTo: 114,
    basicCredits: 16,
    coreRequiredCredits: 4,
    coreRequiredCodes: Object.freeze(Object.keys(CORE_REQUIRED_COURSE_CODES)),
    electiveCredits: 12,
    // 跨院認抵上限。**目前無法在真實資料上執行**——資料庫沒有任何欄位標記
    // 「這門課是認抵來的」，因此辨識不出哪些學分要受這個上限約束。
    // 數值先記錄下來（有官方出處），取得認列來源資料後才會真正生效。
    recognitionCapCredits: 6,
    recognitionCapEnforceable: false,
    sourceUrl: GENERAL_EDUCATION_SOURCE_URLS.reform112,
  }),
  Object.freeze({
    version: 'from-115',
    admissionYearFrom: 115,
    admissionYearTo: null,
    basicCredits: 12,
    coreRequiredCredits: 0,
    coreRequiredCodes: Object.freeze([]),
    electiveCredits: 12,
    recognitionCapCredits: 4,
    recognitionCapEnforceable: false,
    sourceUrl: GENERAL_EDUCATION_SOURCE_URLS.reform115,
  }),
]);

const LATEST_RECOGNITION_VERSION = GENERAL_EDUCATION_RECOGNITION_VERSIONS
  .reduce((latest, entry) => (entry.admissionYearFrom > latest.admissionYearFrom ? entry : latest));

// 111 學年度以前入學的學生：官方沒有另外公布一份「111 以前入學適用」的通識畢業
// 認列版本（改革公告講的是課程端）。因此這裡**不自己發明一版**，退回 112-114 並
// 標示 `appliedFallbackVersion`，與 `graduationRuleVersions.js` 對缺版本的處理一致。
export function resolveGeneralEducationRecognitionVersion(admissionYear) {
  const year = Number.isInteger(admissionYear) ? admissionYear : null;

  const matched = year === null ? null : GENERAL_EDUCATION_RECOGNITION_VERSIONS.find(entry => (
    (entry.admissionYearFrom === null || year >= entry.admissionYearFrom)
    && (entry.admissionYearTo === null || year <= entry.admissionYearTo)
  ));

  if (matched) return { entry: matched, appliedFallbackVersion: false, fallbackReason: null };

  const fallback = GENERAL_EDUCATION_RECOGNITION_VERSIONS[0];
  return {
    entry: fallback,
    appliedFallbackVersion: true,
    fallbackReason: year === null
      ? `入學年度未知，通識認列已套用 ${fallback.version} 版規則；此結果僅供參考。`
      : `${year} 學年度入學適用的通識認列版本尚未取得，已套用 ${fallback.version} 版規則；`
        + '此結果僅供參考。',
  };
}

function isCoreRequired(entry) {
  return Object.hasOwn(CORE_REQUIRED_COURSE_CODES, String(entry?.courseCode || '').trim());
}

function matchesBasicNamePrefix(entry) {
  const name = String(entry?.courseName || '').trim();
  return BASIC_REQUIRED_NAME_PREFIXES.some(prefix => name.startsWith(prefix));
}

// 一門通識課是「基礎必修」還是「選修」。
//
// **兩個獨立來源交叉驗證**，比照 `admissionYear` 回填的 `reconcileAdmissionYear()`：
//   1. 課程身分：核心必修課號，或中文／英文的課名前綴。
//   2. 領域欄位：`generalEducationCategory` 有值代表它是領域課＝通識選修；
//      基礎必修不屬於任何領域，應為 null。
//
// 兩者一致就採用；**不一致時歸入選修並記錄下來**，不靜默決定——把不確定性顯性化
// 是這個專案一路在做的事（見 #13B 的 `eligibility: 'unknown'`）。
export function classifyGeneralEducationEntry(entry) {
  const byIdentity = isCoreRequired(entry) || matchesBasicNamePrefix(entry) ? 'basic' : 'elective';
  const hasDomain = entry?.generalEducationCategory !== null
    && entry?.generalEducationCategory !== undefined
    && String(entry.generalEducationCategory).trim() !== '';
  const byDomain = hasDomain ? 'elective' : 'basic';

  if (byIdentity === byDomain) {
    return { bucket: byIdentity, agreed: true, byIdentity, byDomain };
  }
  // 歸選修是保守選擇：把一門課誤算成基礎必修，會讓「基礎必修已修滿」提早成立，
  // 使用者可能因此漏修真正的必修課。誤算成選修最多是低估選修進度。
  return { bucket: 'elective', agreed: false, byIdentity, byDomain };
}

// 把已通過的通識課切成基礎必修與選修兩格。
//
// 呼叫端要自己先篩出 `graduationCategory === 'general'` 且 `passed` 的項目——
// 本函式**不重做**已修判定與最新一次修課的挑選，那是 `courseHistory.js` 的職責，
// 兩邊各寫一套必然漂移。
export function splitGeneralEducationCredits(generalEntries = []) {
  const result = {
    basic: 0,
    elective: 0,
    basicCourses: [],
    electiveCourses: [],
    coreRequiredCompletedCodes: [],
    disagreements: [],
  };

  for (const entry of generalEntries) {
    const { bucket, agreed, byIdentity, byDomain } = classifyGeneralEducationEntry(entry);
    const credits = Number(entry?.credits) || 0;

    result[bucket] += credits;
    result[bucket === 'basic' ? 'basicCourses' : 'electiveCourses'].push(entry);

    if (isCoreRequired(entry)) result.coreRequiredCompletedCodes.push(entry.courseCode);
    if (!agreed) {
      result.disagreements.push({
        courseCode: entry?.courseCode ?? null,
        courseName: entry?.courseName ?? null,
        byIdentity,
        byDomain,
        resolvedAs: bucket,
      });
    }
  }

  return result;
}

// 通識畢業進度：分成基礎必修與選修兩個缺口，並套用過渡規則。
//
// `admissionYear` 為 null 時退回最新規則版本並標示，不猜。
export function evaluateGeneralEducationProgress({
  generalEntries = [],
  admissionYear = null,
  requirement = null,
} = {}) {
  const { entry: version, appliedFallbackVersion, fallbackReason } =
    resolveGeneralEducationRecognitionVersion(admissionYear);
  const split = splitGeneralEducationCredits(generalEntries);

  // 系所對照表若列了自己的通識學分（`generalBasic`／`generalElective`），以它為準
  // ——外文系、國科管院的英文學分就與通則不同。查不到才用版本預設值。
  const basicRequired = Number.isFinite(requirement?.generalBasic)
    ? requirement.generalBasic
    : version.basicCredits;
  const electiveRequired = Number.isFinite(requirement?.generalElective)
    ? requirement.generalElective
    : version.electiveCredits;

  const notes = [];
  let basicGap = Math.max(0, basicRequired - split.basic);
  const electiveGap = Math.max(0, electiveRequired - split.elective);

  // 過渡規則：114 學年度以前入學、未完成兩門核心必修者，可用通識選修補足。
  // 來源：112 學年度起通識選修課程改革說明。
  //
  // **只有這一條在現有資料上算得出來**：核心必修由固定課號辨識。另外兩條
  // （112 前未滿 12 學分可用新四領域補足、115 起舊生已滿 12 不需重修）都依賴
  // 領域層級資料，而成績單的領域欄位是 `(M)`／`(N)` 這類代碼，與四大領域名稱
  // 沒有已知對照，因此無法判定，見下方 `unverifiableRules`。
  const missingCoreCodes = version.coreRequiredCodes
    .filter(code => !split.coreRequiredCompletedCodes.includes(code));

  if (missingCoreCodes.length > 0 && basicGap > 0) {
    const surplusElective = Math.max(0, split.elective - electiveRequired);
    const substituted = Math.min(basicGap, surplusElective);
    if (substituted > 0) {
      basicGap -= substituted;
      notes.push(
        `未完成核心必修（${missingCoreCodes.map(code => CORE_REQUIRED_COURSE_CODES[code]).join('、')}），`
        + `已依過渡規則用多修的通識選修 ${substituted} 學分補足。`
      );
    }
  }

  if (split.disagreements.length > 0) {
    notes.push(
      `有 ${split.disagreements.length} 門通識課的「課程身分」與「領域欄位」判定不一致，`
      + '已保守歸入通識選修，請人工確認。'
    );
  }

  return {
    ruleVersion: version.version,
    ruleSource: version.sourceUrl,
    admissionYear: Number.isInteger(admissionYear) ? admissionYear : null,
    appliedFallbackVersion,
    fallbackReason,
    basic: { earned: split.basic, required: basicRequired, gap: basicGap },
    elective: { earned: split.elective, required: electiveRequired, gap: electiveGap },
    coreRequired: {
      requiredCodes: version.coreRequiredCodes,
      completedCodes: split.coreRequiredCompletedCodes,
      missingCodes: missingCoreCodes,
    },
    // 有官方出處、但目前沒有資料可以執行的規則，明列出來而不是假裝有做。
    unverifiableRules: Object.freeze([
      {
        rule: '跨院認抵學分上限',
        cap: version.recognitionCapCredits,
        blockedBy: '資料庫沒有欄位標記某門課是跨院認抵來的，無法辨識要受上限約束的學分',
      },
      {
        rule: '112 學年度前入學、通識選修未滿 12 學分者可用新四領域補足',
        blockedBy: '成績單的領域欄位是 (M)／(N) 代碼，與四大領域名稱無已知對照',
      },
      {
        rule: '115 學年度起，舊生通識選修已滿 12 學分者不需重修',
        blockedBy: '同上；且需要舊制／新制領域對照才能判定是否已滿',
      },
    ]),
    disagreements: split.disagreements,
    notes,
  };
}

export default {
  CORE_REQUIRED_COURSE_CODES,
  GENERAL_EDUCATION_RECOGNITION_VERSIONS,
  resolveGeneralEducationRecognitionVersion,
  classifyGeneralEducationEntry,
  splitGeneralEducationCredits,
  evaluateGeneralEducationProgress,
};
