import { Router } from 'express';
import { getAll } from '../db/database.js';
import { getGraduationRequirement } from '../data/graduationRequirements.js';
import { normalizeDepartment } from '../utils/text.js';
import { parseClassName } from '../skills/courseScope.js';
import { resolveIdentity, identityErrorResponse } from '../services/identityService.js';
import { getUserPreferences } from '../services/memoryService.js';
import {
  getPassedCourseCodes,
  getEarnedCredits,
  getTotalEarnedCredits,
} from '../data/courseHistory.js';

const router = Router();

// 先前這裡寫死 必修60／選修40／通識20／系外8（合計 128），沒有任何出處，
// 且與官方必選修科目表不符——以資訊工程學系為例，實際是
// 本系必修 63／本系選修 28／外系選修 9／通識基礎 16／通識選修 12。
// 各系畢業總學分也不一致（128／130／131／134／156）。
// 見 `docs/COURSE_SELECTION_RULES.md` 與 `server/src/data/graduationRequirements.js`。
function toCreditBreakdown(requirement) {
  return {
    required: requirement.deptRequired,
    elective: requirement.deptElective,
    general: requirement.generalBasic + requirement.generalElective,
    external: requirement.outsideElective,
    unspecified: requirement.unspecified,
  };
}

// 畢業學分規定**只信官方對照表**（`graduationRequirements.js`）。
//
// 先前這裡查不到系所時會退回 `user.requiredCredits`——那個欄位早在 2026-08-04
// 就已經從 `users.json` 刪除（原本存的是必修60／選修40／通識20／系外8這批
// 沒有出處的捏造數字，而且優先度比官方值還高，蓋掉官方值毫無跡象，這批數字
// 才能存活到那時候）。欄位刪了但退回它的程式碼還留著，變成一段打不到、
// 也沒有意義的防禦。查不到就是查不到，明確回報，不再猜。
export function resolveRequiredCredits(requirement) {
  if (!requirement) {
    return { required: null, totalRequired: null, warning: '此系所不存在，請檢查是否輸入錯誤' };
  }
  return { required: toCreditBreakdown(requirement), totalRequired: requirement.total ?? null, warning: null };
}

// 有沒有史料可以派生。
//
// 先前這裡驗證的是 `user.earnedCredits` 的物件形狀與 `user.completedCredits`
// 是不是有限數字——那套防禦存在的理由，是當時學分被獨立存成兩個欄位，
// 必須確認它們沒有壞掉。2026-08-11 起學分改由 `courseHistory` 當場算
// （見 `data/courseHistory.js`），`getEarnedCredits()` 對任何陣列都會回傳
// 合法形狀的結果（空陣列得到全 0），沒有「派生值壞掉」這種狀態需要防。
// 因此只需判斷有沒有可以派生的來源。
function hasCourseHistory(user) {
  return Array.isArray(user.courseHistory) && user.courseHistory.length > 0;
}

router.get('/:studentId', async (req, res) => {
  try {
    const { studentId } = req.params;

    // canonical identity 解析，學號與 numeric id 都認得。
    const identity = await resolveIdentity(studentId);
    if (!identity.found) {
      const { status, error } = identityErrorResponse(identity);
      return res.status(status).json({ error });
    }

    const users = await getAll('users');
    const user = users.find(item => String(item.studentId) === String(identity.canonicalId)) || {};

    // 系所以**排課使用的同一份 profile** 為準。
    //
    // 先前這裡讀的是 `users.json` 的 `user.department`，但排課讀的是
    // `User_Profiles`。同一位使用者的系所存在兩處，兩邊可以各自漂移——
    // 畢業進度與課表會依不同的系所計算而毫無跡象（稽核報告 F16）。
    // `getUserPreferences()` 是排課用的同一支，因此兩邊必然一致。
    const profile = await getUserPreferences(identity);

    // 畢業學分依系所而定，沒有全校通用的預設值。查不到對照時明確回報，
    // 不得用臆測的數字讓畫面看起來正常。
    const department = normalizeDepartment(profile?.department ?? user.department);
    const requirement = getGraduationRequirement(department);
    const warnings = [];

    const { required, totalRequired, warning: requirementWarning } = resolveRequiredCredits(requirement);
    if (requirementWarning) {
      warnings.push(requirementWarning);
    } else if (requirement.needsVerification) {
      // 對照表裡有這個系所，但抽取結果被標記為可疑、尚待人工複核——
      // 跟「查不到系所」是不同的情境，資料本身還是來自官方對照表，只是加註提醒。
      warnings.push(`「${department}」的畢業學分資料尚待人工複核，缺口僅供參考。`);
    }

    const courseHistoryAvailable = hasCourseHistory(user);
    const courseHistoryMessage = courseHistoryAvailable
      ? null
      : '缺少歷史修課資料，請至 MyFCU 擷取歷史修課資料並匯入。';
    // 已修學分由 `courseHistory` 當場算，不再讀獨立存的 `earnedCredits`／
    // `completedCredits`（2026-08-11 已從 `users.json` 移除）。
    // 兩支函式與排課共用同一份 `data/courseHistory.js`，因此畢業進度與
    // 排課的已修判定必然一致。
    const earned = courseHistoryAvailable ? getEarnedCredits(user.courseHistory) : null;
    const totalEarned = courseHistoryAvailable
      ? getTotalEarnedCredits(user.courseHistory)
      : null;
    // `required` 查不到系所時是 `null`（見 resolveRequiredCredits）；
    // 只看 courseHistoryAvailable 的話，「有修課歷史但系所查不到」會讓
    // Object.entries(null) 直接丟例外，把整支 route 打成 500。
    const gaps = courseHistoryAvailable && required
      ? Object.fromEntries(
        Object.entries(required).map(([key, value]) => [
          key,
          Math.max(0, Number(value || 0) - Number(earned[key] || 0)),
        ])
      )
      : null;
    // 已修排除改用跨學期穩定的課號，與排課引擎同一套判定。
    //
    // 先前這裡是 `new Set(user.completedCourseIds)` 比對 `course.id`：
    // `completedCourseIds` 恆為空陣列（歷史修課存的是課號，不是當學期 section id），
    // 所以這個排除從來沒有生效過，「建議補足系上課程」可能推薦一門已經修過
    // 並及格的課。`course.id` 也不是課程識別碼，而是「班級 + 課程」的組合。
    const passedCourseCodes = new Set(getPassedCourseCodes(user.courseHistory));
    const recommendations = [];

    // `course.department` 存的是**班級名稱**（`資訊三甲`），不是系所全名。
    // 先前這裡直接用 `course.department === user.department` 比對，等於拿
    // 「資訊三甲」比「資訊工程學系」，永遠不成立——這條建議從來沒出現過。
    // 判定方式與排課一致：解析班級名稱後比對系所。
    const departmentCourses = courseHistoryAvailable
      ? (await getAll('courses')).filter(course =>
        parseClassName(course.department).department === department
        && !passedCourseCodes.has(course.catalogCourseCode)
      )
      : [];

    if (courseHistoryAvailable && departmentCourses.length > 0) {
      recommendations.push({
        type: 'suggestion',
        title: '建議補足系上課程',
        message: `可優先查看 ${departmentCourses[0].name}。`,
        course: departmentCourses[0],
      });
    }

    res.json({
      department,
      courseHistoryAvailable,
      courseHistoryMessage,
      totalRequired,
      totalEarned,
      required,
      earned,
      gaps,
      warnings,
      recommendations,
      watchlist: user.watchlist || [],
      skillTree: user.skillTree || [],
      overallScore: user.overallScore || 0,
      overallScoreMax: user.overallScoreMax || 100,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
