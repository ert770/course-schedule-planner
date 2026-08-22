// 逢甲大學通識選修分類與課程學年度規則。
//
// 本模組只回答「某學期開設的課是否為通識、當時屬於哪個領域」，不計算學生
// 歷史畢業認列。入學年度、跨院認列學分上限、舊課抵免及逐門歷史課號比對屬於
// roadmap #23 的版本化畢業規則引擎。
//
// 官方來源：
// - 111 學年度以前：https://genedu.fcu.edu.tw/通識選修-112學年度前-舊制/
// - 112 學年度改革：https://genedu.fcu.edu.tw/news/112學年度起【通識選修課程改革說明】/
// - 112 起課程地圖：https://genedu.fcu.edu.tw/課程地圖_112學年度起適用/
// - 115 學年度改革：https://genedu.fcu.edu.tw/news/115學年度通識選修課程變革/
// - 跨院認抵清單：https://genedu.fcu.edu.tw/news/【選修課程】-各院申請認抵通識選修一覽表/

export const GENERAL_EDUCATION_SOURCE_URLS = Object.freeze({
  legacy: 'https://genedu.fcu.edu.tw/%E9%80%9A%E8%AD%98%E9%81%B8%E4%BF%AE-112%E5%AD%B8%E5%B9%B4%E5%BA%A6%E5%89%8D-%E8%88%8A%E5%88%B6/',
  reform112: 'https://genedu.fcu.edu.tw/news/112%E5%AD%B8%E5%B9%B4%E5%BA%A6%E8%B5%B7%E3%80%90%E9%80%9A%E8%AD%98%E9%81%B8%E4%BF%AE%E8%AA%B2%E7%A8%8B%E6%94%B9%E9%9D%A9%E8%AA%AA%E6%98%8E%E3%80%91/',
  courseMap112: 'https://genedu.fcu.edu.tw/%E8%AA%B2%E7%A8%8B%E5%9C%B0%E5%9C%96_112%E5%AD%B8%E5%B9%B4%E5%BA%A6%E8%B5%B7%E9%81%A9%E7%94%A8/',
  reform115: 'https://genedu.fcu.edu.tw/news/115%E5%AD%B8%E5%B9%B4%E5%BA%A6%E9%80%9A%E8%AD%98%E9%81%B8%E4%BF%AE%E8%AA%B2%E7%A8%8B%E8%AE%8A%E9%9D%A9/',
  recognition: 'https://genedu.fcu.edu.tw/news/%E3%80%90%E9%81%B8%E4%BF%AE%E8%AA%B2%E7%A8%8B%E3%80%91-%E5%90%84%E9%99%A2%E7%94%B3%E8%AB%8B%E8%AA%8D%E6%8A%B5%E9%80%9A%E8%AD%98%E9%81%B8%E4%BF%AE%E4%B8%80%E8%A6%BD%E8%A1%A8/',
});

export const LEGACY_GENERAL_EDUCATION_DOMAINS = Object.freeze([
  '人文',
  '社會',
  '自然',
  '統合',
]);

export const GENERAL_EDUCATION_DOMAINS_112_TO_114 = Object.freeze([
  '全球氣候變遷與永續發展',
  '人文藝術與社會經典教育',
  '世界格局與歷史地理視野',
  '科技知識原理與趨勢浪潮',
]);

export const GENERAL_EDUCATION_RULES = Object.freeze([
  Object.freeze({
    version: 'through-111',
    academicYearFrom: null,
    academicYearTo: 111,
    domains: LEGACY_GENERAL_EDUCATION_DOMAINS,
    domainRequired: true,
    sourceUrl: GENERAL_EDUCATION_SOURCE_URLS.legacy,
  }),
  Object.freeze({
    version: '112-114',
    academicYearFrom: 112,
    academicYearTo: 114,
    domains: GENERAL_EDUCATION_DOMAINS_112_TO_114,
    domainRequired: true,
    sourceUrl: GENERAL_EDUCATION_SOURCE_URLS.courseMap112,
  }),
  Object.freeze({
    version: 'from-115',
    academicYearFrom: 115,
    academicYearTo: null,
    domains: Object.freeze([]),
    domainRequired: false,
    sourceUrl: GENERAL_EDUCATION_SOURCE_URLS.reform115,
  }),
]);

