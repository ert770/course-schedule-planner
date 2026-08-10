// 節次與星期的共用常數。
//
// 這份對照原本各自寫在 `components/Schedule/ScheduleGrid.jsx` 與後端的
// `server/src/utils/periods.js`。再加一份時段選擇器就會變成三份，
// 而三份各自維護的常數必然有一天對不上——因此在前端統一到這裡。
//
// 後端那份是排課引擎的真相來源（`avoid_time` 的時間字串要換算成節次），
// 兩邊的數值必須一致；修改時請同步。

export const DAYS = [
  { value: 1, label: '星期一' },
  { value: 2, label: '星期二' },
  { value: 3, label: '星期三' },
  { value: 4, label: '星期四' },
  { value: 5, label: '星期五' },
  { value: 6, label: '星期六' },
  { value: 7, label: '星期日' },
];

export const PERIODS = [
  { num: 1, start: '08:10', end: '09:00' },
  { num: 2, start: '09:10', end: '10:00' },
  { num: 3, start: '10:10', end: '11:00' },
  { num: 4, start: '11:10', end: '12:00' },
  { num: 5, start: '12:10', end: '13:00' },
  { num: 6, start: '13:10', end: '14:00' },
  { num: 7, start: '14:10', end: '15:00' },
  { num: 8, start: '15:10', end: '16:00' },
  { num: 9, start: '16:10', end: '17:00' },
  { num: 10, start: '17:10', end: '18:00' },
  { num: 11, start: '18:30', end: '19:20' },
  { num: 12, start: '19:25', end: '20:15' },
  { num: 13, start: '20:25', end: '21:15' },
  { num: 14, start: '21:20', end: '22:10' },
];

// 決策 C：第 1 節（早八）由 `#不排早八` 標籤控制，避開時段只管第 2～14 節。
// 同一個限制若能從兩個地方設定，兩邊必然漂移——實測就出現過
// MySQL `avoid_time: ["08:00"]` 與 `noMorningClasses: false` 互相矛盾。
export const MORNING_PERIOD = 1;

export const SELECTABLE_PERIODS = PERIODS.filter(period => period.num !== MORNING_PERIOD);

export function periodKey(day, period) {
  return `${day}-${period}`;
}

export default { DAYS, PERIODS, MORNING_PERIOD, SELECTABLE_PERIODS, periodKey };
