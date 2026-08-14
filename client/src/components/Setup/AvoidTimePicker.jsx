import { DAYS, PERIODS, periodKey } from '../../constants/periods';

// 避開時段選擇器。
//
// 對應 `User_Profiles.avoid_time`。先前這個欄位**只有資料庫有值、前端沒有任何
// 介面可以設定**，使用者無從得知也無法修改——實測資料裡那筆 `["08:00"]`
// 就是這樣留下來的。
//
// **第 1～14 節都可以選。** 曾經一度把第 1 節停用、要求改用「#不排早八」標籤，
// 但那兩者不是同一件事：標籤是「每天第一節都不要」，這裡是「這個星期幾的
// 這一節不要」。停用第 1 節等於讓使用者無法只避開星期三的早八。
// 兩者可以同時設定，排課時取聯集。
export default function AvoidTimePicker({ value = [], onChange }) {
  const selected = new Set(value.map(item => periodKey(item.day, item.period)));

  const toggle = (day, period) => {
    const key = periodKey(day, period);
    const next = selected.has(key)
      ? value.filter(item => periodKey(item.day, item.period) !== key)
      : [...value, { day, period }];

    onChange(next);
  };

  return (
    <div className="avoid-time-picker" id="avoid-time-picker">
      <p className="avoid-time-hint">
        點選要避開的時段。想避開<strong>每天</strong>的第 1 節，
        用上方的<strong>「#不排早八」</strong>比較快。
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
            {PERIODS.map(period => (
              <tr key={period.num}>
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
                        aria-pressed={isSelected}
                        aria-label={`${day.label} 第 ${period.num} 節`}
                      >
                        {isSelected ? '✕' : ''}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="avoid-time-summary">
        已避開 {value.length} 個時段。
      </p>
    </div>
  );
}
