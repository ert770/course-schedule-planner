// 各系所畢業學分要求（114 學年度入學學生適用）。
//
// **來源**：逢甲大學註冊課務組「114學年度新生必選修科目」（2025-08-28 公告）各系所
// 必選修科目表 PDF，逐份讀取後彙整。索引頁：
// https://registration.fcu.edu.tw/news/114%E5%AD%B8%E5%B9%B4%E5%BA%A6%E6%96%B0%E7%94%9F%E5%BF%85%E9%81%B8%E4%BF%AE%E7%A7%91%E7%9B%AE/
//
// 校級規則與各欄位定義見 `docs/COURSE_SELECTION_RULES.md`，修改前請先更新該文件。
//
// **畢業學分不是全校一致**：128 為多數，但電子／電機／自控／通訊／化工／水利／都資為 130、
// 航太 131、機電／精密系統／環科 134、建築學士學位學程（五年制）156。
// **外系選修也不是全校 9 學分**：電子／自控／通訊為 0、電機為 3。
//
// 欄位：
//   total            畢業總學分
//   deptRequired     本系必修
//   deptElective     本系選修（至少）
//   outsideElective  外系選修（至少）
//   generalBasic     通識基礎課程
//   generalElective  通識選修課程
//   unspecified      未列明學分（total 減去上述五項，通常為自由選修）
//   needsVerification 抽取結果可疑，未經人工複核前不得作為判定依據
//   commonFirstYear  大一共同學士班／不分系，畢業學分於分流後依所屬系所計算
//
// 注意：通識共同必修 3 學分（軍訓國防科技 1、體育 2、班級活動）**不計入畢業學分**。

