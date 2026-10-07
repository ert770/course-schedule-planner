// Roadmap #10 任務 3B：Persona 模擬選擇用的情境與提示。
//
// **純資料與純函式，不碰 MySQL、不呼叫模型。**
//
// 同一位 Persona 在同一學期用同樣條件重排，會得到一模一樣的方案。要有多道不同的
// 比較題，只能改變「這一次排課的條件」——也就是真實使用者每次排課前會調整的那些設定。

import { makeRandom } from './choiceEvaluation.js';

export const SIMULATION_PROMPT_VERSION = 'persona-choice-v4';

// 測試人物的學號。subject 用學號是為了與 `personaConsentSeed.js` 的身分一致。
export const SIMULATION_PERSONAS = Object.freeze(
  Array.from({ length: 10 }, (_, index) => ({
    userId: 9001 + index,
    studentId: `D000${9001 + index}`,
  }))
);

const CREDIT_OFFSETS = Object.freeze([0, -3, -6]);
const INTEREST_SETS = Object.freeze([
  [],
  ['人工智慧', '機器學習'],
  ['網路', '資訊安全'],
  ['軟體工程', 'Web'],
  ['資料庫', '資料科學'],
  ['嵌入式', '硬體'],
  ['影像處理', '多媒體'],
  ['作業系統', '系統程式'],
  ['演算法', '數學'],
  ['遊戲', '互動設計'],
  ['雲端', '物聯網'],
  ['英文', '語言'],
  ['管理', '金融'],
]);
const TIME_OPTIONS = Object.freeze([
  { id: 'none', input: {}, text: null },
  { id: 'no-morning', input: { noMorningClasses: true }, text: '這次不想排第 1 節（08:10）的課' },
  { id: 'no-evening', input: { noEveningClasses: true }, text: '這次不想排晚上的課（第 12 節以後）' },
  { id: 'max3', input: { maxCoursesPerDay: 3 }, text: '這次希望每天最多三門課' },
  { id: 'max4', input: { maxCoursesPerDay: 4 }, text: '這次希望每天最多四門課' },
  { id: 'monday-free', input: { mondayFree: true }, text: '這次希望星期一不要排課' },
  { id: 'lunch-free', input: { lunchBreakFree: true }, text: '這次希望中午（第 5 節）留空' },
]);

const MIN_SCENARIO_CREDITS = 9;

// 依固定種子打亂。用於情境順序（避免 test 段落剛好全是同一類情境）與方案呈現順序
// （降低模型偏好第一個選項的影響）。
export function shuffled(list, seed) {
  const random = makeRandom(seed);
  const copy = [...list];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    [copy[index], copy[swap]] = [copy[swap], copy[index]];
  }
  return copy;
}

// 一位 Persona 的全部候選情境（最多 3 × 13 × 7 = 273 個），順序已依學號種子打亂。
// 多數情境排不出兩個以上方案或與先前的題目重複，所以候選數要遠多於需要的題數。
export function buildScenarios(prefs, { seed }) {
  const baseMax = Number(prefs?.targetCreditsMax) || 25;
  const scenarios = [];
  for (const offset of CREDIT_OFFSETS) {
    const maxCredits = baseMax + offset;
    if (offset !== 0 && maxCredits < MIN_SCENARIO_CREDITS) continue;
    for (const interests of INTEREST_SETS) {
      for (const time of TIME_OPTIONS) {
        const input = { ...time.input };
        const notes = [];
        if (offset !== 0) {
          input.maxCredits = maxCredits;
          notes.push(`這次想把學分控制在 ${maxCredits} 學分以內`);
        }
        if (interests.length > 0) {
          input.interests = interests;
          notes.push(`最近對「${interests.join('、')}」有興趣`);
        }
        if (time.text) notes.push(time.text);
        scenarios.push({
          scenarioId: `c${offset}|i${INTEREST_SETS.indexOf(interests)}|t${time.id}`,
          input,
          notes,
        });
      }
    }
  }
  return shuffled(scenarios, seed);
}

