import { useState } from 'react';
import CreditRangeInput from './CreditRangeInput';
import { creditRangeFromProfile, creditRangePayload, validateCreditRange } from '../../utils/creditRange';

// 首頁學分標籤：顯示目前課表學分與目標範圍，點開可改；儲存後由首頁重新排課。
export default function CreditEditor({ totalCredits, profile, disabled, onSave }) {
  const [draft, setDraft] = useState(null);
  const range = profile ? creditRangeFromProfile(profile) : null;
  const label = `🎓 ${totalCredits} 學分`;
  if (!range) return <span className="stat-badge credit-badge">{label}</span>;

  const open = draft !== null;
  const error = open && validateCreditRange(draft, range.floor);
  const save = async () => {
    const payload = creditRangePayload(draft);
    setDraft(null);
    await onSave(payload);
  };

  return (
    <span className="credit-edit">
      <button type="button" className="stat-badge credit-badge credit-edit-button" aria-expanded={open}
        disabled={disabled} title="修改目標學分" onClick={() => setDraft(open ? null : range.value)}>
        {label}｜目標 {range.value.min}～{range.value.max} ✎
      </button>
      {open && (
        <div className="credit-popover" role="dialog" aria-label="修改目標學分">
          <CreditRangeInput idPrefix="dashboard-credit" value={draft} floor={range.floor} onChange={setDraft} />
          <div className="credit-popover-actions">
            <button type="button" className="action-btn secondary" onClick={() => setDraft(null)}>取消</button>
            <button type="button" className="action-btn primary" disabled={Boolean(error) || disabled} onClick={save}>
              儲存並重排
            </button>
          </div>
        </div>
      )}
    </span>
  );
}
