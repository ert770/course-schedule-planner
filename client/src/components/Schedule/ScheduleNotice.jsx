import { AlertTriangle, X } from 'lucide-react';

// 排課提示（roadmap #27 從 DashboardPage 抽出，同時補上 SchedulePage 原本
// 漏讀的 excludedCourses／unscheduledCourses）。
//
// **抽成共用元件的理由**：DashboardPage 原本用 `buildScheduleNotice()` 完整渲染
// warnings／excluded／unscheduled，SchedulePage 只就地寫了 `{ level, text,
// details }`，excludedCourses 與 unscheduledCourses 完全沒讀——排除原因會在
// SchedulePage 上靜默消失。roadmap #27 要讓兩頁都能切換方案，方案切換後跟著
// 出現的排除原因也該一致，先收斂這段，否則是第三個漂移點（第一個是 #26 抽出
// 的 CourseDetailModal）。
//
// 資料轉換（`buildScheduleNotice()`／`buildScheduleNoticeForPlan()`）在
// `utils/scheduleNotice.js`，這裡只放渲染——純函式與元件混在同一個檔案會讓
// Vite fast refresh 失效。

const MAX_EXCLUDED_SHOWN = 5;

export default function ScheduleNotice({ notice, onDismiss, domId }) {
  if (!notice) return null;

  return (
    <div className={`schedule-notice ${notice.level}`} id={domId}>
      <div className="schedule-notice-head">
        <AlertTriangle size={16} />
        <span>{notice.message}</span>
        <button
          className="schedule-notice-close"
          onClick={onDismiss}
          aria-label="關閉提示"
        >
          <X size={14} />
        </button>
      </div>

      {notice.warnings.length > 0 && (
        <ul className="schedule-notice-list">
          {notice.warnings.map((warning, i) => (
            <li key={i}>{warning}</li>
          ))}
        </ul>
      )}

      {notice.unscheduled.length > 0 && (
        <details className="schedule-notice-excluded">
          <summary>
            有 {notice.unscheduled.length} 門課時間未定，查看清單
          </summary>
          <ul className="schedule-notice-list">
            {notice.unscheduled.slice(0, MAX_EXCLUDED_SHOWN).map((course, i) => (
              <li key={i}>
                <strong>{course.name}</strong>（{course.credits} 學分）
                {course.department ? `｜${course.department}` : ''}
              </li>
            ))}
            {notice.unscheduled.length > MAX_EXCLUDED_SHOWN && (
              <li>其餘 {notice.unscheduled.length - MAX_EXCLUDED_SHOWN} 門未列出。</li>
            )}
          </ul>
        </details>
      )}

      {notice.excluded.length > 0 && (
        <details className="schedule-notice-excluded">
          <summary>
            有 {notice.excluded.length} 門課未被排入，查看原因
          </summary>
          <ul className="schedule-notice-list">
            {notice.excluded.slice(0, MAX_EXCLUDED_SHOWN).map((item, i) => (
              <li key={i}>
                <strong>{item.course?.name || '未知課程'}</strong>：{item.reason}
              </li>
            ))}
            {notice.excluded.length > MAX_EXCLUDED_SHOWN && (
              <li>其餘 {notice.excluded.length - MAX_EXCLUDED_SHOWN} 門未列出。</li>
            )}
          </ul>
        </details>
      )}
    </div>
  );
}