// 偏好標籤轉成一般學生會講的話。只描述使用者自己勾過的偏好，不加任何系統內部的說法。
const TAG_TEXT = Object.freeze({
  '#不排早八': '不想上第 1 節（08:10）的課',
  '#涼課優先': '希望課業負擔輕、容易過',
  '#挑戰難課': '想修紮實、有挑戰性的課，不怕負擔重',
  '#學到許多知識': '重視能不能學到東西',
  '#無分組報告': '不喜歡分組報告',
  '#全英授課': '想修全英語授課的課',
  '#盡量集中排課': '希望課集中在少數幾天，不要每天都跑學校',
  '#星期一排空': '希望星期一完全沒課',
  '#午休務必空出': '中午（第 5 節）一定要留時間吃飯休息',
  '#無期中考': '不喜歡有期中考的課',
  '#上機實作考試': '偏好上機實作的考試方式',
  '#平時成績佔比高': '偏好平時成績佔比高的課',
  '#期末報告為主': '偏好以期末報告評分的課',
  '#高度課堂討論': '喜歡課堂討論多的課',
  '#不點名': '偏好不點名的課',
});

const DAY_TEXT = ['', '一', '二', '三', '四', '五', '六', '日'];

// 組員撰寫的 Persona 人物設定（2026-10 的〈Persona UX〉十張人物卡），逐項抄錄：
// 類型、家庭背景、信仰、個性、選課的行為動機。年級、班級、偏好標籤、學分上限、
// 避開的教師與被當的課不寫在這裡——那些以資料庫主檔為準，避免兩邊各說各話。
export const PERSONA_SETTINGS = Object.freeze({
  9001: {
    type: '探索試水型',
    background: '生長在公務員雙薪家庭，家境小康。父母管教開明但重視學業底線（交代至少不能被當或被二一），沒有經濟負擔。',
    belief: '民間信仰，沒有特定信仰（逢年過節隨長輩拜拜）。',
    personality: '謹慎慢熟、循規蹈矩、偏內向。剛進入新環境容易焦慮，不喜歡冒險或成為眾人焦點。',
    motivation: '害怕第一學期就踩雷翻車，因此不敢跨選高年級課；通識刻意挑選以個人筆試或心得為主的課程，避開陌生分組以減少社交壓力。',
  },
  9002: {
    type: '硬核升學卷王型',
    background: '父母皆為科技業工程師，家庭高度重視學術表現與邏輯訓練。從小耳濡目染，家庭提供充裕的學習資源與競賽支持。',
    belief: '無神論。',
    personality: '目標導向、爭強好勝、完美主義、極度理性。對專業領域有高度求知欲，重視效率而顯得略微嚴肅。',
    motivation: '以推甄頂大資工所為唯一目標；完全不在意早八、衝堂或高作業量，只鎖定教授要求嚴苛、含金量高的硬核課程與全英文授課。',
  },
  9003: {
    type: '極致打工通勤型',
    background: '單親家庭，母親經營小吃攤。身為長女，需自籌學費與每月生活費，並分擔弟妹開銷；每日從彰化通勤至台中就讀。',
    belief: '道教、台灣民間信仰（初一十五拜土地公，祈求家裡生意興隆、平安順利）。',
    personality: '務實獨立、堅毅耐勞、時間觀念極強。凡事講求效益與精確排程，不浪費時間在無意義的社交上。',
    motivation: '為配合晚間與特定平日的兼職排班，課表排得極度緊湊，追求「空堂最少、天數最少」，堅決不選早八或零碎分散的課堂。',
  },
  9004: {
    type: '壓線畢業求過型',
    background: '南部傳統藍領家庭，父母從事營造與水電工程。家人對資訊工程專業不太了解，只期盼他順利拿到大學文憑回家或就業。',
    belief: '民間信仰（大考或遇到危機時會去拜文昌帝君、關聖帝君）。',
    personality: '隨和樂天、拖延症嚴重、抗壓性偏低但為人講義氣。平常得過且過，直到大四面臨延畢危機才開始緊張。',
    motivation: '身上背負多門低年級必修被當的重擔；選課完全以「能及格拿到學分」為第一原則，鎖定點名給分、不考期中期末的低負擔課程。',
  },
  9005: {
    type: '軟體就業導向型',
    background: '家庭從商，父母經營中小型批發商。家境中等，父母鼓勵他早點進入社會累積實戰經驗，不強求升學。',
    belief: '無特定信仰。',
    personality: '務實行動派、動手能力強、外向。對紙筆考試和抽象數學沒耐性，但對能動手寫出作品、架設網站充滿熱情。',
    motivation: '不打算考研，目標畢業直接投履歷；主動尋求需要做出期末完整專案、分組 Demo 的實務導向選修，藉此累積個人的 GitHub 作品集。',
  },
  9006: {
    type: '社交活躍幹部型',
    background: '中產文教家庭，父母皆為中小學教師。成長環境鼓勵多元探索、多參與課外活動與人際交往。',
    belief: '基督教（每週日有固定的主日崇拜與青年團契聚會）。',
    personality: '開朗健談、領導力強、擅長溝通協調、重視團體氛圍。喜歡在人群中發揮影響力，但討厭枯燥重複的個人作業。',
    motivation: '因擔任社團與系學會重要幹部，偏好通識中重視小組簡報、議題思辨的課程；偏好彈性出席、不常點名的課，以便公假處理活動。',
  },
  9007: {
    type: '已錄取提早躺平型',
    background: '高社經家庭，父親為開業醫師，母親為外商主管。從小資源優渥，已在大四上順利推甄錄取研究所。',
    belief: '無神論。',
    personality: '從容悠哉、隨性安逸、重視生活品質。目前處於人生難得的空白期，只希望能好好享受最後的大學校園時光。',
    motivation: '畢業學分已修畢 95%，僅需達到四年級每學期 9 學分的最低門檻；堅決不排任何需燒腦寫程式的課，只挑體育、電影賞析、藝術體驗等極致涼課。',
  },
  9008: {
    type: '跨領域商管修程型',
    background: '父親從事金融投資，母親為企業人資主管。家庭常在餐桌上討論市場趨勢與商業模式，具備強烈的商業思維。',
    belief: '佛教（家庭受祖父母影響，注重心性平和、行善積德）。',
    personality: '思維敏捷、擅長跨界思考、兼具邏輯分析與商業直覺。勇於跳脫純技術圈，善於團隊合作與公開發言。',
    motivation: '修讀金融科技微學程，排課需在資工系核心必修與商學院專業選修（如投資學、行銷管理）之間取得平衡，高度仰賴衝堂檢查與正課實習綁定機制。',
  },
  9009: {
    type: '極度自律避坑型',
    background: '軍公教家庭，父親為退休軍官，母親為圖書館員。家庭生活規律、重視秩序、誠信與規矩。',
    belief: '無特定信仰。',
    personality: '嚴謹守時、一絲不苟、討厭混亂與不確定性。對資訊透明度有極高要求，無法忍受原則模糊、給分隨興的老師。',
    motivation: '極度依賴學長姐評價與客觀指標；堅決排除給分標準不明確或爭議大的教師，偏好評量配分完全透明、大綱寫得清清楚楚的穩定班次。',
  },
  9010: {
    type: '專題重修邊緣人',
    background: '勞工家庭，父母靠勞力打零工維持家計。因大學求學過程不順利而延畢，背負學貸壓力，亟需打工維持生計。',
    belief: '民間信仰，隨緣拜拜。',
    personality: '孤僻寡言、低調壓抑、防衛心較重。由於延畢與身邊同儕脫節，極度不願參與校園社交，只想安靜把課修完。',
    motivation: '在校只剩最後 1 門大四必修專題或核心科目未過，排課目標單一且極端；要求非上課時段完全空白，以便排班兼職，堅決避開任何需要平日零碎點名的課程。',
  },
});

