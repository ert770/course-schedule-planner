// Roadmap #13B：目前 114-2 MySQL 的非一般系所班級目錄。
//
// 這份表只分類班級名稱的種類，不推測學生是否具備修課資格。B～F 的正式適用
// 對象仍待 #13C／#13D 取得校方規則後才能由 unknown 收斂。

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
  getNonDepartmentClassEntry,
  getSpecialDepartmentClassEntry,
};
