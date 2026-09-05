// 偏好標籤與排課旗標的唯一對照表。
//
// **為什麼需要這份檔案**：先前標籤清單只存在於 `client/src/pages/SetupPage.jsx`，
// 而每個標籤對應的布林是在該檔案裡逐行手寫（`noMorningClasses: selectedTags.has('#不排早八')` …）。
// 後端完全不知道有哪些標籤，於是：
//
//   1. `updateMysqlUserPreference()` 只認 `preferenceTags` / `preferredCategories`，
//      Setup 送出的是 `selectedTags`，兩者對不上——**`User_Profiles.preference_tags`
//      從來沒有被前端更新過**。資料庫裡那筆 `["#不點名"]` 因此留存至今
//      （見 `docs/CHANGE_REPORTS/2026-08-01-database-audit.md:183` 的 F4）。
//   2. 12 個布林被逐一存進 JSON，與 MySQL 的 `preference_tags` 各存一份而漂移。
//
// **標籤是儲存格式，布林是計算格式。** 每個標籤與一個排課旗標一對一，因此
// `preference_tags` 這個既有欄位就足以表達全部偏好，不需要新增 12 個欄位，
// 也沒有所謂「偏好溢出」。讀取時由標籤推導布林即可。

// 第 1 節（早八）由 `#不排早八` 表達，`avoid_time` 只管第 2～14 節。
// 見 `docs/DATA_SCHEMA.md` 與 `server/src/utils/periods.js` 的節次對照。
export const MORNING_PERIOD = 1;

export const PREFERENCE_TAG_GROUPS = [
  {
    category: '上課時間',
    tags: ['#盡量集中排課', '#不排早八', '#星期一排空', '#午休務必空出'],
  },
  {
    category: '評量方式偏好',
    tags: ['#無期中考', '#上機實作考試', '#期末報告為主', '#平時成績佔比高'],
  },
  {
    category: '課程型態與互動',
    tags: ['#無分組報告', '#高度課堂討論', '#全英授課', '#學到許多知識', '#不點名'],
  },
  // Roadmap #5B：難度**方向**必須由使用者自己講。
  //
  // 互動事件的 `feedbackReason` 只有 `workload`（太重），**沒有任何欄位能表達
  // 「太簡單、我要更難」**——方向若從行為推論，那個符號只能是憑空編的。
  // 因此方向一律來自這兩個標籤，`#30` 學到的權重只提供強度。
  //
  // `#涼課優先` 不只是補一個 checkbox：`preferEasyCourses` 這個旗標從 `#5A`
  // 起就被 `scheduler.js` 讀取，但**從來沒有任何 UI 或儲存路徑設定過它**，
  // 排課時恆為 undefined。這個標籤才真正把那條路接通。
  {
    category: '課程難度',
    tags: ['#涼課優先', '#挑戰難課'],
  },
];

// 標籤 → 排課旗標。
//
// `#不點名` 原本只存在於資料庫、不在前端清單中（稽核報告 F4）。
// 現已納入正式清單並補上對應旗標，不再是無處可去的孤兒值。
export const TAG_TO_FLAG = new Map([
  ['#盡量集中排課', 'preferCompact'],
  ['#不排早八', 'noMorningClasses'],
  ['#星期一排空', 'mondayFree'],
  ['#午休務必空出', 'lunchBreakFree'],
  ['#無期中考', 'noMidterm'],
  ['#上機實作考試', 'practicalExam'],
  ['#期末報告為主', 'finalReport'],
  ['#平時成績佔比高', 'weightDaily'],
  ['#無分組報告', 'noGroupReport'],
  ['#高度課堂討論', 'preferDiscussion'],
  ['#全英授課', 'englishTaught'],
  ['#學到許多知識', 'learnMore'],
  ['#不點名', 'noRollCall'],
  // Roadmap #5B：兩者互斥（同時勾選由 `scheduler.js` 的 `resolveEasyDirection()`
  // 視為未表態並發出警告）。**刻意不在這裡做互斥**——儲存層丟掉使用者真的存過
  // 的標籤，正是上方註解記載的「偏好靜默消失」那一類 bug。
  ['#涼課優先', 'preferEasyCourses'],
  ['#挑戰難課', 'preferChallengingCourses'],
]);

export const FLAG_TO_TAG = new Map(
  [...TAG_TO_FLAG.entries()].map(([tag, flag]) => [flag, tag])
);

export const ALL_TAGS = [...TAG_TO_FLAG.keys()];
export const ALL_FLAGS = [...TAG_TO_FLAG.values()];

export function isKnownTag(tag) {
  return TAG_TO_FLAG.has(String(tag ?? '').trim());
}

function toArray(value) {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null) return [];
  return [value];
}

// 標籤陣列 → 排課旗標物件。
//
// **只回傳為 true 的旗標。** 缺席代表「使用者沒有勾這個標籤」，
// 與「使用者明確存了 false」在儲存層是同一件事——標籤不在陣列裡就是沒勾。
// 這裡刻意不補 false 預設值：`mapUserProfileRow()` 先前合成 `preferCompact: false`
// 等值，讀取時把使用者真正存的 true 蓋掉，是偏好靜默消失的直接原因。
export function tagsToFlags(tags) {
  const flags = {};
  for (const raw of toArray(tags)) {
    const flag = TAG_TO_FLAG.get(String(raw ?? '').trim());
    if (flag) flags[flag] = true;
  }
  return flags;
}

// 排課旗標物件 → 標籤陣列。只收 `=== true`，避免把 undefined 或字串當成已勾選。
export function flagsToTags(flags = {}) {
  const tags = [];
  for (const [tag, flag] of TAG_TO_FLAG.entries()) {
    if (flags[flag] === true) tags.push(tag);
  }
  return tags;
}

// 從一份 payload 取出標籤清單。
//
// 三種歷史寫法都要認得：Setup 送的 `selectedTags`、MySQL 讀出的 `preferenceTags`、
// 以及更早的 `preferredCategories`。**先前只認後兩者，所以 Setup 的偏好永遠寫不進去。**
// 同時接受「只送旗標不送標籤」的呼叫端（例如 AI Agent 的 update_preferences）。
export function extractTags(payload = {}) {
  const explicit = payload.selectedTags ?? payload.preferenceTags ?? payload.preferredCategories;
  if (Array.isArray(explicit)) {
    return explicit.map(tag => String(tag ?? '').trim()).filter(isKnownTag);
  }

  const fromFlags = flagsToTags(payload);
  return fromFlags.length > 0 ? fromFlags : null;
}

export default {
  MORNING_PERIOD,
  PREFERENCE_TAG_GROUPS,
  TAG_TO_FLAG,
  FLAG_TO_TAG,
  ALL_TAGS,
  ALL_FLAGS,
  isKnownTag,
  tagsToFlags,
  flagsToTags,
  extractTags,
};
