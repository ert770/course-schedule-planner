// 節次與實際時間的對照。
//
// 與 client/src/components/Schedule/ScheduleGrid.jsx 的 PERIODS 一致。
// 後端需要這份對照是因為 `User_Profiles.avoid_time` 存的是時間字串（例如 `08:00`），
// 而排課引擎的封鎖時段用的是 `{ day, period }`。

export const PERIODS_PER_DAY = 14;
export const DAYS_PER_WEEK = 7;

export const PERIOD_TIMES = [
  { period: 1, start: '08:10', end: '09:00' },
  { period: 2, start: '09:10', end: '10:00' },
  { period: 3, start: '10:10', end: '11:00' },
  { period: 4, start: '11:10', end: '12:00' },
  { period: 5, start: '12:10', end: '13:00' },
  { period: 6, start: '13:10', end: '14:00' },
  { period: 7, start: '14:10', end: '15:00' },
  { period: 8, start: '15:10', end: '16:00' },
  { period: 9, start: '16:10', end: '17:00' },
  { period: 10, start: '17:10', end: '18:00' },
  { period: 11, start: '18:30', end: '19:20' },
  { period: 12, start: '19:25', end: '20:15' },
  { period: 13, start: '20:25', end: '21:15' },
  { period: 14, start: '21:20', end: '22:10' },
];

export function toMinutes(time) {
  const match = String(time || '').trim().match(/^(\d{1,2})\s*[:：]\s*(\d{2})$/);
  if (!match) return null;

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;

  return hours * 60 + minutes;
}

// 找出涵蓋該時間的節次。
//
// 規則為「第一個尚未結束的節次」：
//   08:00 -> 第 1 節（08:10 開始，使用者說「避開八點」指的是早八）
//   09:30 -> 第 2 節（落在 09:10-10:00 之內）
//   13:05 -> 第 6 節（第 5 節 13:00 已結束，取下一節）
// 超出最後一節結束時間則回傳 null。
export function findPeriodByTime(time) {
  const target = toMinutes(time);
  if (target === null) return null;

  const found = PERIOD_TIMES.find(entry => toMinutes(entry.end) >= target);
  return found ? found.period : null;
}

// 把各種來源的封鎖時段統一成排課引擎認得的 `{ day, period }`。
//
// 兩種已知格式：
//   1. `User_Profiles.avoid_time` 匯入的時間字串，例如 ["08:00"]
//   2. 本系統寫回或前端送出的物件，例如 [{ day: 1, period: 3 }]
//
// 時間字串沒有星期資訊，因此視為「每天的該節次都要避開」。
// 無法解析的項目會被丟棄，並透過 onInvalid 回報，不得靜默忽略。
export function normalizeBlockedPeriods(value, onInvalid) {
  if (!Array.isArray(value)) {
    return [];
  }

  const blocked = [];
  const seen = new Set();
  const add = (day, period) => {
    const key = `${day}-${period}`;
    if (seen.has(key)) return;
    seen.add(key);
    blocked.push({ day, period });
  };

  for (const entry of value) {
    if (entry && typeof entry === 'object') {
      const day = Number(entry.day ?? entry.dayOfWeek);
      const period = Number(entry.period ?? entry.startPeriod);
      const valid = Number.isInteger(day) && Number.isInteger(period)
        && day >= 1 && day <= DAYS_PER_WEEK
        && period >= 1 && period <= PERIODS_PER_DAY;

      if (valid) add(day, period);
      else onInvalid?.(entry);
      continue;
    }

    const period = findPeriodByTime(entry);
    if (period === null) {
      onInvalid?.(entry);
      continue;
    }

    for (let day = 1; day <= DAYS_PER_WEEK; day += 1) {
      add(day, period);
    }
  }

  return blocked;
}

export default {
  PERIODS_PER_DAY,
  DAYS_PER_WEEK,
  PERIOD_TIMES,
  toMinutes,
  findPeriodByTime,
  normalizeBlockedPeriods,
};
