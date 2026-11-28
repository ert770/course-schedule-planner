// Agent 對話框的範例（2026-11-27）。點了只填進輸入框，使用者可以修改後自己送出。
// `{course}`、`{other}` 會換成目前課表上的課名；課表是空的時用通用課名。
// 「排課偏好」刻意放左側勾選沒有的條件，讓使用者知道能調整的不只那幾項。

export const FEATURED_EXAMPLES = [
  '幫我排一份不要早八的課表',
  '週三下午要打工，幫我重排',
  '把「{course}」換成一門星期一的通識課',
];

export const EXAMPLE_GROUPS = [
  {
    title: '排課偏好',
    items: [
      '每天最多上 2 門課',
      '這學期最多 18 學分',
      '星期二上午有空比較好',
      '晚上不要排課',
      '我只想上王小明老師的課',
      '每門課 3 學分',
    ],
  },
  {
    title: '課程查詢',
    items: [
      '星期一有哪些通識課？',
      '有哪些全英授課的課？',
      '「{course}」這門課在學什麼？',
      '有什麼比較輕鬆的通識課？',
    ],
  },
  {
    title: '換課與調整課表',
    items: [
      '把「{course}」換成一門星期一的通識課',
      '幫我移除「{other}」',
      '鎖定「{course}」，其他重排',
      '把「{other}」加入關注',
    ],
  },
  {
    title: '課程主題',
    items: [
      '我對區塊鏈有興趣，以後多排一點',
      '我不想再排生成式 AI 的課了',
      '系統覺得我對什麼有興趣？',
    ],
  },
  {
    title: '推薦原因',
    items: [
      '為什麼推薦「{course}」？',
    ],
  },
];

// 以目前課表的課名填入範例。
export function fillExample(text, schedule = []) {
  const names = [...new Set(schedule.map(course => course?.name).filter(Boolean))];
  const course = names[0] ?? '資料結構';
  const other = names[1] ?? course;
  return text.replaceAll('{course}', course).replaceAll('{other}', other);
}
