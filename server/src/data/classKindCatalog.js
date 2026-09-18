// Roadmap #13B：目前 114-2 MySQL 的非一般系所班級目錄。
//
// 班級種類的分類（#13B）與適用規則（#13C／#13D）分開放：分類是從資料推得的事實，
// 適用規則是專案負責人於 2026-09-18 口頭確認的答案（尚未對照校方書面文件），
// 見 `docs/DEPARTMENT_MAPPING.md` 與下方 `ELIGIBILITY_RULES`。

const B = 'B';
const C = 'C';
const D = 'D';
const E = 'E';
const F = 'F';

export const CLASS_KIND_LABELS = Object.freeze({
  commonCurriculum: '全校共同與通識班級',
  collegeWide: '學院綜合班',
  englishProgram: '英語授課班',
  internationalProgram: '國際學程班',
  creditProgram: '學分學程',
  other: '用途待確認班級',
  department: '系所班級',
  unclassified: '未分類班級',
});

function entries(classGroup, classKind, names) {
  return names.map(className => Object.freeze({ className, classGroup, classKind }));
}

export const NON_DEPARTMENT_CLASS_CATALOG = Object.freeze([
  ...entries(B, 'commonCurriculum', [
    '人文藝術與社會經典教育',
    '大二英文綜合班',
    '世界格局與歷史地理視野',
    '全民國防教育課程',
    '全球氣候變遷與永續發展',
    '科技知識原理與趨勢浪潮',
    '軍訓(一年級)',
    '核心必修綜合班',
    '國文綜合班',
    '綜合班(微積分)',
    '應用外語選修',
    '應用英語選修',
    '體育選修',
    '體育選項適應體育班',
  ]),
  ...entries(C, 'collegeWide', [
    '人社學院綜合班',
    '工程與科學學院碩士綜合班',
    '工程與科學學院綜合班',
    '社會創新學院綜合班',
    '金融學院碩士綜合班',
    '金融學院綜合班',
    '建設學院綜合班',
    '建築專業學院綜合班',
    '商學院碩士綜合班',
    '商學院綜合班',
    '創能學院綜合班',
    '資電學院碩士綜合班',
    '資電學院綜合班',
  ]),
  ...entries(D, 'englishProgram', [
    '大二進修英班',
    '工英班',
    '建設英班',
    '商英A班',
    '商英B班',
    '商英C班',
    '理英班',
    '進修英班',
    '資電英A班',
    '資電英B班',
  ]),
  ...entries(D, 'internationalProgram', [
    '大數據一(SJSU)',
    '大數據二(SJSU)',
    '商創一(RMIT)',
    '商創二(RMIT)',
    '商學一(UQ)',
    '商學二(UQ)',
    '國際生不分系一年級',
    '設計一(UNSW)',
    '資工一(Monash)',
    '資工一(SFSU)',
    '資工二(Monash)',
    '資工二(SFSU)',
    '電機一(SJSU)',
    '電機一(UQ)',
    '電機二(SJSU)',
  ]),
  ...entries(E, 'creditProgram', [
    '人工智慧工業應用學分學程',
    '人工智慧探索應用學分學程',
    '人工智慧視覺技術學分學程',
    '不動產管理學程',
    '文物管理與鑑識學分學程',
    '文學與文化創意學分學程',
    '水土環境經理學程',
    '再生能源與永續社會學程',
    '法律經濟學程',
    '飛機製造學分學程',
    '創新創業學程',
    '勞工安全衛生學程',
    '智慧物聯網學分學程',
    '智慧軌道運輸學程',
    '華語教師學程',
    '資通安全學程',
  ]),
  ...entries(F, 'other', [
    '大數據分析與實務應用碩士學',
    '未完成課程(大學)',
    '未完成課程(碩士)',
  ]),
]);

const NON_DEPARTMENT_BY_NAME = new Map(
  NON_DEPARTMENT_CLASS_CATALOG.map(entry => [entry.className, entry])
);

// 這 8 個名稱屬 A 表，但格式不符合一般「簡稱 + 學制標記 + 年級」語法。
// 明確列出，避免被尾端「學程」或其他字樣誤分類成 B～F。
export const SPECIAL_DEPARTMENT_CLASS_CATALOG = Object.freeze([
  Object.freeze({ className: '金融碩專學一學位學程', abbreviation: '金融', degree: 'masterInService', grade: 1 }),
  Object.freeze({ className: '金融碩專學二學位學程', abbreviation: '金融', degree: 'masterInService', grade: 2 }),
  Object.freeze({ className: '專案管理碩專班一學位學程', abbreviation: '專案管理', degree: 'masterInService', grade: 1 }),
  Object.freeze({ className: '專案管理碩專班二學位學程', abbreviation: '專案管理', degree: 'masterInService', grade: 2 }),
  Object.freeze({ className: '淨零智慧學士後專班二', abbreviation: '淨零智慧學士後', degree: 'postBachelor', grade: 2 }),
  Object.freeze({ className: '資訊工程學士後專班一', abbreviation: '資訊工程學士後', degree: 'postBachelor', grade: 1 }),
  Object.freeze({ className: '資通訊與電控專班碩一', abbreviation: '資通訊與電控', degree: 'masterInService', grade: 1 }),
  Object.freeze({ className: '資通訊與電控專班碩二', abbreviation: '資通訊與電控', degree: 'masterInService', grade: 2 }),
]);

