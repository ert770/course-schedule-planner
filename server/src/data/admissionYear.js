// 入學年度的推導與交叉驗證（Roadmap #23）。
//
// **執行期不用這個模組**：`admissionYear` 的真相來源是 `User_Profiles.admission_year`
// 欄位（使用者填寫或 migration 回填），不在每次請求時推導——推導值與使用者填的值
// 一旦混在同一個欄位就再也分不出來，規則版本也就無從標示可信度。
//
// 這裡的推導只給 **migration 回填** 用（`scripts/admissionYearMigration.js`）。
// 抽成獨立純函式模組而不是寫在腳本裡，是因為腳本檔案本身會自我執行——
// 從測試 import 一個自我執行的 migration 腳本就等於跑一次 migration。

import { normalizeAdmissionYear } from './graduationRuleVersions.js';

// 兩個獨立來源各推一次入學年度，一致才採用。
//
//   1. `gradeLevel` + 目前學年度：入學年度 = 目前學年度 − 年級 + 1
//   2. `courseHistory` 最早的 `academicYear`
//
// **不一致就回傳 null，不挑一個用。** 不一致代表其中一個來源有問題（休學、轉學、
// 延畢、成績單匯入不完整…），而錯的入學年度會靜默選到錯的畢業規則版本。
// 留 null 至少會讓 `resolveGraduationRule()` 誠實回報「入學年度未知」。
export function reconcileAdmissionYear({
  gradeLevel,
  earliestHistoryYear,
  activeAcademicYear,
} = {}) {
  const grade = Number(gradeLevel);
  const fromGrade = Number.isInteger(grade) && grade > 0
    ? normalizeAdmissionYear(Number(activeAcademicYear) - grade + 1)
    : null;
  const fromHistory = normalizeAdmissionYear(earliestHistoryYear);

  if (fromGrade === null && fromHistory === null) {
    return { admissionYear: null, sources: { fromGrade, fromHistory }, reason: '兩個來源都算不出入學年度（缺年級且無修課歷史）' };
  }
  if (fromGrade === null) {
    return { admissionYear: null, sources: { fromGrade, fromHistory }, reason: `只有修課歷史推出 ${fromHistory}，缺年級無法交叉驗證` };
  }
  if (fromHistory === null) {
    return { admissionYear: null, sources: { fromGrade, fromHistory }, reason: `只有年級推出 ${fromGrade}，缺修課歷史無法交叉驗證` };
  }
  if (fromGrade !== fromHistory) {
    return {
      admissionYear: null,
      sources: { fromGrade, fromHistory },
      reason: `兩個來源不一致（年級推出 ${fromGrade}、修課歷史推出 ${fromHistory}），不猜`,
    };
  }

  return { admissionYear: fromGrade, sources: { fromGrade, fromHistory }, reason: null };
}

export default { reconcileAdmissionYear };
