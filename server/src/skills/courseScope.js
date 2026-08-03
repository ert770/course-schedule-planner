// 課程範圍判定（路線圖 #13）。
//
// 資料庫的 `Courses.type = '必修'` 代表「**某個系所某個年級**的必修」，不是
// 「**這位學生**的必修」。全校共 2094 筆必修 section，先前一律當成每位學生的必修，
// 產生的課表橫跨 79 個系所、含 12 個不同研究所的碩士論文。
//
// 判定依據只有 `course.department`，而它實際上是**班級名稱**（例如 `資訊三甲`），
// 不是系所名稱。本模組負責把班級名稱解析成「系所 + 學制 + 年級」，
// 再與學生的 `User_Profiles.department` / `grade_level` 比對。

import {
  findLongestAbbreviationPrefix,
  getDepartmentByAbbreviation,
  getAbbreviations,
} from '../data/departmentMapping.js';
import { normalizeDepartment } from '../utils/text.js';

const GRADE_BY_CHAR = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5 };

// 學制標記。順序有意義：`碩專` 必須排在 `碩` 之前，否則 `碩專一` 會被判成碩士班。
const DEGREE_MARKERS = [
  ['學士後專班', 'postBachelor'],
  ['碩專', 'masterInService'],
  ['碩', 'master'],
  ['博', 'doctor'],
  ['進修', 'continuing'],
];

const DEFAULT_DEGREE = 'bachelor';

// 非系所班級的粗分類，對應 `docs/DEPARTMENT_MAPPING.md` 的 B～F 表。
// 目前排課不依這個分類做不同處理（B～F 的適用對象尚未確認，見路線圖 #13），
// 它的用途是讓警告訊息與後續調查能說出「被降級的是哪一類」。

// 即使開頭剛好是某個系所簡稱，也一定不是系所班級的名稱樣態。
// 必須在系所解析**之前**判定：`商學一(UQ)` 會被 `商學` + 年級 `一` 誤判成系所班級，
// 但它其實是 UQ 國際學程；`資電學院綜合班` 同理。
const NON_DEPARTMENT_PATTERNS = [
  // D. 英語授課班與國際學程
  [/英[A-Z]?班/, 'englishProgram'],
  [/\((SFSU|Monash|UQ|SJSU|RMIT|UNSW)\)/, 'internationalProgram'],
  [/^國際生/, 'internationalProgram'],
  // C. 學院綜合班
  [/學院.*綜合班/, 'collegeWide'],
  // F. 其他
  [/^未完成課程/, 'unknownPurpose'],
];

// 系所解析失敗後才套用。`學程$` 不能放進上面那組：`建築二學位學程`、
// `國企一學位學程`、`智能工程碩專一學位學程` 都是 A 表中的系所班級。
const FALLBACK_PATTERNS = [
  // E. 學分學程
  [/學程$/, 'creditProgram'],
];

// B. 全校共同與通識中，班級名稱本身就寫明適用年級者。
// 其餘共同科目（國文綜合班、體育選修、核心必修綜合班…）的適用對象尚未確認，
// 列於 `docs/DEPARTMENT_MAPPING.md` 與路線圖 #13 的待確認問題。
const GRADE_IN_NAME_PATTERNS = [
  [/\(一年級\)/, 1],
  [/^大二/, 2],
];

function parseDegree(rest) {
  for (const [marker, degree] of DEGREE_MARKERS) {
    if (rest.startsWith(marker)) {
      return { degree, rest: rest.slice(marker.length) };
    }
  }
  return { degree: DEFAULT_DEGREE, rest };
}

function matchPattern(className, patterns) {
  for (const [pattern, category] of patterns) {
    if (pattern.test(className)) return category;
  }
  return null;
}

function findGradeInName(className) {
  for (const [pattern, grade] of GRADE_IN_NAME_PATTERNS) {
    if (pattern.test(className)) return grade;
  }
  return null;
}

