// 依必選修科目表替「未分類」的歷史修課補上畢業分類。
//
// 為什麼需要：從 Markdown 成績表匯入的修課紀錄只有章節標題（基礎／通識／資工核心／系內…），
// 沒有逐門的修別欄，匯入時系內課一律寫成 `unspecified`。畢業缺口計算因此看到
// 「必修 0、選修 0、未分類約 100 學分」，誤以為必修缺 63、選修缺 28。
//
// 這裡**只用課號與官方科目表**判定，不用章節名稱猜：
//   1. 通識基礎必修：核心必修課號（`GEG2000`、`GEK2000`）或中文／英文的課名前綴
//      ——沿用 `generalEducationRecognition.js` 既有的身分判定。
//   2. 系必修：課名在科目表的必修清單上，而且課號是資工系的（`IECS`），或是下方列舉的
//      外系開課必修課號。
//   3. 系選修：`csCurriculum.js` 的核心選修／選修清單（同樣要求 `IECS` 課號）。
// 都對不上就回傳 null，維持未分類——寧可少算也不亂猜。
import {
  REQUIRED_COURSES,
  classifyCsCourse,
  isCsCourse,
  normalizeCourseName,
} from './csCurriculum.js';
import { classifyGeneralEducationEntry } from './generalEducationRecognition.js';

export const CLASSIFICATION_BASIS = Object.freeze({
  GENERAL_BASIC: 'general-basic-required',
  DEPARTMENT_REQUIRED: 'department-required',
  DEPARTMENT_ELECTIVE: 'department-elective',
});

// 系必修中由外系開課的科目，課號不是 `IECS`。
//
// 只比課名會把他系的同名課誤判成本系必修（`csCurriculum.js` 記錄過「電子學」「網路程式設計」
// 的實例），所以這幾門用課號列舉。每一筆都同時滿足：課名在必修清單上，且資料庫中另一位
// 同系同入學年度學生（逐門帶有正式分類的紀錄）把同一課號記為系必修。
export const NON_CS_REQUIRED_COURSE_CODES = Object.freeze({
  IEE1005: '線性代數',
  IEE1006: '邏輯設計',
  IEE1007: '邏輯設計實習',
  IEE1010: '普通物理-電、磁、光',
  IEE1011: '普通物理-電、磁、光實驗',
  MATH1005: '微積分(一)',
  MATH1006: '微積分(二)',
});

const REQUIRED_NAMES = new Set(REQUIRED_COURSES.map(course => normalizeCourseName(course.name)));

function normalizeCode(value) {
  return String(value || '').trim().toUpperCase();
}

/**
 * @param entry `{ courseCode, courseName, generalEducationCategory }`
 * @returns `{ graduationCategory, requirementType, basis }`，判定不了時為 null。
 */
export function classifyHistoryEntryByCurriculum(entry) {
  const courseCode = normalizeCode(entry?.courseCode);
  const courseName = String(entry?.courseName || '').trim();
  if (!courseCode || !courseName) return null;

  // 只採信課程身分（課號／課名前綴）。領域欄位在這類紀錄上是空的，不能拿來當第二來源。
  if (classifyGeneralEducationEntry(entry).byIdentity === 'basic') {
    return {
      graduationCategory: 'general',
      requirementType: '必修',
      basis: CLASSIFICATION_BASIS.GENERAL_BASIC,
    };
  }

  const course = { catalogCourseCode: courseCode, name: courseName };
  const normalizedName = normalizeCourseName(courseName);
  if (REQUIRED_NAMES.has(normalizedName)) {
    const listedName = NON_CS_REQUIRED_COURSE_CODES[courseCode];
    const codeMatches = isCsCourse(course)
      || (listedName !== undefined && normalizeCourseName(listedName) === normalizedName);
    if (codeMatches) {
      return {
        graduationCategory: 'required',
        requirementType: '必修',
        basis: CLASSIFICATION_BASIS.DEPARTMENT_REQUIRED,
      };
    }
    return null;
  }

  if (classifyCsCourse(course)) {
    return {
      graduationCategory: 'elective',
      requirementType: '選修',
      basis: CLASSIFICATION_BASIS.DEPARTMENT_ELECTIVE,
    };
  }
  return null;
}

export default { classifyHistoryEntryByCurriculum };