const SPECIAL_DEPARTMENT_BY_NAME = new Map(
  SPECIAL_DEPARTMENT_CLASS_CATALOG.map(entry => [entry.className, entry])
);

// Roadmap #13C／#13D：B～F 各班級的適用規則。
//
// 來源：專案負責人 2026-09-18 口頭確認（`ELIGIBILITY_RULES_SOURCE`），不是校方書面文件；
// 規則若日後被校方文件推翻，只改這裡。沒有列出的班級名稱維持 `unknown`，不推測。
//
// 規則型態：
//   anyone                    任何學生可修
//   grades                    只限列出的年級（大學部年級 1～4）
//   college                   該學院的學生可修：系所欄就是這個綜合班，或系所屬於這個學院
//   graduateOnly              碩士綜合班；大學部不可修，研究生的適用範圍沒有確認，維持 unknown
//   nobody                    本系統內沒有學生屬於這類班級（D 類獨立學制、F 類），一律不可修
export const ELIGIBILITY_RULES_SOURCE = 'owner-confirmed-2026-09-18';

const ANYONE = Object.freeze({ type: 'anyone' });
const NOBODY = Object.freeze({ type: 'nobody' });
const grades = (...values) => Object.freeze({ type: 'grades', grades: Object.freeze(values) });
const college = name => Object.freeze({ type: 'college', college: name });
const graduateOnly = name => Object.freeze({ type: 'graduateOnly', college: name });

export const ELIGIBILITY_RULES = Object.freeze({
  // B：全校共同與通識。未列出年級者不限年級。
  人文藝術與社會經典教育: grades(1),
  '軍訓(一年級)': grades(1),
  大二英文綜合班: grades(2),
  國文綜合班: grades(1, 2),
  核心必修綜合班: grades(1, 2),
  世界格局與歷史地理視野: ANYONE,
  全民國防教育課程: ANYONE,
  全球氣候變遷與永續發展: ANYONE,
  科技知識原理與趨勢浪潮: ANYONE,
  '綜合班(微積分)': ANYONE,
  應用外語選修: ANYONE,
  應用英語選修: ANYONE,
  體育選修: ANYONE,
  體育選項適應體育班: ANYONE,

  // C：學院綜合班。創能、社會創新是全校開課平台，任何人可修。
  資電學院綜合班: college('資訊電機學院'),
  商學院綜合班: college('商學院'),
  金融學院綜合班: college('金融學院'),
  人社學院綜合班: college('人文社會學院'),
  建築專業學院綜合班: college('建築專業學院'),
  建設學院綜合班: college('建設學院'),
  工程與科學學院綜合班: college('工程與科學學院'),
  創能學院綜合班: ANYONE,
  社會創新學院綜合班: ANYONE,
  資電學院碩士綜合班: graduateOnly('資訊電機學院'),
  商學院碩士綜合班: graduateOnly('商學院'),
  金融學院碩士綜合班: graduateOnly('金融學院'),
  工程與科學學院碩士綜合班: graduateOnly('工程與科學學院'),

  // D：學院全英語學士班與國際雙聯學位都是獨立學制，`User_Profiles.department`
  // 的值域不含它們，因此本系統內沒有學生屬於這些班。
  // `進修英班`／`大二進修英班` 是英文能力分班代號，適用對象沒有確認，刻意不列（維持 unknown）。
  工英班: NOBODY,
  理英班: NOBODY,
  建設英班: NOBODY,
  商英A班: NOBODY,
  商英B班: NOBODY,
  商英C班: NOBODY,
  資電英A班: NOBODY,
  資電英B班: NOBODY,
  '大數據一(SJSU)': NOBODY,
  '大數據二(SJSU)': NOBODY,
  '商創一(RMIT)': NOBODY,
  '商創二(RMIT)': NOBODY,
  '商學一(UQ)': NOBODY,
  '商學二(UQ)': NOBODY,
  國際生不分系一年級: NOBODY,
  '設計一(UNSW)': NOBODY,
  '資工一(Monash)': NOBODY,
  '資工一(SFSU)': NOBODY,
  '資工二(Monash)': NOBODY,
  '資工二(SFSU)': NOBODY,
  '電機一(SJSU)': NOBODY,
  '電機一(UQ)': NOBODY,
  '電機二(SJSU)': NOBODY,

  // E：學分學程不需事先報名，全校學生可自由選修。
  人工智慧工業應用學分學程: ANYONE,
  人工智慧探索應用學分學程: ANYONE,
  人工智慧視覺技術學分學程: ANYONE,
  不動產管理學程: ANYONE,
  文物管理與鑑識學分學程: ANYONE,
  文學與文化創意學分學程: ANYONE,
  水土環境經理學程: ANYONE,
  再生能源與永續社會學程: ANYONE,
  法律經濟學程: ANYONE,
  飛機製造學分學程: ANYONE,
  創新創業學程: ANYONE,
  勞工安全衛生學程: ANYONE,
  智慧物聯網學分學程: ANYONE,
  智慧軌道運輸學程: ANYONE,
  華語教師學程: ANYONE,
  資通安全學程: ANYONE,

  // F：直接排除於本系統外。
  大數據分析與實務應用碩士學: NOBODY,
  '未完成課程(大學)': NOBODY,
  '未完成課程(碩士)': NOBODY,
});

