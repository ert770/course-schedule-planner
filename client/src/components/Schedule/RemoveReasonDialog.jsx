import { REMOVAL_REASONS } from '../../services/interactionLog';

// Roadmap #2：移除課程時詢問原因。
//
// 為什麼要問：`time`（衝堂）、`full`（額滿）、`eligibility`（不符資格）對「課程
// 內容偏好」是**中性**訊號，只有 `content`／`workload`／`instructor` 才是真正的
// 負回饋。不問就無從區分，#30 會把「排不進去」學成「不喜歡」。
//
// 「略過」送出的是 null，不是猜一個值——沒說就是沒說。
export default function RemoveReasonDialog({ course, onCancel, onConfirm }) {
  if (!course) return null;

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div
        className="modal-content remove-reason-dialog"
        onClick={event => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="remove-reason-title"
      >
        <button className="modal-close" onClick={onCancel} aria-label="取消移除">✕</button>
        <h2 id="remove-reason-title" style={{ fontSize: '1.15rem', marginBottom: '4px' }}>
          移除「{course.name}」
        </h2>
        <p className="remove-reason-hint">
          告訴我們原因，之後的推薦才不會把「排不進去」當成「你不喜歡」。
        </p>

        <div className="remove-reason-options">
          {REMOVAL_REASONS.map(reason => (
            <button
              key={reason.value}
              type="button"
              className="remove-reason-option"
              id={`remove-reason-${reason.value}`}
              onClick={() => onConfirm(reason.value)}
            >
              {reason.label}
            </button>
          ))}
        </div>

        <div className="remove-reason-actions">
          <button
            type="button"
            className="action-btn secondary"
            id="remove-reason-skip"
            onClick={() => onConfirm(null)}
          >
            略過，直接移除
          </button>
          <button type="button" className="action-btn secondary" onClick={onCancel}>
            取消
          </button>
        </div>
      </div>
    </div>
  );
}