export function describePersona(prefs) {
  const setting = PERSONA_SETTINGS[Number(prefs.mysqlUserId ?? prefs.userId ?? prefs.id)];
  const lines = [
    `你是逢甲大學資訊工程學系${['', '一', '二', '三', '四'][prefs.gradeLevel] ?? ''}年級的學生，班級是${prefs.className}。`,
  ];
  if (setting) {
    lines.push(
      `你是「${setting.type}」的學生。`,
      `家庭背景：${setting.background}`,
      `信仰：${setting.belief}`,
      `個性：${setting.personality}`,
      `選課的想法：${setting.motivation}`,
    );
  }
  const tags = (prefs.preferenceTags ?? []).map(tag => TAG_TEXT[tag]).filter(Boolean);
  if (tags.length > 0) lines.push(`你選課時的習慣：${tags.join('；')}。`);
  if (prefs.targetCreditsMax) lines.push(`你一學期最多想修 ${prefs.targetCreditsMax} 學分。`);
  const avoid = prefs.avoidInstructors ?? [];
  if (avoid.length > 0) lines.push(`你不想修這些老師的課：${avoid.join('、')}。`);
  const failed = (prefs.courseHistory ?? []).filter(entry => entry.passed === false);
  if (failed.length > 0) {
    lines.push(`你曾經被當過：${failed.map(entry => entry.courseName).join('、')}。`);
  }
  return lines.join('\n');
}