const REQUIREMENT_ENTRIES = [
  ['建築專業學院學士班', { total: 0, deptRequired: 38, deptElective: 0, outsideElective: 0, generalBasic: 0, generalElective: 0, unspecified: 0, commonFirstYear: true }],
  ['建築學士學位學程', { total: 156, deptRequired: 89, deptElective: 30, outsideElective: 9, generalBasic: 16, generalElective: 12, unspecified: 0 }],
  ['室內設計學士學位學程', { total: 128, deptRequired: 62, deptElective: 29, outsideElective: 9, generalBasic: 16, generalElective: 12, unspecified: 0 }],
  ['機械與電腦輔助工程學系', { total: 134, deptRequired: 80, deptElective: 17, outsideElective: 9, generalBasic: 16, generalElective: 12, unspecified: 0 }],
  ['纖維與複合材料學系', { total: 128, deptRequired: 71, deptElective: 20, outsideElective: 9, generalBasic: 16, generalElective: 12, unspecified: 0 }],
  ['工業工程與系統管理學系', { total: 128, deptRequired: 77, deptElective: 14, outsideElective: 9, generalBasic: 16, generalElective: 12, unspecified: 0 }],
  ['化學工程學系', { total: 130, deptRequired: 80, deptElective: 13, outsideElective: 9, generalBasic: 16, generalElective: 12, unspecified: 0 }],
  ['航太與系統工程學系', { total: 131, deptRequired: 80, deptElective: 14, outsideElective: 9, generalBasic: 16, generalElective: 12, unspecified: 0 }],
  ['精密系統設計學士學位學程', { total: 134, deptRequired: 79, deptElective: 18, outsideElective: 9, generalBasic: 16, generalElective: 12, unspecified: 0 }],
  ['應用數學系', { total: 128, deptRequired: 52, deptElective: 39, outsideElective: 9, generalBasic: 16, generalElective: 12, unspecified: 0 }],
  ['環境工程與科學學系', { total: 134, deptRequired: 72, deptElective: 25, outsideElective: 9, generalBasic: 16, generalElective: 12, unspecified: 0 }],
  ['材料科學與工程學系', { total: 128, deptRequired: 56, deptElective: 35, outsideElective: 9, generalBasic: 16, generalElective: 12, unspecified: 0 }],
  ['光電科學與工程學系', { total: 128, deptRequired: 64, deptElective: 24, outsideElective: 9, generalBasic: 16, generalElective: 12, unspecified: 3 }],
  ['人工智慧技術與應用學士學位學程', { total: 128, deptRequired: 63, deptElective: 28, outsideElective: 9, generalBasic: 16, generalElective: 12, unspecified: 0 }],
  ['會計學系', { total: 128, deptRequired: 77, deptElective: 14, outsideElective: 9, generalBasic: 16, generalElective: 12, unspecified: 0 }],
  ['國際經營與貿易學系', { total: 128, deptRequired: 63, deptElective: 28, outsideElective: 9, generalBasic: 16, generalElective: 12, unspecified: 0 }],
  ['財稅學系', { total: 128, deptRequired: 76, deptElective: 15, outsideElective: 9, generalBasic: 16, generalElective: 12, unspecified: 0 }],
  ['合作經濟暨社會事業經營學系', { total: 128, deptRequired: 62, deptElective: 12, outsideElective: 9, generalBasic: 16, generalElective: 12, unspecified: 17 }],
  ['統計學系', { total: 128, deptRequired: 70, deptElective: 9, outsideElective: 9, generalBasic: 16, generalElective: 12, unspecified: 12 }],
  ['經濟學系', { total: 128, deptRequired: 67, deptElective: 18, outsideElective: 9, generalBasic: 16, generalElective: 12, unspecified: 6 }],
  ['國際企業管理全英語學士學位學程', { total: 128, deptRequired: 66, deptElective: 24, outsideElective: 9, generalBasic: 8, generalElective: 12, unspecified: 9 }],
  ['行銷學系', { total: 128, deptRequired: 66, deptElective: 25, outsideElective: 9, generalBasic: 16, generalElective: 12, unspecified: 0 }],
  ['企業管理學系', { total: 128, deptRequired: 65, deptElective: 18, outsideElective: 9, generalBasic: 16, generalElective: 12, unspecified: 8 }],
  ['土木工程學系', { total: 128, deptRequired: 69, deptElective: 22, outsideElective: 9, generalBasic: 16, generalElective: 12, unspecified: 0 }],
  ['水利工程與資源保育學系', { total: 130, deptRequired: 62, deptElective: 31, outsideElective: 9, generalBasic: 16, generalElective: 12, unspecified: 0 }],
  ['都市計畫與空間資訊學系', { total: 130, deptRequired: 69, deptElective: 21, outsideElective: 9, generalBasic: 16, generalElective: 12, unspecified: 3 }],
  ['運輸與物流學系', { total: 128, deptRequired: 70, deptElective: 21, outsideElective: 9, generalBasic: 16, generalElective: 12, unspecified: 0 }],
  ['土地管理學系', { total: 128, deptRequired: 71, deptElective: 20, outsideElective: 9, generalBasic: 16, generalElective: 12, unspecified: 0 }],
  ['財務金融學系', { total: 128, deptRequired: 62, deptElective: 0, outsideElective: 9, generalBasic: 16, generalElective: 12, unspecified: 29, needsVerification: true }],
  ['風險管理與保險學系', { total: 128, deptRequired: 60, deptElective: 0, outsideElective: 9, generalBasic: 16, generalElective: 12, unspecified: 31, needsVerification: true }],
  ['財務工程與精算學士學位學程', { total: 128, deptRequired: 57, deptElective: 0, outsideElective: 9, generalBasic: 16, generalElective: 12, unspecified: 34, needsVerification: true }],
  ['金融學院學士班', { total: 0, deptRequired: 23, deptElective: 3, outsideElective: 0, generalBasic: 0, generalElective: 0, unspecified: 0, commonFirstYear: true }],
  ['外國語文學系', { total: 128, deptRequired: 65, deptElective: 26, outsideElective: 9, generalBasic: 16, generalElective: 12, unspecified: 0 }],
  ['中國文學系', { total: 128, deptRequired: 56, deptElective: 35, outsideElective: 9, generalBasic: 16, generalElective: 12, unspecified: 0 }],
  ['資訊工程學系', { total: 128, deptRequired: 63, deptElective: 28, outsideElective: 9, generalBasic: 16, generalElective: 12, unspecified: 0 }],
  ['電子工程學系', { total: 130, deptRequired: 75, deptElective: 27, outsideElective: 0, generalBasic: 16, generalElective: 12, unspecified: 0 }],
  ['電機工程學系', { total: 130, deptRequired: 63, deptElective: 36, outsideElective: 3, generalBasic: 16, generalElective: 12, unspecified: 0 }],
  ['自動控制工程學系', { total: 130, deptRequired: 71, deptElective: 31, outsideElective: 0, generalBasic: 16, generalElective: 12, unspecified: 0 }],
  ['通訊工程學系', { total: 130, deptRequired: 73, deptElective: 29, outsideElective: 0, generalBasic: 16, generalElective: 12, unspecified: 0 }],
  ['資訊電機學院學士班', { total: 0, deptRequired: 0, deptElective: 0, outsideElective: 0, generalBasic: 0, generalElective: 0, unspecified: 0, needsVerification: true, commonFirstYear: true }],
  ['全校國際生大一不分系', { total: 0, deptRequired: 13, deptElective: 4, outsideElective: 0, generalBasic: 12, generalElective: 8, unspecified: 0, commonFirstYear: true }],
  ['澳洲墨爾本皇家理工大學商學與創新雙學士學位學程', { total: 128, deptRequired: 62, deptElective: 0, outsideElective: 0, generalBasic: 0, generalElective: 0, unspecified: 66 }],
  ['美國加州聖荷西州立大學商學大數據分析雙學士學位學程', { total: 128, deptRequired: 46, deptElective: 14, outsideElective: 0, generalBasic: 0, generalElective: 0, unspecified: 68 }],
  ['美國加州聖荷西州立大學電機工程雙學士學位學程', { total: 128, deptRequired: 63, deptElective: 9, outsideElective: 0, generalBasic: 0, generalElective: 0, unspecified: 56 }],
  ['美國加州舊金山州立大學資訊工程雙學士學位學程', { total: 128, deptRequired: 50, deptElective: 20, outsideElective: 0, generalBasic: 0, generalElective: 0, unspecified: 58 }],
  ['澳洲昆士蘭大學商學雙學士學位學程', { total: 128, deptRequired: 62, deptElective: 6, outsideElective: 0, generalBasic: 0, generalElective: 0, unspecified: 60 }],
  ['澳洲蒙納許大學資訊工程雙學士學位學程', { total: 128, deptRequired: 69, deptElective: 0, outsideElective: 0, generalBasic: 0, generalElective: 0, unspecified: 59 }],
  ['澳洲昆士蘭大學電機工程雙學士學位學程', { total: 128, deptRequired: 71, deptElective: 9, outsideElective: 0, generalBasic: 0, generalElective: 0, unspecified: 48 }],
  ['澳洲新南威爾斯大學設計雙學士學位學程', { total: 128, deptRequired: 60, deptElective: 15, outsideElective: 0, generalBasic: 0, generalElective: 0, unspecified: 53 }],
];

