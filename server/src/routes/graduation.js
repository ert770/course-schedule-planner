import { Router } from 'express';
import { getAll } from '../db/database.js';
import { getGraduationRequirement } from '../data/graduationRequirements.js';
import { normalizeDepartment } from '../utils/text.js';
import { parseClassName } from '../skills/courseScope.js';

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

function getEmptyCredits() {
  return { required: 0, elective: 0, general: 0, external: 0, unspecified: 0 };
}

function getDefaultEarnedCredits(user) {
  return user.earnedCredits || getEmptyCredits();
}

router.get('/:studentId', async (req, res) => {
  try {
    const { studentId } = req.params;
    const users = await getAll('users');
    const userProfiles = await getAll('user_preferences');
    const user = users.find(item => String(item.studentId) === String(studentId))
      || userProfiles.find(item => String(item.userId) === String(studentId));

    if (!user) {
      return res.status(404).json({ error: '找不到使用者' });
    }

    // 系所以**排課使用的同一份 profile** 為準。
    //
    // 先前這裡讀的是 `users.json` 的 `user.department`，但排課讀的是
    // `user_preferences`／`User_Profiles`。同一位使用者的系所存在兩處，
    // 兩邊可以各自漂移——畢業進度與課表會依不同的系所計算而毫無跡象（稽核報告 F16）。
    const profile = userProfiles.find(item => String(item.userId) === String(studentId));

    // 畢業學分依系所而定，沒有全校通用的預設值。查不到對照時明確回報，
    // 不得用臆測的數字讓畫面看起來正常。
    const department = normalizeDepartment(profile?.department ?? user.department);
    const requirement = getGraduationRequirement(department);
    const warnings = [];

    if (!requirement) {
      warnings.push(`找不到「${department || '未設定系所'}」的畢業學分規定，無法計算學分缺口。`);
    } else if (requirement.needsVerification) {
      warnings.push(`「${department}」的畢業學分資料尚待人工複核，缺口僅供參考。`);
    }

    // 官方對照表優先於使用者資料上的 requiredCredits。
    // 反過來的話，舊資料裡捏造的數字（必修60／選修40／通識20／系外8）會蓋過官方值，
    // 而且完全沒有跡象——這正是這批數字能存活到現在的原因。
    // 使用者自帶的值只在查不到對照時作為後備。
    const required = requirement
      ? toCreditBreakdown(requirement)
      : (user.requiredCredits || getEmptyCredits());
    const earned = getDefaultEarnedCredits(user);
    const totalRequired = requirement?.total ?? user.totalRequired ?? null;
    const totalEarned = Number(user.completedCredits || 0);
    const gaps = Object.fromEntries(
      Object.entries(required).map(([key, value]) => [
        key,
        Math.max(0, Number(value || 0) - Number(earned[key] || 0)),
      ])
    );
    const courses = await getAll('courses');
    const completedCourseIds = new Set((user.completedCourseIds || []).map(String));
    const recommendations = [];

    // `course.department` 存的是**班級名稱**（`資訊三甲`），不是系所全名。
    // 先前這裡直接用 `course.department === user.department` 比對，等於拿
    // 「資訊三甲」比「資訊工程學系」，永遠不成立——這條建議從來沒出現過。
    // 判定方式與排課一致：解析班級名稱後比對系所。
    const departmentCourses = courses.filter(course =>
      parseClassName(course.department).department === department
      && !completedCourseIds.has(String(course.id))
    );

    if (departmentCourses.length > 0) {
      recommendations.push({
        type: 'suggestion',
        title: '建議補足系上課程',
        message: `可優先查看 ${departmentCourses[0].name}。`,
        course: departmentCourses[0],
      });
    }

    res.json({
      department,
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
