import { CREDIT_MAX, OVERLOAD_CREDIT_MAX, validateCreditRange } from '../../utils/creditRange';

// 每個欄位同時可以直接輸入數字，或從右邊的下拉選單挑。
function CreditField({ id, label, value, floor, ceiling, onChange, disabled }) {
  const options = Array.from({ length: ceiling - floor + 1 }, (_, index) => String(floor + index));
  return (
    <div className="credit-field">
      <label htmlFor={id}>{label}</label>
      <div className="credit-field-controls">
        <input id={id} type="text" inputMode="numeric" value={value} disabled={disabled}
          onChange={event => onChange(event.target.value.replace(/[^\d]/g, '').slice(0, 2))} />
        <select aria-label={`${label}下拉選單`} value={options.includes(value) ? value : ''} disabled={disabled}
          onChange={event => onChange(event.target.value)}>
          <option value="" disabled>選擇</option>
          {options.map(option => <option key={option} value={option}>{option}</option>)}
        </select>
      </div>
    </div>
  );
}

export default function CreditRangeInput({ idPrefix = 'credit', value, floor, onChange, disabled = false }) {
  const ceiling = value.overload ? OVERLOAD_CREDIT_MAX : CREDIT_MAX;
  const error = validateCreditRange(value, floor);
  return (
    <div className="credit-range">
      <div className="credit-range-fields">
        <CreditField id={`${idPrefix}-min`} label="最低學分" value={value.min} floor={floor} ceiling={ceiling}
          disabled={disabled} onChange={min => onChange({ ...value, min })} />
        <CreditField id={`${idPrefix}-max`} label="最高學分" value={value.max} floor={floor} ceiling={ceiling}
          disabled={disabled} onChange={max => onChange({ ...value, max })} />
      </div>
      <label className="credit-overload">
        <input type="checkbox" checked={value.overload} disabled={disabled}
          onChange={event => onChange({ ...value, overload: event.target.checked })} />
        我已申請超修（最高可到 {OVERLOAD_CREDIT_MAX} 學分）
      </label>
      {error
        ? <p className="credit-range-error" role="alert">{error}</p>
        : <p className="credit-range-hint">最低 {floor} 學分；系統會以最高學分為目標排課。</p>}
    </div>
  );
}
