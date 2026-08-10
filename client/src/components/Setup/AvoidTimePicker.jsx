import { DAYS, PERIODS, MORNING_PERIOD, periodKey } from '../../constants/periods';

// 避開時段選擇器。
//
// 對應 `User_Profiles.avoid_time`。先前這個欄位**只有資料庫有值、前端沒有任何
// 介面可以設定**，使用者無從得知也無法修改——實測資料裡那筆 `["08:00"]`
// 就是這樣留下來的。
//
// 決策 C：第 1 節（早八）由 `#不排早八` 標籤控制，這裡只收第 2～14 節。
// 第 1 節仍然畫出來但停用並標註原因，否則使用者會以為格子壞了。
export default function AvoidTimePicker({ value = [], onChange }) {
  const selected = new Set(value.map(item => periodKey(item.day, item.period)));

  const toggle = (day, period) => {
    if (period === MORNING_PERIOD) return;

    const key = periodKey(day, period);
    const next = selected.has(key)
      ? value.filter(item => periodKey(item.day, item.period) !== key)
      : [...value, { day, period }];

    onChange(next);
  };

  return (
    <div className="avoid-time-picker" id="avoid-time-picker">
      <p className="avoid-time-hint">
        點選要避開的時段。第 1 節（早八）請用上方的
        <strong>「#不排早八」</strong>設定。
      </p>

      <div className="avoid-time-scroll">
        <table className="avoid-time-table">
          <thead>
            <tr>
              <th className="avoid-time-period-head">節次</th>
              {DAYS.map(day => <th key={day.value}>{day.label}</th>)}
            </tr>
          </thead>
          <tbody>
            {PERIODS.map(period => {
              const isMorning = period.num === MORNING_PERIOD;
              return (
                <tr key={period.num} className={isMorning ? 'avoid-time-row-disabled' : ''}>
                  <th className="avoid-time-period-head">
                    <span className="avoid-time-period-num">{period.num}</span>
                    <span className="avoid-time-period-clock">{period.start}</span>
                  </th>
                  {DAYS.map(day => {
                    const key = periodKey(day.value, period.num);
                    const isSelected = selected.has(key);
                    return (
                      <td key={key}>
                        <button
                          type="button"
                          className={`avoid-time-cell${isSelected ? ' selected' : ''}`}
                          onClick={() => toggle(day.value, period.num)}
                          disabled={isMorning}
                          aria-pressed={isSelected}
                          aria-label={
                            isMorning
                              ? `${day.label} 第 ${period.num} 節：由 #不排早八 控制`
                              : `${day.label} 第 ${period.num} 節`
                          }
                          title={isMorning ? '早八由「#不排早八」偏好控制' : undefined}
                        >
                          {isSelected ? '✕' : ''}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="avoid-time-summary">
        已避開 {value.length} 個時段。
      </p>
    </div>
  );
}
