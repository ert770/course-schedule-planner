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

// ── 追問（follow-up）──────────────────────────────────────────────────────────
// 追問時每個分類最多給 GPT 看幾個候選標籤（依課程數排序後取前 N 個）。
export const FOLLOWUP_CANDIDATE_LIMIT = 20;
// 學生實際看到的選項數（依 GPT 的排序取前 N 個）；學生以前選過、仍然有效的標籤不受這個上限限制。
export const FOLLOWUP_DISPLAY_LIMIT = 12;
// 一次請求最多追問幾個分類。
export const FOLLOWUP_MAX_CATEGORIES = 6;
// 呼叫 OpenAI 的逾時；超過就改用固定問句，不擋住保存。
export const FOLLOWUP_GPT_TIMEOUT_MS = 12_000;
// 同一個分類、同一份候選標籤的題目在伺服器記憶體快取多久（所有使用者共用，不含任何個人資料）。
export const FOLLOWUP_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
// 每位使用者每分鐘最多幾次追問請求。
export const FOLLOWUP_REQUESTS_PER_MINUTE = 6;
// GPT 寫的問題超過這個長度（或含網址）就視為不可用，改用固定問句。
export const FOLLOWUP_QUESTION_MAX_LENGTH = 80;

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

// ── 本系選單的隱藏清單（待使用者審核）─────────────────────────────────────────
//
// 目錄的子類別名稱常常對不到實際內容：這些子類別在候選池裡命中的標籤混雜，列成選項只會讓學生選到
// 看不懂的東西。依系所分開——同一個子類別在不同系所對到的課完全不同（資工的「人力資源與營運」是網路管理、
// 企業資源規劃，企管的同名子類別卻是行銷、消費者行為），所以不在這裡列出的系所一律不隱藏。
//
// 鍵是 `大類別/子類別`。同一組「池內標籤集合」相同的重複子類別會先併成一個選項，**只有當這組裡的
// 每一個成員都在清單內才隱藏**：只要有一個成員不在清單內，代表這個標籤集合同時也屬於別的、沒被標為雜訊
// 的子類別，就不能隱藏。
//
// 2026-11-20 盤點（資工三年級）：
//   - 人力資源與營運（網路管理、企業資源規劃、商業法、商業模式、資產管理）與併進來的「企業」「行銷」。
//   - 航太與製造（資訊工程、製造業、工業自動化）與併進來的「土木」「化工」「機械」「材料」「建設」。
export const HIDDEN_SUBCATEGORIES = Object.freeze({
  資訊工程學系: Object.freeze([
    '商業與管理/人力資源與營運',
    '商業與管理/企業',
    '商業與管理/行銷',
    '工程與製造/航太與製造',
    '工程與製造/土木',
    '工程與製造/化工',
    '工程與製造/機械',
    '工程與製造/材料',
    '工程與製造/建設',
  ]),
});

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
  FOLLOWUP_DISPLAY_LIMIT,
  FOLLOWUP_MAX_CATEGORIES,
  FOLLOWUP_GPT_TIMEOUT_MS,
  FOLLOWUP_CACHE_TTL_MS,
  FOLLOWUP_REQUESTS_PER_MINUTE,
  FOLLOWUP_QUESTION_MAX_LENGTH,
  EXCLUDED_MAIN_CATEGORY_NAMES,
  DIRECT_SUBCATEGORIES,
  DIRECT_MAX_TAGS,
  HIDDEN_SUBCATEGORIES,
  STEM_COLLEGES,
  STEM_EXTRA_UNITS,
  POOL_CACHE_TTL_MS,
  POOL_CACHE_MAX_ENTRIES,
};