// 把班級名稱解析成 { 系所, 學制, 年級 }。
//
// 只有「簡稱後面**緊接**（學制標記）+ 年級字」才算系所班級。這個嚴格條件是必要的：
// 單純比對前綴會把 `建設英班` 判成建設、`商學院綜合班` 判成商學、
// `資通安全學程` 判成資通安全，全部是假陽性。
// 3560 筆課程 × 5 個方案 × 多個判定會重複解析同一批班級名稱（相異值只有 562 個），
// 因此解析結果快取。
const parseCache = new Map();

export function parseClassName(className) {
  const name = String(className || '').trim();

  const cached = parseCache.get(name);
  if (cached) return cached;

  const parsed = parseClassNameUncached(name);
  parseCache.set(name, parsed);
  return parsed;
}

function parseClassNameUncached(name) {
  if (!name) {
    return { className: name, isDepartmentClass: false, category: 'unknown', department: null, abbreviation: null, degree: null, grade: null };
  }

  const nonDepartment = matchPattern(name, NON_DEPARTMENT_PATTERNS);

  if (!nonDepartment) {
    const abbreviation = findLongestAbbreviationPrefix(name);
    if (abbreviation) {
      const { degree, rest } = parseDegree(name.slice(abbreviation.length));
      const grade = GRADE_BY_CHAR[rest[0]] ?? null;

      if (grade !== null) {
        return {
          className: name,
          isDepartmentClass: true,
          category: 'department',
          department: getDepartmentByAbbreviation(abbreviation),
          abbreviation,
          degree,
          grade,
        };
      }
    }
  }

  return {
    className: name,
    isDepartmentClass: false,
    // 其餘視為 B 類全校共同與通識（國文綜合班、體育選修、軍訓、核心必修綜合班…）。
    category: nonDepartment || matchPattern(name, FALLBACK_PATTERNS) || 'commonCurriculum',
    department: null,
    abbreviation: null,
    degree: null,
    grade: findGradeInName(name),
  };
}

// 學生條件。`User_Profiles` 目前沒有學制欄位，因此預設為學士；
// 若日後補上，profile 帶 `degree` 即可生效。
export function buildStudentScope(profile = {}) {
  const department = normalizeDepartment(profile.department) || null;
  const gradeValue = Number(profile.gradeLevel ?? profile.grade);
  const grade = Number.isInteger(gradeValue) && gradeValue > 0 ? gradeValue : null;

  return {
    department,
    grade,
    degree: profile.degree || DEFAULT_DEGREE,
    abbreviations: department ? getAbbreviations(department) : [],
    // 系所或年級任一缺漏都無法判定必修範圍。此時不得退回「全校必修都算」，
    // 那正是 #13 的缺陷本身。
    resolved: Boolean(department && grade && getAbbreviations(department).length > 0),
  };
}

// 這門課是否為「這位學生的必修」。
export function isRequiredForStudent(course, scope) {
  if (!course || course.category !== '必修') return false;
  if (!scope || !scope.resolved) return false;

  const parsed = parseClassName(course.department);
  if (!parsed.isDepartmentClass) return false;

  return scope.abbreviations.includes(parsed.abbreviation)
    && parsed.degree === scope.degree
    && parsed.grade === scope.grade;
}

// 這門課是否為「別人的必修」——他系、他學制或其他年級的必修。
// 這類課程學生無法修習，必須整個排除，不能只是降低優先度。
export function isOtherStudentsRequiredCourse(course, scope) {
  if (!course || course.category !== '必修') return false;

  const parsed = parseClassName(course.department);
  // B～F 類（通識、共同、學院綜合班、英語班、學分學程）的適用對象尚未確認，
  // 不能斷定屬於別人，因此不在此排除；它們會降為一般候選課程。
  // 相關待確認問題整理於路線圖 #13。
  if (!parsed.isDepartmentClass) return false;

  if (!scope || !scope.resolved) {
    // 無法判定學生範圍時，任何系所班級的必修都不該被當成這位學生的必修，
    // 但也不宜整批排除候選——維持可選，由使用者補齊系所與年級後才收斂。
    return false;
  }

  return !isRequiredForStudent(course, scope);
}

export default {
  parseClassName,
  buildStudentScope,
  isRequiredForStudent,
  isOtherStudentsRequiredCourse,
};
