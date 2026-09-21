// Roadmap #10 任務 3A：個人化學習的**使用者開關**。
//
// 與 `interestPreferences.js` 分開的理由很實際：那個模組處理的是「使用者想修什麼」，
// 這裡處理的是「系統可不可以用學到的偏好」。把學習開關塞進只處理興趣的函式裡，日後
// 兩邊都會變得難以閱讀，也容易在更新其中一邊時誤蓋另一邊。
//
// **儲存位置**：`User_Profiles.preferences_json.values.useLearnedPreference`。
// 不能只送頂層欄位——`db/database.js` 只持久化白名單內的 MySQL 欄位，頂層的
// `useLearnedPreference` 會被靜默丟棄；`preferCompact` 之類的旗標則是由
// `preference_tags` 推導出來的，也不是可以直接寫入的欄位。
//
// **3A 不消費這個欄位。** 這一輪只負責定義、持久化與測試；真正讓它生效（在
// `preferenceLearningService.getSchedulingPreferenceWeights()` 回 `user-opted-out`）
// 是 3B 的事，那一步同時要補前端介面與來源說明。提前生效會讓 3A 不再是 shadow。
import { normalizePreferencesJson } from './interestPreferences.js';

// 預設開啟：使用者同意個人化學習之後，系統本來就會用學到的權重。這個開關是
// 「我不要」的出口，不是另一道同意閘門（同意與否由 #33 的 consent 機制管）。
export const USE_LEARNED_PREFERENCE_DEFAULT = true;

// 只接受真正的布林值。字串 'false'、0、null 一律退回預設——一個決定「要不要用
// 學到的偏好」的旗標，不該靠型別轉換猜測使用者的意思。
function readBoolean(value, fallback) {
  return typeof value === 'boolean' ? value : fallback;
}

export function readPersonalizationPreferences(source = {}) {
  const { values } = normalizePreferencesJson(source?.preferencesJson);
  return {
    useLearnedPreference: readBoolean(
      source?.useLearnedPreference ?? values.useLearnedPreference,
      USE_LEARNED_PREFERENCE_DEFAULT
    ),
  };
}

// 只在 updates 真的帶了這個欄位時才動它——否則更新興趣會把開關洗掉，反之亦然。
// 這與 `mergeInterestPreferences()` 是同一個原則，兩者可以串接。
export function mergePersonalizationPreferences(preferencesJson, updates = {}) {
  const next = normalizePreferencesJson(preferencesJson);
  if (!Object.hasOwn(updates, 'useLearnedPreference')) return next;

  return {
    ...next,
    values: {
      ...next.values,
      useLearnedPreference: readBoolean(
        updates.useLearnedPreference,
        USE_LEARNED_PREFERENCE_DEFAULT
      ),
    },
  };
}

export const PERSONALIZATION_PREFERENCE_FIELDS = Object.freeze(['useLearnedPreference']);

export default {
  USE_LEARNED_PREFERENCE_DEFAULT,
  PERSONALIZATION_PREFERENCE_FIELDS,
  readPersonalizationPreferences,
  mergePersonalizationPreferences,
};