// 學院 → 所屬系所（`DEPARTMENT_MAPPING.md` C-1 表）。系所名稱一律用 A 表全名。
// 財務金融學系同時列在商學院與金融學院，是專案負責人提供的資料原樣；兩個學院的
// 綜合班課程它都可以修。沒有列在任何學院底下的系所，學院綜合班的課維持 unknown。
export const COLLEGE_DEPARTMENTS = Object.freeze({
  資訊電機學院: Object.freeze(['資訊工程學系', '電機工程學系', '電子工程學系', '自動控制工程學系', '通訊工程學系']),
  商學院: Object.freeze(['企業管理學系', '會計學系', '國際經營與貿易學系', '財務金融學系', '統計學系', '行銷學系']),
  金融學院: Object.freeze(['風險管理與保險學系', '財務金融學系', '財稅學系']),
  人文社會學院: Object.freeze(['中國文學系', '外國語文學系']),
  建築專業學院: Object.freeze(['建築專業學院']),
  建設學院: Object.freeze(['土木工程學系', '水利工程與資源保育學系', '都市計畫與空間資訊學系', '運輸與物流學系', '土地管理學系']),
  工程與科學學院: Object.freeze([
    '機械與電腦輔助工程學系', '纖維與複合材料學系', '工業工程與系統管理學系',
    '化學工程學系', '材料科學與工程學系', '光電科學與工程學系',
  ]),
});

// 大學部學院綜合班 → 學院。`User_Profiles.department` 可以直接是這些名稱
// （未分流的大一、大二學生，大三起改成分流後的系所全名）。
export const UNDERGRADUATE_COMBINED_CLASS_COLLEGE = Object.freeze(Object.fromEntries(
  Object.entries(ELIGIBILITY_RULES)
    .filter(([, rule]) => rule.type === 'college')
    .map(([className, rule]) => [className, rule.college])
));

export function getEligibilityRule(className) {
  return ELIGIBILITY_RULES[String(className || '').trim()] ?? null;
}

// 學生所屬的學院。系所欄可能是 A 表系所全名，也可能是未分流的學院綜合班名稱。
export function getStudentColleges(department) {
  const name = String(department || '').trim();
  if (!name) return [];
  if (UNDERGRADUATE_COMBINED_CLASS_COLLEGE[name]) return [UNDERGRADUATE_COMBINED_CLASS_COLLEGE[name]];
  return Object.entries(COLLEGE_DEPARTMENTS)
    .filter(([, departments]) => departments.includes(name))
    .map(([collegeName]) => collegeName);
}

export function getNonDepartmentClassEntry(className) {
  return NON_DEPARTMENT_BY_NAME.get(String(className || '').trim()) || null;
}

export function getSpecialDepartmentClassEntry(className) {
  return SPECIAL_DEPARTMENT_BY_NAME.get(String(className || '').trim()) || null;
}

export default {
  CLASS_KIND_LABELS,
  NON_DEPARTMENT_CLASS_CATALOG,
  SPECIAL_DEPARTMENT_CLASS_CATALOG,
  ELIGIBILITY_RULES,
  ELIGIBILITY_RULES_SOURCE,
  COLLEGE_DEPARTMENTS,
  UNDERGRADUATE_COMBINED_CLASS_COLLEGE,
  getNonDepartmentClassEntry,
  getSpecialDepartmentClassEntry,
  getEligibilityRule,
  getStudentColleges,
};
