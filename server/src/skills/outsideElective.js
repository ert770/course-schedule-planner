// 系外選修認列條件（資訊工程學系）。
//
// **來源**：
//   - 資訊工程學系大學部選課公告：系外課程需「非進修部開設」「非基礎概論性課程」
//     「課程內容與本系不重複或不相近」「難度不低於本系課程」。
//   - 114 學年度必選修科目表畢業學分說明第 (6) 項：「外系9學分課程：9學分，
//     修習進修部及大一概論性課程不認列，修習其他課程須先至系辦公室詢問是否計入畢業學分。」
//
// 規則彙整見 `docs/COURSE_SELECTION_RULES.md` 第九節。
//
// ## 四個條件分成兩種強度
//
// | 條件 | 可否機械判定 | 本模組處理 |
// | --- | --- | --- |
// | 非進修部開設 | 可（班級名稱） | 硬性不認列 |
// | 內容不與本系重複 | 可（課名對必選修科目表） | 硬性不認列 |
// | 非基礎概論性 | 可（大一 + 概論性課名） | 硬性不認列 |
// | 難度不低於本系 | **不可** | 以課號級數為代理指標，只警告不排除 |
//
// 「難度不低於本系課程」沒有任何可機械比較的欄位。這裡用課號級數（`IECS3002`
// 的 `3`）當代理指標，並且**只發警告不排除**——把猜測當成硬性規則會靜默刪掉
// 學生其實可以修的課，比漏警告更糟。
//
// 通過全部條件的課程一律標記 `needsOfficeConfirmation`，因為科目表明文寫
// 「須先至系辦公室詢問是否計入畢業學分」，系統無權代替系辦認定。
//
// **僅確認資工系**。其他系所是否有相同規定尚未查證，因此非資工系學生一律
// 回傳 `checked: false`，不做任何過濾。

import { parseClassName, isOwnDepartmentClass } from './courseScope.js';
import { isCsCourse, isCsCurriculumCourseName } from '../data/csCurriculum.js';

// 目前只有資訊工程學系的系外選修條件經過查證。
const SUPPORTED_DEPARTMENTS = new Set(['資訊工程學系']);

// 概論性課名。搭配「大一」一起判定，單獨出現不構成不認列——
// 「人工智慧導論」「資料探勘導論」都是資工系三年級的核心選修／選修，
// 只看課名會把難度相當的他系課程一併誤殺。
const INTRODUCTORY_NAME_PATTERN = /概論|導論|通論|概要|入門/u;

// 課號中的級數位，例如 `IECS3002` -> 3、`MATH1005` -> 1。
const COURSE_LEVEL_PATTERN = /^[A-Z]+(\d)/u;

const FRESHMAN_LEVEL = 1;

function getCourseLevel(course) {
  const match = String(course?.subid3 || '').trim().toUpperCase().match(COURSE_LEVEL_PATTERN);
  return match ? Number(match[1]) : null;
}

function isContinuingEducationClass(parsed) {
  return parsed.degree === 'continuing' || String(parsed.className || '').includes('進修');
}

// 這門課對這位學生而言是不是系外選修。
//
// 只有「其他系所班級開的選修」才算。通識、共同科目、學院綜合班、英語授課班、
// 學分學程都不是系所班級，不屬於任何一系，因此不在系外選修的範圍內
// ——把它們當成系外選修會讓通識課被系外選修的條件過濾掉。
export function isOutsideElective(course, scope) {
  if (!course || course.category === '必修') return false;
  if (!scope?.resolved) return false;

  const parsed = parseClassName(course.department);
  if (!parsed.isDepartmentClass) return false;
  if (isOwnDepartmentClass(course, scope)) return false;

  // 本系開的課也可能掛在別系班級底下（合開課程），課號才是判定依據。
  return !isCsCourse(course);
}

// 評估一門系外選修是否可認列為畢業學分。
//
// 回傳：
//   checked                 是否套用了認列條件（非資工系或非系外選修時為 false）
//   isOutside               是否為系外選修
//   eligible                是否可認列
//   reasons                 不可認列的原因（可能多條）
//   warnings                可認列但需注意的事項
//   needsOfficeConfirmation 依科目表註 (6)，仍須向系辦確認
export function evaluateOutsideElective(course, scope) {
  const base = {
    checked: false,
    isOutside: false,
    eligible: true,
    reasons: [],
    warnings: [],
    needsOfficeConfirmation: false,
  };

  if (!SUPPORTED_DEPARTMENTS.has(scope?.department)) return base;
  if (!isOutsideElective(course, scope)) return base;

  const parsed = parseClassName(course.department);
  const reasons = [];
  const warnings = [];

  if (isContinuingEducationClass(parsed)) {
    reasons.push('進修部開設課程不認列為系外選修');
  }

  if (isCsCurriculumCourseName(course.name)) {
    reasons.push(`課程內容與本系「${course.name}」重複，不認列為系外選修`);
  }

  const level = getCourseLevel(course);
  const isFreshmanCourse = parsed.grade === FRESHMAN_LEVEL || level === FRESHMAN_LEVEL;
  if (isFreshmanCourse && INTRODUCTORY_NAME_PATTERN.test(String(course.name || ''))) {
    reasons.push('大一概論性課程不認列為系外選修');
  } else if (level !== null && level < FRESHMAN_LEVEL + 1) {
    // 難度無法機械判定，只提醒不排除。
    // 回傳課名而非完整句子，讓呼叫端能把數十門課彙整成一行——
    // 每門課各發一條警告會把畫面上的其他警告淹掉（實測 24 條）。
    warnings.push({ type: 'difficulty', name: course.name });
  }

  return {
    checked: true,
    isOutside: true,
    eligible: reasons.length === 0,
    reasons,
    warnings,
    needsOfficeConfirmation: reasons.length === 0,
  };
}

export default { isOutsideElective, evaluateOutsideElective };
