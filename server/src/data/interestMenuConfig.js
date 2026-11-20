// 設定頁「想接觸的課程主題」選單的設定。
//
// 這些是**需要人審核**的決定，不是可以從資料推導的事實，所以集中放在這裡、一眼看得到，
// 不散落在邏輯裡。改動前先看對應的註解。

// 三組選單。`level` 是這一組用哪一層標籤類別：本系用子類別（大類別太粗：資工的本系課幾乎全落在
// 「資訊與計算」一個大類別），通識與系外用大類別。
export const INTEREST_MENU_GROUPS = Object.freeze([
  { key: 'department', label: '本系', level: 'sub' },
  { key: 'generalEducation', label: '通識', level: 'main' },
  { key: 'outside', label: '系外（不含理工類學院）', level: 'main' },
]);

// 每一組最多顯示幾個選項，依課程數由多到少。
export const MENU_OPTION_LIMIT = 8;

// 追問時每個分類最多給 GPT／使用者看幾個候選標籤。
export const FOLLOWUP_CANDIDATE_LIMIT = 20;

// 這兩個大類別描述的是「課程怎麼上」而不是「主題」，不當選項。
export const EXCLUDED_MAIN_CATEGORY_NAMES = Object.freeze([
  '學習階段與課程情境',
  '課程活動與評量',
]);

// ── 直接確認（direct）白名單 ──────────────────────────────────────────────
//
// 勾選這些本系子類別時不追問，直接把底下「候選池裡實際命中、可計分」的標籤展開，顯示給學生確認。
//
// **為什麼是白名單，不是「標籤數 ≤ N」**：2026-11-20 的盤點顯示小不等於一致。
// 「資訊安全與隱私」（資訊安全、數據保護、Cryptography、對稱加密、數位簽章、資通安全）確實
// 一致；但「人力資源與營運」（網路管理、企業資源規劃、商業法）、「經濟金融」（電子商務、案例分析、
// 邏輯思考）、「航太與製造」（資訊工程、製造業、工業自動化）標籤數都不多，內容卻混雜。
// 要加入新的項目，必須先看過它在候選池裡實際展開的標籤。
export const DIRECT_SUBCATEGORIES = Object.freeze([
  { mainCategory: '資訊與計算', subcategory: '資訊安全與隱私' },
]);

// 即使在白名單裡，展開的標籤超過這個數量就退回追問（目錄更版後內容可能變了，不能盲目展開）。
export const DIRECT_MAX_TAGS = 12;

// ── 系外選單的理工排除 ──────────────────────────────────────────────────────
//
// 系外選單與追問不推理工類學院的課。只適用系外組；排除的是**選單與追問**，不是排課計分：
// S_tag 依全域標籤配對，所以理工系外課仍可能因共享標籤被加分（盤點量測：每個類別只波及 1～7 門，
// 已知限制，驗收時量測並寫進報告）。
//
// `COLLEGE_DEPARTMENTS` 只涵蓋 27 個系所，這裡另外明列對照表沒有、但屬理工的單位。
// 不修改 `COLLEGE_DEPARTMENTS` 本身：它也用於學院綜合班的修課資格判定。
export const STEM_COLLEGES = Object.freeze(['資訊電機學院', '工程與科學學院', '建設學院']);

export const STEM_EXTRA_UNITS = Object.freeze([
  '環境工程與科學學系',
  '航太與系統工程學系',
  '人工智慧技術與應用學士學位學程',
  '應用數學系', // 使用者 2026-11-20 決定排除
  '創能學院綜合班', // 使用者 2026-11-20 決定排除
]);

// 候選池快取：重建一次約 2 秒，選單與保存驗證共用。
export const POOL_CACHE_TTL_MS = 10 * 60 * 1000;
export const POOL_CACHE_MAX_ENTRIES = 200;

export default {
  INTEREST_MENU_GROUPS,
  MENU_OPTION_LIMIT,
  FOLLOWUP_CANDIDATE_LIMIT,
  EXCLUDED_MAIN_CATEGORY_NAMES,
  DIRECT_SUBCATEGORIES,
  DIRECT_MAX_TAGS,
  STEM_COLLEGES,
  STEM_EXTRA_UNITS,
  POOL_CACHE_TTL_MS,
  POOL_CACHE_MAX_ENTRIES,
};
