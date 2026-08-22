// Roadmap #21：hard/soft constraint 的正式 schema。
//
// 在這之前，`scheduler.js` 的硬性限制與軟性偏好完全是「行為隱含分類」——
// 一個旗標是硬性還是軟性，取決於它被 `hardConstraintReason()` 檢查、還是被
// `scoreCourse()`／`getContentPreferenceScore()` 加減分，schema 本身沒有
// 資料能回答「這個限制可不可以放寬」「這個限制的判定有多可靠」。
//
// 本檔案把每個既有限制類型（硬性與軟性都算）正式登記成資料，補上 roadmap #21
// 要求的 4 個欄位：`weight`、`relaxable`、`source`、`confidence`，並額外加上
// `exemptForRequiredCourses`（必修是否無條件豁免）與 `enforced`（validator
// 是否真的檢查得到）。**這是純資料表，不是新的執行邏輯**——`scheduler.js`
// 目前的排除／評分機制完全不變，這裡只是把「目前的行為分類」寫成可查詢的
// 資料，供 `scheduleValidator.js`（roadmap #21 的獨立 validator）與
// `generateSchedule()` 的結構化 conflict set／放寬階梯使用。

export const CONSTRAINT_CATEGORY = Object.freeze({
  HARD: 'hard',
  SOFT: 'soft',
});

// 限制的「真實性來源」，供除錯與追查用——跟 `courseScope.js` 的
// `ELIGIBILITY_SOURCE` 同一種「不得用裸字串，固定代號」的紀律，但這裡是
// **限制類型層級**的登記表（一種限制對應一個 source），不是逐課程的分類
// 依據，兩者刻意不合併。
export const CONSTRAINT_SOURCE = Object.freeze({
  USER_FLAG: 'user:flag',
  USER_EXPLICIT_SELECTION: 'user:explicit-selection',
  USER_CONTENT_KEYWORD: 'user:content-keyword',
  USER_NUMERIC_LIMIT: 'user:numeric-limit',
  ACADEMIC_RECORD: 'academic-record:completed-courses',
  REQUIRED_SCOPE: 'academic-record:required-scope',
  CATALOG_TERM: 'catalog:term-metadata',
  CATALOG_ELIGIBILITY: 'catalog:eligibility-classification',
  DERIVED_SCHEDULE: 'derived:schedule-conflict',
  UNIMPLEMENTED: 'unimplemented:no-data-source',
});

// 放寬階梯在使用者未指定 `constraints.timePreferencePriority` 時的預設順序
// （對應各條目的 `weight`，數字小的先放寬）。使用者可以自訂順序整個蓋掉這個
// 預設值——不是寫死的規則，是沒有更好資訊時的退回值。
export const DEFAULT_TIME_PREFERENCE_PRIORITY = [
  'NO_MORNING_CLASSES',
  'LUNCH_BREAK_FREE',
  'NO_EVENING_CLASSES',
];