// 各節的開始時間（分鐘），與首頁課表格子左側顯示的一致；每節 50 分鐘。
const PERIOD_START = Object.freeze([null, 490, 550, 610, 670, 730, 790, 850, 910, 970, 1030, 1110, 1165, 1225, 1280]);
const clock = minutes => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

// 節次旁邊直接寫鐘點。試跑時模型把「週五 11-13節」讀成「上到第 5 節」而判斷它佔用午休；
// 只給節次對照表不夠，每一門課都要看得到實際時間。
function clockRange(startPeriod, endPeriod) {
  const start = PERIOD_START[startPeriod];
  const end = PERIOD_START[endPeriod];
  if (!Number.isFinite(start) || !Number.isFinite(end)) return '';
  return `（${clock(start)}–${clock(end + 50)}）`;
}

function formatTime(course) {
  const blocks = Array.isArray(course.timeBlocks) && course.timeBlocks.length > 0
    ? course.timeBlocks
    : [{ dayOfWeek: course.dayOfWeek, startPeriod: course.startPeriod, endPeriod: course.endPeriod }];
  return blocks
    .filter(block => block.dayOfWeek)
    .map(block => (
      `星期${DAY_TEXT[block.dayOfWeek] ?? block.dayOfWeek} 第${block.startPeriod}–${block.endPeriod}節`
      + clockRange(block.startPeriod, block.endPeriod)
    ))
    .join('、') || '時間未定';
}

function formatRating(course) {
  const evidence = course.reviewEvidence;
  if (!evidence || !Number.isFinite(evidence.avgCoolness)) return '';
  const parts = [`涼度 ${evidence.avgCoolness}`];
  if (Number.isFinite(evidence.avgSweetness)) parts.push(`甜度 ${evidence.avgSweetness}`);
  if (Number.isFinite(evidence.avgWorkload)) parts.push(`負擔 ${evidence.avgWorkload}`);
  return `｜評價（1～5）：${parts.join('、')}`;
}

// 課程詳情頁會顯示的評量方式。值為 null 代表資料庫沒有這門課的大綱資訊，不寫出來。
function formatAssessment(course) {
  const flags = [];
  if (course.hasMidterm === true) flags.push('有期中考');
  if (course.hasMidterm === false) flags.push('無期中考');
  if (course.hasTeamwork === true) flags.push('有分組');
  if (course.hasPresentation === true) flags.push('有報告發表');
  if (course.isEnglishTaught === true) flags.push('全英授課');
  return flags.length > 0 ? `｜${flags.join('、')}` : '';
}