// 這份對照表的規則版本與出處。
//
// Roadmap #23 把規則改成版本化之後，「這批數字是哪一版、出自哪裡」必須是資料的一部分，
// 才能往下傳到每一筆學分認列。版本解析本身在 `graduationRuleVersions.js`，
// 本檔只負責**這一版的內容**，不處理「該選哪一版」。
export const GRADUATION_REQUIREMENTS_RULE_VERSION = '114';

export const GRADUATION_REQUIREMENTS_114_SOURCE_URL =
  'https://registration.fcu.edu.tw/news/114%E5%AD%B8%E5%B9%B4%E5%BA%A6%E6%96%B0%E7%94%9F%E5%BF%85%E9%81%B8%E4%BF%AE%E7%A7%91%E7%9B%AE/';

export const GRADUATION_REQUIREMENTS_114 = new Map(REQUIREMENT_ENTRIES);

// 既有呼叫端（`routes/graduation.js`、`graduation.test.js`）沿用這個名稱。
// 目前只有 114 一版，因此兩者指向同一個 Map；補進歷史版本時，未指定入學年度的
// 呼叫端仍會拿到最新一版，行為不變。
export const GRADUATION_REQUIREMENTS = GRADUATION_REQUIREMENTS_114;

export function getGraduationRequirement(department) {
  return GRADUATION_REQUIREMENTS.get(String(department || '').trim()) || null;
}

export function hasGraduationRequirement(department) {
  return GRADUATION_REQUIREMENTS.has(String(department || '').trim());
}

export default {
  GRADUATION_REQUIREMENTS,
  GRADUATION_REQUIREMENTS_114,
  GRADUATION_REQUIREMENTS_114_SOURCE_URL,
  GRADUATION_REQUIREMENTS_RULE_VERSION,
  getGraduationRequirement,
  hasGraduationRequirement,
};
