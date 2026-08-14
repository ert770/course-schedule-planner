// 課程類別解析：把資料庫的 `Courses.type` 轉成排課引擎真正需要的類別。
//
// **資料庫的 `type` 只有 `必修` 與 `選修` 兩種值**（必修 1760 筆、選修 1326 筆）。
// 排課引擎的類別優先度表卻有 `核心選修`、`通識`、`系外選修`——這三個值從來不會
// 出現在資料裡，因此那三條優先度規則實際上從未生效過。
//
// 本模組負責在排課前把每門課解析成「對這位學生而言」的類別：
//
// | 來源 | 解析結果 |
// | --- | --- |
// | `type = '必修'` | `必修`（是否為這位學生的必修由 `courseScope.js` 判定） |
// | 選修，且在資工系核心選修清單中 | `核心選修` |
// | 選修，且在資工系選修清單中 | `一般選修` |
// | 選修，且開在其他系所班級 | `系外選修` |
// | 其他 | 維持原值 |
//
// 核心選修與修課路徑資料來自 `server/src/data/csCurriculum.js`（114 必選修科目表
// 與 113 課程地圖）。目前只有資訊工程學系有這份對照，其他系所維持原本的類別。

import { classifyCsCourse } from '../data/csCurriculum.js';
import { classifyGeneralEducationCourse } from '../data/generalEducationCatalog.js';
import { resolveCourseEligibility } from './courseScope.js';
import { isOutsideElective } from './outsideElective.js';

const CS_DEPARTMENT = '資訊工程學系';

export const CATEGORY_REQUIRED = '必修';
export const CATEGORY_CORE_ELECTIVE = '核心選修';
export const CATEGORY_ELECTIVE = '一般選修';
export const CATEGORY_OUTSIDE_ELECTIVE = '系外選修';
export const CATEGORY_GENERAL_EDUCATION = '通識';

// 解析一門課對這位學生而言的類別與修課路徑。
export function resolveCourseCategory(course, scope) {
  const original = course?.category ?? course?.type ?? null;

  if (!course) {
    return { category: original, track: null, classificationSource: 'mysql' };
  }

  const generalEducation = classifyGeneralEducationCourse(course);
  if (generalEducation) {
    return {
      category: CATEGORY_GENERAL_EDUCATION,
      track: null,
      classificationSource: generalEducation.classificationSource,
      generalEducationDomain: generalEducation.domain,
      generalEducationRuleVersion: generalEducation.ruleVersion,
      generalEducationRecognitionType: generalEducation.recognitionType,
      classificationReference: generalEducation.sourceUrl,
    };
  }

  if (original === CATEGORY_REQUIRED) {
    return { category: original, track: null, classificationSource: 'mysql' };
  }

  if (scope?.department === CS_DEPARTMENT) {
    const classified = classifyCsCourse(course);
    if (classified) {
      return {
        category: classified.category === '選修' ? CATEGORY_ELECTIVE : classified.category,
        track: classified.track,
        classificationSource: 'cs_curriculum',
      };
    }
  }

  if (isOutsideElective(course, scope)) {
    return {
      category: CATEGORY_OUTSIDE_ELECTIVE,
      track: null,
      classificationSource: 'outside_department',
    };
  }

  return {
    category: original,
    track: course.track ?? null,
    classificationSource: 'mysql',
  };
}

// 產生帶有解析後類別的課程物件。
//
// 保留 `sourceCategory`，讓前端與除錯能看出資料庫原本的值——
// 直接覆蓋 `category` 而不留痕跡，之後就無從分辨「資料庫寫選修」與
// 「系統判定為核心選修」的差別。
export function annotateCourseCategory(course, scope) {
  const sourceCategory = course?.sourceCategory ?? course?.category ?? course?.type ?? null;
  const resolved = resolveCourseCategory(course, scope);
  const eligibility = resolveCourseEligibility({ ...course, sourceCategory }, scope);

  return {
    ...course,
    category: resolved.category,
    sourceCategory,
    classificationSource: resolved.classificationSource,
    track: resolved.track ?? course.track ?? null,
    ...eligibility,
    ...(resolved.generalEducationRuleVersion ? {
      generalEducationDomain: resolved.generalEducationDomain,
      generalEducationRuleVersion: resolved.generalEducationRuleVersion,
      generalEducationRecognitionType: resolved.generalEducationRecognitionType,
      classificationReference: resolved.classificationReference,
    } : {}),
  };
}

export default { resolveCourseCategory, annotateCourseCategory };
