// Roadmap #10 任務 3B：Persona 模擬選擇用的情境與提示。
//
// **純資料與純函式，不碰 MySQL、不呼叫模型。**
//
// 同一位 Persona 在同一學期用同樣條件重排，會得到一模一樣的方案。要有多道不同的
// 比較題，只能改變「這一次排課的條件」——也就是真實使用者每次排課前會調整的那些設定。

import { makeRandom } from './choiceEvaluation.js';

export const SIMULATION_PROMPT_VERSION = 'persona-choice-v1';

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
  { id: 'no-morning', input: { noMorningClasses: true }, text: '這次不想排第一節的課' },
  { id: 'no-evening', input: { noEveningClasses: true }, text: '這次不想排晚上的課' },
  { id: 'max3', input: { maxCoursesPerDay: 3 }, text: '這次希望每天最多三門課' },
  { id: 'max4', input: { maxCoursesPerDay: 4 }, text: '這次希望每天最多四門課' },
  { id: 'monday-free', input: { mondayFree: true }, text: '這次希望星期一不要排課' },
  { id: 'lunch-free', input: { lunchBreakFree: true }, text: '這次希望中午留空' },
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
  '#不排早八': '不想上第一節的課',
  '#涼課優先': '希望課業負擔輕、容易過',
  '#挑戰難課': '想修紮實、有挑戰性的課，不怕負擔重',
  '#學到許多知識': '重視能不能學到東西',
  '#無分組報告': '不喜歡分組報告',
  '#全英授課': '想修全英語授課的課',
  '#盡量集中排課': '希望課集中在少數幾天，不要每天都跑學校',
  '#星期一排空': '希望星期一完全沒課',
  '#午休務必空出': '中午一定要留時間吃飯休息',
  '#無期中考': '不喜歡有期中考的課',
  '#上機實作考試': '偏好上機實作的考試方式',
  '#平時成績佔比高': '偏好平時成績佔比高的課',
  '#期末報告為主': '偏好以期末報告評分的課',
  '#高度課堂討論': '喜歡課堂討論多的課',
  '#不點名': '偏好不點名的課',
});

const DAY_TEXT = ['', '一', '二', '三', '四', '五', '六', '日'];

export function describePersona(prefs) {
  const lines = [
    `你是逢甲大學資訊工程學系${['', '一', '二', '三', '四'][prefs.gradeLevel] ?? ''}年級的學生，班級是${prefs.className}。`,
  ];
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

function formatTime(course) {
  const blocks = Array.isArray(course.timeBlocks) && course.timeBlocks.length > 0
    ? course.timeBlocks
    : [{ dayOfWeek: course.dayOfWeek, startPeriod: course.startPeriod, endPeriod: course.endPeriod }];
  return blocks
    .filter(block => block.dayOfWeek)
    .map(block => `週${DAY_TEXT[block.dayOfWeek] ?? block.dayOfWeek} ${block.startPeriod}-${block.endPeriod}節`)
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

// 一個方案在提示裡的樣子。**只放使用者在課表畫面上看得到的東西**：課名、類別、學分、
// 時間、教師、評量方式、評價分數。不放方案名稱、主軸、系統分數與「主推」標記——那些等於直接
// 把答案的特徵交給模型。
export function describePlan(plan, label) {
  const courses = [...(plan.schedule ?? [])].sort((left, right) => (
    (left.dayOfWeek ?? 9) - (right.dayOfWeek ?? 9) || (left.startPeriod ?? 99) - (right.startPeriod ?? 99)
  ));
  const days = new Set(courses.flatMap(course => (
    (course.timeBlocks?.length ? course.timeBlocks : [course]).map(block => block.dayOfWeek)
  )).filter(Boolean));
  const lines = [`方案 ${label}（共 ${plan.totalCredits} 學分，${days.size} 天有課）`];
  for (const course of courses) {
    lines.push(
      `- ${course.name}｜${course.category ?? course.type ?? ''}｜${course.credits} 學分｜`
      + `${formatTime(course)}｜${course.instructor ?? course.teacher ?? '教師未定'}`
      + `${formatAssessment(course)}${formatRating(course)}`
    );
  }
  return lines.join('\n');
}

export const PLAN_LABELS = Object.freeze(['A', 'B', 'C', 'D', 'E', 'F']);

export function buildChoicePrompt({ prefs, scenario, plans }) {
  const situation = scenario.notes.length > 0
    ? `這一次排課你另外設定了：${scenario.notes.join('；')}。`
    : '這一次排課你沒有另外調整設定。';
  return {
    system: [
      '你要扮演一位大學生，從系統排出的幾個課表方案裡選一個你這學期真的會用的。',
      '請完全依照這位學生的處境與習慣來選，不要替系統著想，也不要因為某個方案排在前面就選它。',
      '只回傳 JSON：{"choice":"方案代號","reason":"用一兩句話說明為什麼"}。',
    ].join('\n'),
    user: [
      describePersona(prefs),
      situation,
      '',
      '系統排出的方案如下：',
      '',
      ...plans.map((plan, index) => `${describePlan(plan, PLAN_LABELS[index])}\n`),
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
