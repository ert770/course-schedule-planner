function normalizeString(value) {
  return String(value ?? '').trim();
}

export function normalizeInterestList(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(normalizeString).filter(Boolean))];
}

// 設定頁「想接觸的課程主題」的選擇結果，依「組別＋分類」保存。
//
// 為什麼不用兩個全域陣列（分類 ID、標籤 ID）：通識的「語言」與系外的「語言」是不同的
// 選單，各自選了日語與韓語時，兩個陣列無法還原答案分別屬於哪一組，取消其中一組也撤不乾淨。
// 這裡每一筆自成一組 `{ group, categoryId, level, mode, tagIds }`，以 `(group, categoryId)`
// 為鍵；提供給 S_tag 的先驗則是所有筆的 `tagIds` 合併去重（見 `tagInterestLearning.js`）。
//
// 這個檔只做「形狀」正規化。標籤與分類是否存在於目錄、標籤是否屬於所選組別，由
// `interestSelections.js` 對照目錄與候選池驗證——那邊要讀標籤目錄，而標籤目錄本身又
// import 這個檔，所以兩者不能放在同一個模組裡（會循環 import）。
export const INTEREST_SELECTION_GROUPS = Object.freeze(['department', 'generalEducation', 'outside']);
export const INTEREST_SELECTION_MODES = Object.freeze(['direct', 'followup']);

export function normalizeInterestSelections(value) {
  if (!Array.isArray(value)) return [];
  // 同一個 (group, categoryId) 以後出現的為準：重送整份清單時，最後一次作答才算數。
  const byKey = new Map();
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const group = normalizeString(item.group);
    const categoryId = normalizeString(item.categoryId);
    if (!INTEREST_SELECTION_GROUPS.includes(group) || !categoryId) continue;
    const level = item.level === 'sub' || item.level === 'main'
      ? item.level
      : (categoryId.startsWith('sub_') ? 'sub' : 'main');
    const mode = item.mode === 'direct' ? 'direct' : 'followup';
    byKey.set(`${group}\u0000${categoryId}`, {
      group,
      categoryId,
      level,
      mode,
      tagIds: normalizeInterestList(item.tagIds),
    });
  }
  return [...byKey.values()];
}

// 匯出供 personalizationPreferences.js 共用——preferences_json 的 canonical shape
// 只該有一份定義，兩個模組各自維護一份遲早會不一致。
export function normalizePreferencesJson(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { schemaVersion: 1, values: {} };
  }

  return {
    ...value,
    schemaVersion: Number.isInteger(Number(value.schemaVersion))
      ? Number(value.schemaVersion)
      : 1,
    values: value.values && typeof value.values === 'object' && !Array.isArray(value.values)
      ? { ...value.values }
      : {},
  };
}

// 已移除的舊文字興趣欄位（ADR-032，2026-11-23）。2026-11-23 以一次性轉移
// （scripts/legacyInterestMigration.js）轉成 interestSelections 後刪除；之後任何寫入都會把殘留的鍵刪掉，
// 讀取也不再回傳。AI 聊天單次排課的 interests／preferredKeywords 是請求參數，不經過這裡。
export const REMOVED_INTEREST_FIELDS = Object.freeze(['interests', 'preferredKeywords']);

// 興趣偏好使用既有 preferences_json 保存，不另增一組 MySQL 欄位。這個 helper
// 同時接受 profile 頂層欄位與 JSON 內的正式儲存值。長期興趣只剩課程主題問答的勾選。
export function readInterestPreferences(source = {}) {
  const preferencesJson = normalizePreferencesJson(source.preferencesJson);
  const values = preferencesJson.values;

  return {
    preferredTrack: normalizeString(source.preferredTrack ?? values.preferredTrack) || null,
    interestSelections: normalizeInterestSelections(
      source.interestSelections ?? values.interestSelections
    ),
  };
}

export function mergeInterestPreferences(preferencesJson, updates = {}) {
  const next = normalizePreferencesJson(preferencesJson);
  const values = { ...next.values };

  if (Object.hasOwn(updates, 'preferredTrack')) {
    values.preferredTrack = normalizeString(updates.preferredTrack) || null;
  }
  // 舊欄位一律不寫，殘留的鍵在任何一次寫入時刪除（ADR-032）。
  for (const field of REMOVED_INTEREST_FIELDS) delete values[field];
  if (Object.hasOwn(updates, 'interestSelections')) {
    values.interestSelections = normalizeInterestSelections(updates.interestSelections);
  }

  return { ...next, values };
}

export default {
  INTEREST_SELECTION_GROUPS,
  REMOVED_INTEREST_FIELDS,
  INTEREST_SELECTION_MODES,
  normalizeInterestList,
  normalizeInterestSelections,
  readInterestPreferences,
  mergeInterestPreferences,
};