// 每個限制類型一筆。欄位意義：
//
// - category：'hard' 會排除課程／方案；'soft' 只影響 scoreCourse() 的排序分數，
//   不排除任何課程。**本次不會讓任何限制改變類別**，維持現行機制行為。
// - relaxable：只對 hard 條目有意義。true = 可被 opt-in 放寬階梯
//   （`constraints.allowRelaxation`）納入放寬；false = 永遠不進入階梯。
// - exemptForRequiredCourses：true 時，排入 `isRequiredForStudent()===true`
//   的課程時這項檢查無條件跳過，與 `allowRelaxation` 無關、永遠生效。目前
//   僅 3 個時段類舒適偏好為 true；`BLOCKED_PERIODS`（代表真實的外部不可用
//   時段，例如工作）明確為 false——必修課也不豁免。
// - weight：對可放寬條目而言是階梯的預設退回排序；對軟性條目而言是既有評分
//   常數的字面鏡射（僅供文件說明，`scoreCourse()` 不會動態讀這張表）。
// - source：CONSTRAINT_SOURCE 其中一個值。
// - confidence：**不是**「這個限制多嚴格」（那是 relaxable），而是「系統對
//   這項判定的偵測結果有多確定」。結構性事實（衝堂、學分加總、資格查詢等）
//   一律是 1——偵測本身不含糊。只有 8 個內容偏好關鍵字判定是 null，因為
//   它們的可靠度是候選池依賴、每次請求才知道的（見 `computeContentPreferenceSignal()`）。
// - overridableBy：使用者以哪種方式可以繞過這項排除（明確選課），只用於
//   既有的「排除但使用者明確指定時保留＋警告」模式，跟 relaxable 是不同機制。
// - flag／label：只有能對應到單一布林旗標的限制才有這兩個欄位，供放寬階梯與
//   揭露警告查表使用，避免在多處重複寫死字串。
// - enforced：false 代表 validator 完全不檢查這項——目前只有先修／共修，
//   因為專案裡沒有任何資料來源可查（見 change report）。
export const CONSTRAINTS = Object.freeze({
  TIME_CONFLICT: {
    id: 'TIME_CONFLICT',
    category: CONSTRAINT_CATEGORY.HARD,
    relaxable: false,
    exemptForRequiredCourses: false,
    weight: null,
    source: CONSTRAINT_SOURCE.DERIVED_SCHEDULE,
    confidence: 1,
    enforced: true,
  },
  DUPLICATE_SECTION: {
    id: 'DUPLICATE_SECTION',
    category: CONSTRAINT_CATEGORY.HARD,
    relaxable: false,
    exemptForRequiredCourses: false,
    weight: null,
    source: CONSTRAINT_SOURCE.DERIVED_SCHEDULE,
    confidence: 1,
    enforced: true,
  },
  BLOCKED_PERIODS: {
    id: 'BLOCKED_PERIODS',
    category: CONSTRAINT_CATEGORY.HARD,
    relaxable: false,
    exemptForRequiredCourses: false,
    weight: null,
    source: CONSTRAINT_SOURCE.USER_FLAG,
    confidence: 1,
    enforced: true,
  },
  CREDIT_CEILING: {
    id: 'CREDIT_CEILING',
    category: CONSTRAINT_CATEGORY.HARD,
    relaxable: false,
    exemptForRequiredCourses: false,
    weight: null,
    source: CONSTRAINT_SOURCE.USER_NUMERIC_LIMIT,
    confidence: 1,
    enforced: true,
  },
  CREDIT_FLOOR: {
    id: 'CREDIT_FLOOR',
    // 目前只發警告（見 S9），不排除課程或方案，因此歸類為 soft/advisory。
    category: CONSTRAINT_CATEGORY.SOFT,
    relaxable: null,
    exemptForRequiredCourses: null,
    weight: null,
    source: CONSTRAINT_SOURCE.USER_NUMERIC_LIMIT,
    confidence: 1,
    enforced: true,
  },
  ELIGIBILITY_UNKNOWN: {
    id: 'ELIGIBILITY_UNKNOWN',
    category: CONSTRAINT_CATEGORY.HARD,
    relaxable: false,
    exemptForRequiredCourses: false,
    weight: null,
    source: CONSTRAINT_SOURCE.CATALOG_ELIGIBILITY,
    confidence: 1,
    overridableBy: CONSTRAINT_SOURCE.USER_EXPLICIT_SELECTION,
    enforced: true,
  },
  ALREADY_TAKEN_PASSED: {
    id: 'ALREADY_TAKEN_PASSED',
    category: CONSTRAINT_CATEGORY.HARD,
    relaxable: false,
    exemptForRequiredCourses: false,
    weight: null,
    source: CONSTRAINT_SOURCE.ACADEMIC_RECORD,
    confidence: 1,
    enforced: true,
  },
  OTHER_STUDENT_REQUIRED: {
    id: 'OTHER_STUDENT_REQUIRED',
    category: CONSTRAINT_CATEGORY.HARD,
    relaxable: false,
    exemptForRequiredCourses: false,
    weight: null,
    source: CONSTRAINT_SOURCE.REQUIRED_SCOPE,
    confidence: 1,
    overridableBy: CONSTRAINT_SOURCE.USER_EXPLICIT_SELECTION,
    enforced: true,
  },
  OUTSIDE_ELECTIVE_INELIGIBLE: {
    id: 'OUTSIDE_ELECTIVE_INELIGIBLE',
    category: CONSTRAINT_CATEGORY.HARD,
    relaxable: false,
    exemptForRequiredCourses: false,
    weight: null,
    source: CONSTRAINT_SOURCE.CATALOG_ELIGIBILITY,
    confidence: 1,
    overridableBy: CONSTRAINT_SOURCE.USER_EXPLICIT_SELECTION,
    enforced: true,
  },
  OFF_TERM: {
    id: 'OFF_TERM',
    category: CONSTRAINT_CATEGORY.HARD,
    relaxable: false,
    exemptForRequiredCourses: false,
    weight: null,
    source: CONSTRAINT_SOURCE.CATALOG_TERM,
    confidence: 1,
    overridableBy: CONSTRAINT_SOURCE.USER_EXPLICIT_SELECTION,
    enforced: true,
  },
  DAILY_COURSE_CAP: {
    id: 'DAILY_COURSE_CAP',
    category: CONSTRAINT_CATEGORY.HARD,
    relaxable: false,
    exemptForRequiredCourses: false,
    weight: null,
    source: CONSTRAINT_SOURCE.USER_NUMERIC_LIMIT,
    confidence: 1,
    enforced: true,
  },
  NO_MORNING_CLASSES: {
    id: 'NO_MORNING_CLASSES',
    category: CONSTRAINT_CATEGORY.HARD,
    relaxable: true,
    exemptForRequiredCourses: true,
    weight: 10,
    source: CONSTRAINT_SOURCE.USER_FLAG,
    confidence: 1,
    enforced: true,
    flag: 'noMorningClasses',
    label: '不排早八',
  },
  LUNCH_BREAK_FREE: {
    id: 'LUNCH_BREAK_FREE',
    category: CONSTRAINT_CATEGORY.HARD,
    relaxable: true,
    exemptForRequiredCourses: true,
    weight: 20,
    source: CONSTRAINT_SOURCE.USER_FLAG,
    confidence: 1,
    enforced: true,
    flag: 'lunchBreakFree',
    label: '午休保留',
  },
  NO_EVENING_CLASSES: {
    id: 'NO_EVENING_CLASSES',
    category: CONSTRAINT_CATEGORY.HARD,
    relaxable: true,
    exemptForRequiredCourses: true,
    weight: 30,
    source: CONSTRAINT_SOURCE.USER_FLAG,
    confidence: 1,
    enforced: true,
    flag: 'noEveningClasses',
    label: '不排晚課',
  },
  REQUIRED_COURSE_COVERAGE: {
    id: 'REQUIRED_COURSE_COVERAGE',
    // 只有 validator 會用到（檢查必修／必排 id 是否全數出現在課表中）；
    // 排課引擎本身不透過這個 id 排除課程，它是既有必修排入機制的不變量說明。
    category: CONSTRAINT_CATEGORY.HARD,
    relaxable: false,
    exemptForRequiredCourses: null,
    weight: null,
    source: CONSTRAINT_SOURCE.REQUIRED_SCOPE,
    confidence: 1,
    enforced: true,
  },
  // 8 個內容偏好（roadmap #3）。數值鏡射既有的 CONTENT_PREFERENCE_SCORE（40），
  // 純供文件說明——`scoreCourse()` 內建算式維持逐位元組不變，不會動態讀這張表。
  CONTENT_PREFERENCE_NO_MIDTERM: {
    id: 'CONTENT_PREFERENCE_NO_MIDTERM',
    category: CONSTRAINT_CATEGORY.SOFT,
    relaxable: null,
    exemptForRequiredCourses: null,
    weight: 40,
    source: CONSTRAINT_SOURCE.USER_CONTENT_KEYWORD,
    confidence: null,
    enforced: true,
  },
  CONTENT_PREFERENCE_NO_GROUP_REPORT: {
    id: 'CONTENT_PREFERENCE_NO_GROUP_REPORT',
    category: CONSTRAINT_CATEGORY.SOFT,
    relaxable: null,
    exemptForRequiredCourses: null,
    weight: 40,
    source: CONSTRAINT_SOURCE.USER_CONTENT_KEYWORD,
    confidence: null,
    enforced: true,
  },
  CONTENT_PREFERENCE_DISCUSSION: {
    id: 'CONTENT_PREFERENCE_DISCUSSION',
    category: CONSTRAINT_CATEGORY.SOFT,
    relaxable: null,
    exemptForRequiredCourses: null,
    weight: 40,
    source: CONSTRAINT_SOURCE.USER_CONTENT_KEYWORD,
    confidence: null,
    enforced: true,
  },
  CONTENT_PREFERENCE_WEIGHT_DAILY: {
    id: 'CONTENT_PREFERENCE_WEIGHT_DAILY',
    category: CONSTRAINT_CATEGORY.SOFT,
    relaxable: null,
    exemptForRequiredCourses: null,
    weight: 40,
    source: CONSTRAINT_SOURCE.USER_CONTENT_KEYWORD,
    confidence: null,
    enforced: true,
  },
  CONTENT_PREFERENCE_PRACTICAL_EXAM: {
    id: 'CONTENT_PREFERENCE_PRACTICAL_EXAM',
    category: CONSTRAINT_CATEGORY.SOFT,
    relaxable: null,
    exemptForRequiredCourses: null,
    weight: 40,
    source: CONSTRAINT_SOURCE.USER_CONTENT_KEYWORD,
    confidence: null,
    enforced: true,
  },
  CONTENT_PREFERENCE_FINAL_REPORT: {
    id: 'CONTENT_PREFERENCE_FINAL_REPORT',
    category: CONSTRAINT_CATEGORY.SOFT,
    relaxable: null,
    exemptForRequiredCourses: null,
    weight: 40,
    source: CONSTRAINT_SOURCE.USER_CONTENT_KEYWORD,
    confidence: null,
    enforced: true,
  },
  CONTENT_PREFERENCE_ENGLISH_TAUGHT: {
    id: 'CONTENT_PREFERENCE_ENGLISH_TAUGHT',
    category: CONSTRAINT_CATEGORY.SOFT,
    relaxable: null,
    exemptForRequiredCourses: null,
    weight: 40,
    source: CONSTRAINT_SOURCE.USER_CONTENT_KEYWORD,
    confidence: null,
    enforced: true,
  },
  CONTENT_PREFERENCE_LEARN_MORE: {
    id: 'CONTENT_PREFERENCE_LEARN_MORE',
    category: CONSTRAINT_CATEGORY.SOFT,
    relaxable: null,
    exemptForRequiredCourses: null,
    weight: 40,
    source: CONSTRAINT_SOURCE.USER_CONTENT_KEYWORD,
    confidence: null,
    enforced: true,
  },
  // roadmap #15：正課與實習的窄範圍共修規則（`subid3` 的 `P` 後綴配對），
  // 與下面 `COREQUISITE`（roadmap #8 負責的廣義先修／共修概念，任意課程間
  // 的共同修習規則，目前完全沒有資料來源）是兩個不同層級的東西，不要混淆，
  // 也不要因為這個交付了就誤以為下面 COREQUISITE 的缺口已解決。本項目有
  // 明確、可查證的資料來源（P 後綴字串規則 + 候選池 partner-existence
  // 查找，已用真實 MySQL 資料驗證），因此 `enforced:true`、`confidence:1`，
  // 與 `TIME_CONFLICT`／`DUPLICATE_SECTION` 同一 source 等級——都是從課程
  // 代碼結構推導出的事實，不是使用者偏好。
  COREQUISITE_PAIR_INCOMPLETE: {
    id: 'COREQUISITE_PAIR_INCOMPLETE',
    category: CONSTRAINT_CATEGORY.HARD,
    relaxable: false,
    exemptForRequiredCourses: false,
    weight: null,
    source: CONSTRAINT_SOURCE.DERIVED_SCHEDULE,
    confidence: 1,
    enforced: true,
  },
  // 先修／共修：資料庫與程式碼裡完全沒有這方面的資料來源（已用 grep 確認
  // `server/src` 與 `docs/DB_AUDIT_REPORT_2026-08-05.md` 皆無先修表；
  // roadmap #8 本身尚未開始，才是這個資料模型真正的負責項目）。這裡定義
  // 這個層級存在、屬於 hard，但 `enforced:false`——validator 會誠實回報
  // 「沒有檢查」，而不是假裝檢查過或悄悄放行。
  PREREQUISITE: {
    id: 'PREREQUISITE',
    category: CONSTRAINT_CATEGORY.HARD,
    relaxable: false,
    exemptForRequiredCourses: false,
    weight: null,
    source: CONSTRAINT_SOURCE.UNIMPLEMENTED,
    confidence: 0,
    enforced: false,
  },
  COREQUISITE: {
    id: 'COREQUISITE',
    category: CONSTRAINT_CATEGORY.HARD,
    relaxable: false,
    exemptForRequiredCourses: false,
    weight: null,
    source: CONSTRAINT_SOURCE.UNIMPLEMENTED,
    confidence: 0,
    enforced: false,
  },
});

export default {
  CONSTRAINT_CATEGORY,
  CONSTRAINT_SOURCE,
  DEFAULT_TIME_PREFERENCE_PRIORITY,
  CONSTRAINTS,
};
