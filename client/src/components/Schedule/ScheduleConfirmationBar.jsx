import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { describeAcceptOutcome } from '../../services/interactionLog';

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
  isFading,
}) {
  // 控制淡出動畫的 local state
  const [fadingOut, setFadingOut] = useState(false);

  // 當狀態變為 accepted (使用者點了「符合」) 時，啟動 5 秒倒數
  useEffect(() => {
    if (confirmation?.state === 'accepted') {
      const timer = setTimeout(() => {
        setFadingOut(true); // 開始觸發 CSS 淡出動畫 (如果有寫的話)
        // 動畫結束後徹底移除
        setTimeout(() => {
          onDismiss();
          setFadingOut(false);
        }, 300); // 緩衝 300ms 讓透明度過渡
      }, 5000); // 5 秒後執行

      return () => clearTimeout(timer); // 清除計時器，避免記憶體洩漏
    }
  }, [confirmation, onDismiss]);

  if (!confirmation) return null;

  return (
    <div 
      className={`schedule-confirmation ${isFading || fadingOut ? 'fade-out' : ''}`} 
      id="schedule-confirmation"
      style={{
        opacity: fadingOut ? 0 : 1,
        transition: 'opacity 0.3s ease-out'
      }}
    >
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