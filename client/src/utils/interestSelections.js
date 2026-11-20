// 設定頁課程主題選擇結果的鍵：(組別, 分類 ID)。
// 通識與系外都有「語言」時各自一筆，所以不能只用分類 ID。
export const followupKey = (group, categoryId) => `${group}|${categoryId}`;