// 課程詳情頁看得到課程說明；提示裡用資料庫整理好的主題關鍵字代替整段說明，
// 讓「這門課跟我最近的興趣有沒有關係」有東西可以判斷。最多五個。
function formatTopics(course) {
  const topics = (Array.isArray(course.ragTag) ? course.ragTag : []).filter(Boolean).slice(0, 5);
  return topics.length > 0 ? `｜主題：${topics.join('、')}` : '';
}

const sectionKey = course => String(course.sectionId ?? course.id);

function sortByTime(courses) {
  return [...courses].sort((left, right) => (
    (left.dayOfWeek ?? 9) - (right.dayOfWeek ?? 9) || (left.startPeriod ?? 99) - (right.startPeriod ?? 99)
  ));
}

function courseLine(course) {
  return `- ${course.name}｜${course.category ?? course.type ?? ''}｜${course.credits} 學分｜`
    + `${formatTime(course)}｜${course.instructor ?? course.teacher ?? '教師未定'}`
    + `${formatAssessment(course)}${formatTopics(course)}${formatRating(course)}`;
}

// 每個方案都排進去的班次。這些課選哪個方案都一樣，不能當成選擇的理由。
export function commonCourses(plans) {
  if (plans.length === 0) return [];
  const [first, ...rest] = plans.map(plan => plan.schedule ?? []);
  const others = rest.map(schedule => new Set(schedule.map(sectionKey)));
  return sortByTime(first.filter(course => others.every(keys => keys.has(sectionKey(course)))));
}

// 一個方案在提示裡的樣子。**只放使用者在課表畫面上看得到的東西**：課名、類別、學分、
// 時間、教師、評量方式、評價分數。不放方案名稱、主軸、系統分數與「主推」標記——那些等於直接
// 把答案的特徵交給模型。
//
// 傳入 `excludeKeys`（所有方案共同的班次）時只列這個方案自己才有的課；學分與上課天數
// 仍以整個方案計算。
export function describePlan(plan, label, { excludeKeys = null } = {}) {
  const all = plan.schedule ?? [];
  const days = new Set(all.flatMap(course => (
    (course.timeBlocks?.length ? course.timeBlocks : [course]).map(block => block.dayOfWeek)
  )).filter(Boolean));
  const shown = sortByTime(excludeKeys ? all.filter(course => !excludeKeys.has(sectionKey(course))) : all);
  // 每天幾門課直接算好給模型。試跑時模型把一天 4 門數成 5 門，並據此做了選擇；
  // 真實使用者看的是課表格子，不需要自己數。
  const perDay = [...days].sort((left, right) => left - right).map(day => {
    const count = all.filter(course => (
      (course.timeBlocks?.length ? course.timeBlocks : [course]).some(block => block.dayOfWeek === day)
    )).length;
    return `週${DAY_TEXT[day] ?? day} ${count} 門`;
  });
  const header = `方案 ${label}（共 ${plan.totalCredits} 學分，${days.size} 天有課：${perDay.join('、')}）`;
  const lines = [excludeKeys ? `${header}——只有這個方案才有的課：` : header];
  for (const course of shown) lines.push(courseLine(course));
  return lines.join('\n');
}

export const PLAN_LABELS = Object.freeze(['A', 'B', 'C', 'D', 'E', 'F']);

// 節次不是鐘點。試跑時模型把「第 11–13 節」當成中午、把「第 9–10 節」當成晚上。
// 早八、午休、晚上的界線與排課引擎一致（`scheduler.js` 的 MORNING_LAST_PERIOD、
// LUNCH_PERIOD、EVENING_FIRST_PERIOD）。
export const PERIOD_LEGEND = '節次對照：第 1 節 08:10（早八）、第 2 節 09:10、第 3 節 10:10、第 4 節 11:10、'
  + '第 5 節 12:10（午休時段）、第 6 節 13:10、第 7 節 14:10、第 8 節 15:10、第 9 節 16:10、第 10 節 17:10、'
  + '第 11 節 18:30、第 12 節 19:25 以後算晚上。';

