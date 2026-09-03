// 排課提示的資料整理（roadmap #27 從 DashboardPage 抽出到獨立檔案——
// 純函式與 React 元件混在同一個檔案會讓 Vite fast refresh 失效，元件本身
// 留在 `components/Schedule/ScheduleNotice.jsx`，這裡只放資料轉換）。

// 把排課回應整理成畫面上要顯示的提示。成功但有警告時也要顯示，
// 否則「學分不足」「偏好未滿足」這類訊息同樣會消失。
// notice 的渲染會無條件讀 `warnings` / `unscheduled` / `excluded` 的 `.length`，
// 少任何一個都會讓整個畫面白畫面。**錯誤路徑正是最容易漏欄位的地方**
// ——也就是最需要顯示訊息的時候反而整頁掛掉。一律經過這裡補齊。
export function makeNotice({ level, message, warnings = [], excluded = [], unscheduled = [] }) {
  return { level, message, warnings, excluded, unscheduled };
}

export function buildScheduleNotice(data) {
  const excluded = data.excludedCourses || [];
  // 尚未排定時間的課程有學分卻不會出現在課表格上，必須讓使用者看得到。
  const unscheduled = data.unscheduledCourses || [];
  const message = data.message || '無法產生符合限制的課表。';
  // 排課失敗時後端會把 warnings[0] 當作 message，直接全部渲染會重複一次。
  const warnings = (data.warnings || []).filter(warning => warning !== message);

  if (!data.success) {
    return makeNotice({ level: 'error', message, warnings, excluded, unscheduled });
  }

  // 成功排出課表不代表所有候選課都被採用。已修課程會由 A3 主動放進
  // excludedCourses；若這裡只看 warnings／時間未定課程，排除原因仍會在畫面上
  // 靜默消失，使用者無法知道候選池為何少了那些課。
  if (data.watchOnly || warnings.length > 0 || excluded.length > 0 || unscheduled.length > 0) {
    return makeNotice({ level: 'warning', message, warnings, excluded, unscheduled });
  }

  return null;
}

// roadmap #27：切換方案後，提示要換成**選中方案自己的**排除原因與時間未定
// 課程，不是繼續顯示前一個方案的。`message`（「已產生 N 個課表方案，預設採用
// 「X」...」）沿用原本那句——它講的是整次排課的事實（產生了幾個方案），
// 切換方案不會改變這件事；重新組一句「現在改採用 Y」需要複製後端
// `selectionReason` 的組句邏輯，屬於裝飾性文字，不是本次要解決的問題。
export function buildScheduleNoticeForPlan(data, plan) {
  if (!plan) return buildScheduleNotice(data);
  return buildScheduleNotice({
    success: data.success,
    message: data.message,
    watchOnly: plan.watchOnly,
    warnings: plan.warnings,
    excludedCourses: plan.excludedCourses,
    unscheduledCourses: plan.unscheduledCourses,
  });
}
