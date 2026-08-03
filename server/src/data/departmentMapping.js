// 系所全名與班級簡稱對照。
//
// **來源與唯一真相：`docs/DEPARTMENT_MAPPING.md` 的「A. 系所」表。**
// 該表由 562 個真實班級名稱反推而來，並經使用者逐項核對確認（2026-08-02 完成）。
// 修改本檔前必須先更新該文件，兩者不得各自漂移。
//
// 為什麼需要這份對照：`Course_Sections` 沒有「這門課屬於哪個系所」的欄位，
// 只有班級名稱（API 對應到 `course.department`），例如 `資訊三甲`、`會計碩一`；
// 而 `User_Profiles.department` 存的是系所全名，例如 `資訊工程學系`。
// 兩者之間沒有一致的構詞規則（`合經` = 合作經濟暨社會事業經營學系、
// `機電` 與 `機械` 是同一系所的不同學制），**不可用字面相似度推導**。

// [簡稱, 系所全名]
const ABBREVIATION_ENTRIES = [
  ['國貿', '國際經營與貿易學系'],
  ['機電', '機械與電腦輔助工程學系'],
  ['航太', '航太與系統工程學系'],
  ['光電', '光電科學與工程學系'],
  ['運輸物流', '運輸與物流學系'],
  ['水利資保', '水利工程與資源保育學系'],
  ['環境', '環境工程與科學學系'],
  ['工業', '工業工程與系統管理學系'],
  ['合經', '合作經濟暨社會事業經營學系'],
  ['纖複', '纖維與複合材料學系'],
  ['都資', '都市計畫與空間資訊學系'],
  ['建築專業', '建築專業學院'],
  ['國企', '國際企業管理全英語學士學位學程'],
  ['財法', '財經法律研究所'],
  ['財精', '財務工程與精算學士學位學程'],
  ['資電', '資訊電機學院'],
  ['精密系統', '精密系統設計學士學位學程'],
  ['太空', '太空系統工程碩士學位學程'],
  ['綠色能源', '綠色能源科技碩士學位學程'],
  ['文社', '文化與社會創新碩士學位學程'],
  ['生醫資工', '生醫資訊暨生醫工程碩士學位學程'],
  ['外文英語文', '外國語文學系英語文碩士班'],
  ['人工智慧', '人工智慧技術與應用學士學位學程'],
  // 室內設計進修學士班有兩種寫法並存，兩者指向同一單位。
  ['室內設計', '室內設計進修學士班'],
  ['室設', '室內設計進修學士班'],
  ['財法專', '財經法律研究所碩士在職專班'],
  ['專案管理', '專案管理碩士在職學位學程'],
  // `機電`（大學部）與 `機械`（碩士班）為同一系所的不同學制簡稱。
  ['機械', '機械與電腦輔助工程學系'],
  ['統精', '統計與精算碩士班'],
  ['資訊', '資訊工程學系'],
  ['電機', '電機工程學系'],
  ['會計', '會計學系'],
  ['電子', '電子工程學系'],
  ['企管', '企業管理學系'],
  ['財金', '財務金融學系'],
  ['材料', '材料科學與工程學系'],
  ['外文', '外國語文學系'],
  ['土木', '土木工程學系'],
  ['化工', '化學工程學系'],
  ['通訊', '通訊工程學系'],
  ['自控', '自動控制工程學系'],
  ['土管', '土地管理學系'],
  ['風保', '風險管理與保險學系'],
  ['經濟', '經濟學系'],
  ['財稅', '財稅學系'],
  ['行銷', '行銷學系'],
  ['中文', '中國文學系'],
  ['統計', '統計學系'],
  ['應數', '應用數學系'],
  ['建築', '建築學系'],
  ['金融學士', '金融學院學士班'],
  ['金融', '金融博士學位學程'],
  ['商學', '商學博士學位學程'],
  ['商學進修', '商學進修學士班'],
  ['商學專業', '商學專業碩士在職專班'],
  ['營管', '營建管理進修學士班'],
  ['經專', '經營管理碩士在職專班'],
  ['建規', '建築與都市計畫博士學位學程'],
  ['建設', '建設碩士在職學位學程'],
  ['智能工程', '智能工程碩士在職專班'],
  ['資訊電機', '資訊電機工程碩士在職學位學程'],
  ['社創永續', '社會創新與永續碩士在職專班'],
  ['資通安全', '資訊安全碩士學位學程'],
  ['數科', '數據科學碩士學位學程'],
  ['智慧城市', '智慧城市碩士學位學程'],
  ['電聲', '電聲碩士學位學程'],
  ['電通', '電機與通訊工程博士學位學程'],
  ['機航', '機械與航太工程博士學位學程'],
  ['資通訊與電控', '資通訊與電控碩士在職專班'],
  ['資訊工程學士後', '資訊工程學系學士後專班'],
  ['淨零智慧學士後', '工程與科學學院淨零智慧學士後專班'],
];

const ABBREVIATION_TO_DEPARTMENT = new Map(ABBREVIATION_ENTRIES);

// 系所全名 -> 簡稱清單。必須是清單而非單一值：`機械與電腦輔助工程學系` 的學生
// 其課程同時分布在 `機電*` 與 `機械*` 兩組班級，只比對其中一個會漏掉另一組。
const DEPARTMENT_TO_ABBREVIATIONS = new Map();
for (const [abbr, department] of ABBREVIATION_ENTRIES) {
  if (!DEPARTMENT_TO_ABBREVIATIONS.has(department)) {
    DEPARTMENT_TO_ABBREVIATIONS.set(department, []);
  }
  DEPARTMENT_TO_ABBREVIATIONS.get(department).push(abbr);
}

// 由長到短，供最長前綴比對使用。`資訊` 與 `資訊電機`、`商學` 與 `商學進修`
// 等前綴重疊的簡稱，必須先試長的才不會判錯系所。
const ABBREVIATIONS_BY_LENGTH = [...ABBREVIATION_TO_DEPARTMENT.keys()]
  .sort((a, b) => b.length - a.length);

export function getDepartmentByAbbreviation(abbreviation) {
  return ABBREVIATION_TO_DEPARTMENT.get(abbreviation) || null;
}

export function getAbbreviations(department) {
  return DEPARTMENT_TO_ABBREVIATIONS.get(department) || [];
}

export function isKnownDepartment(department) {
  return DEPARTMENT_TO_ABBREVIATIONS.has(department);
}

export function findLongestAbbreviationPrefix(className) {
  const text = String(className || '');
  return ABBREVIATIONS_BY_LENGTH.find(abbr => text.startsWith(abbr)) || null;
}

export {
  ABBREVIATION_ENTRIES,
  ABBREVIATION_TO_DEPARTMENT,
  DEPARTMENT_TO_ABBREVIATIONS,
  ABBREVIATIONS_BY_LENGTH,
};

export default {
  getDepartmentByAbbreviation,
  getAbbreviations,
  isKnownDepartment,
  findLongestAbbreviationPrefix,
};
