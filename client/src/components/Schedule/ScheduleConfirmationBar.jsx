import { X } from 'lucide-react';
import { describeAcceptOutcome } from '../../services/interactionLog';

// Roadmap #2：排課後的確認列。排課只是推薦，使用者是否覺得符合需求才是最終選擇。
function adjustHint(personalizationEnabled) {
  return personalizationEnabled
    ? '請點選課表上不適合的課，選擇移除原因——這樣系統才分得出「排不進去」和「你不喜歡」。'
    : '請點選課表上不適合的課並移除。你尚未開啟「從互動持續改善個人化」，移除原因不會被記錄。';
}

export default function ScheduleConfirmationBar({
  confirmation,
  personalizationEnabled,
  onConfirmFit,
  onRequestAdjust,
  onDismiss,
}) {
  if (!confirmation) return null;

  return (
    <div className="schedule-confirmation" id="schedule-confirmation">
      {confirmation.state === 'pending' && (
        <>
          <span>這份課表符合你的需求嗎？</span>
          <div className="schedule-confirmation-actions">
            <button className="action-btn primary" id="confirm-schedule-fit" onClick={onConfirmFit}>
              符合
            </button>
            <button
              className="action-btn secondary"
              id="confirm-schedule-adjust"
              onClick={onRequestAdjust}
            >
              需要調整
            </button>
          </div>
        </>
      )}
      {confirmation.state === 'accepted' && (
        <span id="confirm-schedule-result">{describeAcceptOutcome(confirmation.outcome)}</span>
      )}
      {confirmation.state === 'adjusting' && <span>{adjustHint(personalizationEnabled)}</span>}
      <button className="schedule-notice-close" onClick={onDismiss} aria-label="關閉確認">
        <X size={14} />
      </button>
    </div>
  );
}
