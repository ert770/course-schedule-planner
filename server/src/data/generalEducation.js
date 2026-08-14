// 通識共同必修 3 學分 —— **排課要排，畢業學分不計**。
//
// **來源**：資訊工程學系必選修科目表（114 學年度）畢業學分說明第 (1) 項：
// 「通識基礎課程：16學分，體育(一)(二)、體育選修、國防科技，不計入畢業學分。」
// 規則彙整見 `docs/COURSE_SELECTION_RULES.md` 第四節。
//
// | 項目 | 學分 | 資料庫實際課名 |
// | --- | ---: | --- |
// | 全民國防教育軍事訓練 | 1 | `國防科技`（1 學分必修，1 筆） |
// | 體育 | 2 | `體育(二)`（1 學分必修，74 筆）、`體育－羽球` 等體育選修 |
// | 班級活動 | 0 | `班級活動`（0 學分必修，168 筆） |
//
// 這三類仍會排進課表（它們是實際要上的課、會佔用時段），但不得計入畢業學分。
// 因此排課結果同時回報兩個數字：
//   - `totalCredits`      學期修習學分，用於 12～25 學分的上下限檢查
//   - `graduationCredits` 計入畢業的學分，用於畢業進度
//
// **尚未涵蓋**：軍訓選修（資料庫中的 `全民國防` 2 學分、`國防政策` 2 學分）是否計入，
// 依各系修業須知自訂，資工系科目表未提及，因此**維持計入**，不在此排除。
// 部分系所另有自訂規則（例如運輸與物流學系規定體育選修至多 1 學分計入），
// 目前沒有各系修業須知資料，因此本模組對所有系所套用同一組判定。

// 判定一律以課名為準。資料庫的 `Courses.type` 只有 `必修`／`選修` 兩種值，
// 沒有「通識」類別可用，班級名稱也不可靠（`班級活動` 掛在 168 個不同的系所班級底下）。
const NON_GRADUATION_RULES = [
  // 班級活動本身 0 學分，仍列入判定：學分數是資料，不是規則。
  { label: '班級活動', test: name => name === '班級活動' },
  // 涵蓋 體育(一)／(二) 與所有體育選修（`體育－羽球`、`體育—防身術`、`體育－適應體育班`…）。
  { label: '體育', test: name => name.startsWith('體育') },
  // 科目表列的是「國防科技」；`軍訓` 為舊制課名，一併涵蓋。
  // 不用 `startsWith('國防')`——`國防政策` 是 2 學分的軍訓選修，採計方式未確認。
  { label: '軍訓國防', test: name => name === '國防科技' || name.startsWith('軍訓') },
];

// 不計入畢業學分的另一個來源：使用者自己指定、但不符合系外選修認列條件的課程。
// 這類課程仍會排進課表（學生確實可以修），只是學分不計入畢業。
// 判定不在本模組（依系上規定，見 `server/src/skills/outsideElective.js`），
// 由排課引擎在課程上標記 `nonGraduationCategory` 後帶進來。
export const UNRECOGNIZED_OUTSIDE_ELECTIVE = '系外選修未認列';

function normalize(name) {
  return String(name || '').replace(/\s+/gu, '');
}

// 這門課屬於哪一類「不計入畢業學分」的課程；不屬於則回傳 null。
//
// 課程上若已帶 `nonGraduationCategory`（例如排課引擎標記的「系外選修未認列」），
// 以該標記為準：那是課名看不出來的判定結果，不能被課名比對覆蓋掉。
export function getNonGraduationCategory(course) {
  const marked = course?.nonGraduationCategory;
  if (typeof marked === 'string' && marked) return marked;

  const name = normalize(course?.name);
  if (!name) return null;

  const matched = NON_GRADUATION_RULES.find(rule => rule.test(name));
  return matched ? matched.label : null;
}

// 這門課的學分是否計入畢業學分。
export function countsTowardGraduation(course) {
  return getNonGraduationCategory(course) === null;
}

// 一組課程中計入畢業的學分數。
export function sumGraduationCredits(courses = []) {
  return courses.reduce(
    (sum, course) => (countsTowardGraduation(course) ? sum + (Number(course.credits) || 0) : sum),
    0
  );
}

export default {
  UNRECOGNIZED_OUTSIDE_ELECTIVE,
  getNonGraduationCategory,
  countsTowardGraduation,
  sumGraduationCredits,
};