// 官方 114-2 認抵清單新增的三門課。PDF 沒有正式課號；以下課號已與本專案
// 114-2 MySQL 的課名、學分、開課單位逐筆核對。舊學期逐門課號留給 #23 處理。
export const RECOGNIZED_GENERAL_EDUCATION_COURSES_114_2 = Object.freeze([
  Object.freeze({
    catalogCourseCode: 'IINE2832',
    name: '世界經濟論壇－曾經滄海：幾個世界經濟的“POINTS OF NO RETURN＂',
    credits: 2,
    domain: '世界格局與歷史地理視野',
    academicYear: 114,
    semester: '下學期',
  }),
  Object.freeze({
    catalogCourseCode: 'IINE2833',
    name: '世界經濟論壇（英語授課）－TURNING POINTS OF WORLD-ECONOMY',
    credits: 2,
    domain: '世界格局與歷史地理視野',
    academicYear: 114,
    semester: '下學期',
  }),
  Object.freeze({
    catalogCourseCode: 'HSS1007',
    name: '台灣考古學與原住民',
    credits: 2,
    domain: '世界格局與歷史地理視野',
    academicYear: 114,
    semester: '下學期',
  }),
]);

const RECOGNIZED_114_2_BY_CODE = new Map(
  RECOGNIZED_GENERAL_EDUCATION_COURSES_114_2.map(course => [course.catalogCourseCode, course])
);

const LEGACY_DOMAIN_ALIASES = new Map([
  ['人文', '人文'],
  ['人文領域', '人文'],
  ['社會', '社會'],
  ['社會領域', '社會'],
  ['自然', '自然'],
  ['自然領域', '自然'],
  ['統合', '統合'],
  ['統合領域', '統合'],
]);

const MODERN_DOMAINS = new Set(GENERAL_EDUCATION_DOMAINS_112_TO_114);

function normalizeText(value) {
  return String(value || '').trim();
}

function normalizeAcademicYear(value) {
  const academicYear = Number(value);
  return Number.isInteger(academicYear) && academicYear > 0 ? academicYear : null;
}

function isSecondSemester(value) {
  const semester = normalizeText(value).toLowerCase();
  return semester === '2' || semester === '下' || semester === '下學期' || semester === 'second';
}

export function getGeneralEducationRule(academicYearValue) {
  const academicYear = normalizeAcademicYear(academicYearValue);
  if (academicYear === null) return null;

  return GENERAL_EDUCATION_RULES.find(rule => (
    (rule.academicYearFrom === null || academicYear >= rule.academicYearFrom)
      && (rule.academicYearTo === null || academicYear <= rule.academicYearTo)
  )) || null;
}

function getDirectDomain(department, rule) {
  if (!department || !rule) return null;

  if (rule.version === 'through-111') {
    return LEGACY_DOMAIN_ALIASES.get(department) || null;
  }
  if (rule.version === '112-114') {
    return MODERN_DOMAINS.has(department) ? department : null;
  }

  // 115 起不分領域。若未來匯入資料仍保留舊領域名稱，它仍是通識來源標記，
  // 但 API 不得把舊名稱繼續當成有效領域。
  if (MODERN_DOMAINS.has(department) || LEGACY_DOMAIN_ALIASES.has(department)) {
    return '';
  }
  return null;
}

export function classifyGeneralEducationCourse(course) {
  if (!course) return null;

  const academicYear = normalizeAcademicYear(course.year ?? course.academicYear);
  const rule = getGeneralEducationRule(academicYear);
  if (!rule) return null;

  const department = normalizeText(course.department ?? course.dept);
  const directDomain = getDirectDomain(department, rule);
  if (directDomain !== null || course.isGeneralEducation === true) {
    return {
      category: '通識',
      domain: rule.domainRequired ? (directDomain || null) : null,
      ruleVersion: rule.version,
      recognitionType: 'direct',
      classificationSource: 'general_education_department',
      sourceUrl: rule.sourceUrl,
    };
  }

  const catalogCourseCode = normalizeText(course.catalogCourseCode);
  const recognized = RECOGNIZED_114_2_BY_CODE.get(catalogCourseCode);
  if (
    recognized
    && academicYear === recognized.academicYear
    && isSecondSemester(course.semester)
  ) {
    return {
      category: '通識',
      domain: recognized.domain,
      ruleVersion: rule.version,
      recognitionType: 'cross_college',
      classificationSource: 'general_education_recognition',
      sourceUrl: GENERAL_EDUCATION_SOURCE_URLS.recognition,
    };
  }

  return null;
}

export default {
  GENERAL_EDUCATION_RULES,
  GENERAL_EDUCATION_DOMAINS_112_TO_114,
  LEGACY_GENERAL_EDUCATION_DOMAINS,
  RECOGNIZED_GENERAL_EDUCATION_COURSES_114_2,
  getGeneralEducationRule,
  classifyGeneralEducationCourse,
};