export function buildChoicePrompt({ prefs, scenario, plans }) {
  const situation = scenario.notes.length > 0
    ? `這一次排課你另外設定了：${scenario.notes.join('；')}。`
    : '這一次排課你沒有另外調整設定。';
  const common = commonCourses(plans);
  const excludeKeys = new Set(common.map(sectionKey));
  return {
    system: [
      '你要扮演一位大學生，從系統排出的幾個課表方案裡選一個你這學期真的會用的。',
      '請完全依照這位學生的處境、個性與選課想法來選，不要替系統著想，也不要因為某個方案排在前面就選它。',
      '方案之間只差在「只有這個方案才有的課」。每個方案都有的課選哪個都一樣，不能拿來當理由。',
      '「這一次排課的設定」是你現在最在意的事：如果你說最近對某個主題有興趣，就要看哪個方案自己才有的課'
        + '（包含通識與外系課）和那個主題比較有關，並把它當成重要的考量；看不出差別時，再依你的處境與習慣決定。',
      '下結論前，先核對你要引用的星期、節次與時間是否和課程資料寫的一致；不要把星期幾當成第幾節。',
      '只回傳 JSON：{"choice":"方案代號","reason":"用一兩句話說明為什麼，要講到方案之間不同的課"}。',
    ].join('\n'),
    user: [
      describePersona(prefs),
      situation,
      '',
      PERIOD_LEGEND,
      '',
      `系統排出 ${plans.length} 個方案。`,
      '',
      ...(common.length > 0
        ? ['每個方案都有的課（選哪個都一樣）：', ...common.map(courseLine), '']
        : []),
      ...plans.map((plan, index) => `${describePlan(plan, PLAN_LABELS[index], { excludeKeys })}\n`),
      '請選一個。',
    ].join('\n'),
  };
}

// 解析模型回覆。格式不合或選了不存在的方案一律回 null——不補猜。
export function parseChoice(text, planCount) {
  const match = String(text ?? '').match(/\{[\s\S]*\}/);
  if (!match) return null;
  let parsed;
  try {
    parsed = JSON.parse(match[0]);
  } catch {
    return null;
  }
  const label = String(parsed?.choice ?? '').trim().toUpperCase().replace(/^方案\s*/, '');
  const index = PLAN_LABELS.indexOf(label);
  if (index < 0 || index >= planCount) return null;
  return { index, reason: String(parsed.reason ?? '').trim() };
}

// 多次詢問取過半數。`parsed` 是每一票的解析結果（無效為 null），`total` 是問了幾次。
// 過半以「問了幾次」為分母：三票裡兩票無效、一票有效不算過半。沒有方案過半回 null。
export function majorityChoice(parsed, total = parsed.length) {
  const counts = new Map();
  for (const item of parsed) {
    if (item) counts.set(item.index, (counts.get(item.index) ?? 0) + 1);
  }
  for (const [index, count] of counts) {
    if (count * 2 > total) {
      return { choice: parsed.find(item => item && item.index === index), count, unanimous: count === total };
    }
  }
  return null;
}

// 兩個情境排出一模一樣的方案組合時只算一題。
export function querySignature(plans) {
  return plans
    .map(plan => (plan.schedule ?? []).map(course => course.sectionId ?? course.id).sort((a, b) => a - b).join(','))
    .sort()
    .join('|');
}

// 使用者在介面上勾的方向，轉成三軸權重。CP 以此為起點；「只用顯式偏好」對照組也用它。
export function explicitDirection(prefs) {
  let easy = 0;
  if (prefs?.preferEasy || prefs?.preferEasyCourses) easy = 1;
  else if (prefs?.preferChallengingCourses) easy = -1;
  return { interest: 0, compact: prefs?.preferCompact ? 1 : 0, easy };
}

// 正式 v2 服務傳入的先驗（`preferenceLearningService.deriveExplicitProfile()`）：
// 只有 compact 有值，easy 刻意為 0。對照組要量的是線上的 v2，所以照它的做法給。
export function v2ExplicitProfile(prefs) {
  return { interest: 0, compact: prefs?.preferCompact ? 1 : 0, easy: 0 };
}
