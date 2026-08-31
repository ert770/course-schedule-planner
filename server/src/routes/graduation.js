import { Router } from 'express';
import { getAll } from '../db/database.js';
import { resolveGraduationRule } from '../data/graduationRuleVersions.js';
import { normalizeDepartment } from '../utils/text.js';
import { parseClassName, buildStudentScope } from '../skills/courseScope.js';
import { annotateCourseCategory } from '../skills/courseCategory.js';
import { countsTowardGraduation } from '../data/generalEducation.js';
import { getUserPreferences } from '../services/memoryService.js';
import { requireIdentity } from '../middleware/requireIdentity.js';
import { requireServiceConsent } from '../middleware/requireConsent.js';
import {
  getPassedCourseCodes,
  getEarnedCredits,
  getEarnedCreditsAttribution,
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
function hasCourseHistory(profile) {
  return Array.isArray(profile.courseHistory) && profile.courseHistory.length > 0;
}

// 課程類別 → 畢業學分缺口分類。
//
// `annotateCourseCategory()` 回傳的是**修課視角**的類別（核心選修／一般選修分開，
// 因為排課優先度不同）；畢業學分只認「本系選修」一格，兩者在此收斂。
const CATEGORY_TO_GAP = new Map([
  ['必修', 'required'],
  ['核心選修', 'elective'],
  ['一般選修', 'elective'],
  // 未被資工必選修科目表細分的選修：`classifyCsCourse()` 依**課名**比對，比對不到
  // 就退回 MySQL 原始的 `選修`。實測資訊工程學系 119 門候選中有 11 門是這種
  // （高等資訊安全、影像處理、資訊保密與安全…），它們確實是本系開的選修課，
  // 漏掉這一行會讓它們永遠不被推薦。細不細分是課程地圖的涵蓋度問題，
  // 不是「這門課算不算本系選修」的問題。
  ['選修', 'elective'],
  ['系外選修', 'external'],
  ['通識', 'general'],
]);

const GAP_LABELS = {
  required: '本系必修',
  elective: '本系選修',
  general: '通識',
  external: '外系選修',
  unspecified: '自由選修',
};

// 補學分推薦：只推**真的補得上某個缺口**的課。
//
// 先前這裡是 `departmentCourses[0]`——沒有排序、沒有排除不計入畢業學分的課，
// 也沒有比對缺口。實測結果是資訊工程學系 119 門候選裡第一門就是 0 學分的
// `班級活動`（`GEID0010`），它補不了任何缺口，前端還會把它標成「通識推薦」，
// 而它的真實分類是必修。roadmap #23 的驗收標準「推薦補學分課程前，先驗證課程
// 能補足指定 gap」因此明確未通過。
//
// 抽成純函式（比照同檔的 `resolveRequiredCredits()`）：專案沒有 supertest，
// 這樣才測得到，不必啟動整個 Express app。
export function buildCreditRecommendations({
  courses = [],
  scope = null,
  gaps = null,
  passedCourseCodes = new Set(),
  rule = null,
  limit = 3,
} = {}) {
  // 缺口算不出來（系所查不到或沒有修課歷史）時不推薦——沒有缺口就無從驗證
  // 「這門課補得上」，硬推等於回到舊行為。
  if (!gaps) return [];

  const candidates = [];

  for (const course of courses) {
    // 已修過並通過的課不再推薦。
    if (passedCourseCodes.has(course.catalogCourseCode)) continue;
    // 不計入畢業學分的課（班級活動／體育／國防科技）補不了任何缺口。
    // 沿用既有判定，不自己另寫 0 學分規則——`LAND2012P` 那類 1 學分實習
    // 已經證明學分數不是可靠判準。
    if (!countsTowardGraduation(course)) continue;

    const annotated = annotateCourseCategory(course, scope);
    // 資格未確認的課（#13B 的 B～F 類）不主動推薦：不能一邊說「資格待確認」
    // 一邊叫使用者去修。
    if (annotated.eligibility === 'ineligible' || annotated.eligibility === 'unknown') continue;

    const gapKey = CATEGORY_TO_GAP.get(annotated.category);
    if (!gapKey) continue;

    const gapBefore = Number(gaps[gapKey] || 0);
    if (gapBefore <= 0) continue;

    const credits = Number(course.credits) || 0;
    if (credits <= 0) continue;

    candidates.push({ course: annotated, gapKey, gapBefore, credits });
  }

  // 明確的排序規則，不再依賴陣列原始順序：缺口大的分類優先 → 學分高者優先 →
  // 課號穩定排序（同分時每次結果一致，測試才釘得住）。
  candidates.sort((left, right) =>
    right.gapBefore - left.gapBefore
    || right.credits - left.credits
    || String(left.course.catalogCourseCode).localeCompare(String(right.course.catalogCourseCode))
  );

  // 一門課開多個班次時只推薦一次。
  //
  // 候選來自 `Course_Sections`，同一個 `catalogCourseCode` 可能有好幾個班次
  // （實測「系統分析與設計」在資訊工程學系底下就有兩個），對「你還缺 6 學分
  // 本系選修」這件事而言它們是同一個答案，列兩次只是佔掉推薦名額。
  // 判定用 `catalogCourseCode`，與本 route 既有的已修排除同一個鍵。
  const seen = new Set();
  const unique = candidates.filter(({ course }) => {
    const key = String(course.catalogCourseCode || '').trim() || `id:${course.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return unique.slice(0, limit).map(({ course, gapKey, gapBefore, credits }) => ({
    type: 'suggestion',
    title: `補足${GAP_LABELS[gapKey]}`,
    message: `${course.name}（${credits} 學分）可計入${GAP_LABELS[gapKey]}，`
      + `目前尚缺 ${gapBefore} 學分。`,
    course,
    // 讓前端不必再猜這是哪一類推薦——先前它把所有非 warning 的推薦
    // 一律寫死顯示「通識推薦」。
    fillsGap: gapKey,
    gapLabel: GAP_LABELS[gapKey],
    gapBefore,
    credits,
    ruleVersion: rule?.ruleVersion ?? null,
    ruleSource: rule?.ruleSource ?? null,
  }));
}

async function handleGraduation(req, res) {
  try {
    const identity = req.identity;

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

    // 依 `program + degree + admissionYear` 解析適用的規則版本（Roadmap #23）。
    // 入學年度未知，或該學年度的科目表尚未取得時，`appliedFallbackVersion` 為 true，
    // 並附上說明——不假裝套用的就是該學生入學年度的規則。
    const rule = resolveGraduationRule({
      program: department,
      admissionYear: profile?.admissionYear ?? null,
    });
    const requirement = rule.requirement;
    const warnings = [];

    const { required, totalRequired, warning: requirementWarning } = resolveRequiredCredits(requirement);
    if (requirementWarning) {
      warnings.push(requirementWarning);
    } else if (requirement.needsVerification) {
      // 對照表裡有這個系所，但抽取結果被標記為可疑、尚待人工複核——
      // 跟「查不到系所」是不同的情境，資料本身還是來自官方對照表，只是加註提醒。
      warnings.push(`「${department}」的畢業學分資料尚待人工複核，缺口僅供參考。`);
    }

    // 規則版本退回預設時要說出來。這是 #23 的核心誠實要求：目前只有 114 學年度
    // 一版真實資料，套用在 112／113 入學生身上時使用者必須看得到這件事。
    if (rule.appliedFallbackVersion && rule.fallbackReason) {
      warnings.push(rule.fallbackReason);
    }

    const courseHistoryAvailable = hasCourseHistory(profile);
    const courseHistoryMessage = courseHistoryAvailable
      ? null
      : '缺少歷史修課資料，請至 MyFCU 擷取歷史修課資料並匯入。';
    // 已修學分由 `courseHistory` 當場算，不再讀獨立存的 `earnedCredits`／
    // `completedCredits`（2026-08-11 已從 `users.json` 移除）。
    // 兩支函式與排課共用同一份 `data/courseHistory.js`，因此畢業進度與
    // 排課的已修判定必然一致。
    const earned = courseHistoryAvailable ? getEarnedCredits(profile.courseHistory) : null;
    const totalEarned = courseHistoryAvailable
      ? getTotalEarnedCredits(profile.courseHistory)
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
    const passedCourseCodes = new Set(getPassedCourseCodes(profile.courseHistory));

    // 「這些學分是哪些課湊出來的」。與 `getEarnedCredits()` 共用同一組篩選，
    // 各分類總和恆等於上面的 `earned`（由 G10 測試釘住）。
    const attribution = courseHistoryAvailable
      ? getEarnedCreditsAttribution(profile.courseHistory, rule)
      : null;

    // `course.department` 存的是**班級名稱**（`資訊三甲`），不是系所全名。
    // 先前這裡直接用 `course.department === user.department` 比對，等於拿
    // 「資訊三甲」比「資訊工程學系」，永遠不成立——這條建議從來沒出現過。
    // 判定方式與排課一致：解析班級名稱後比對系所。
    const departmentCourses = courseHistoryAvailable
      ? (await getAll('courses')).filter(course =>
        parseClassName(course.department).department === department
      )
      : [];

    const recommendations = buildCreditRecommendations({
      courses: departmentCourses,
      scope: buildStudentScope(profile),
      gaps,
      passedCourseCodes,
      rule,
    });

    res.json({
      department,
      courseHistoryAvailable,
      courseHistoryMessage,
      totalRequired,
      totalEarned,
      required,
      earned,
      gaps,
      // 逐門認列追溯：每一筆帶課號、學分、修課學期、規則版本與出處。
      attribution,
      // 這次用的是哪一版規則、從哪來、是不是退回了預設版本。
      ruleVersion: rule.ruleVersion,
      ruleSource: rule.ruleSource,
      ruleCoverage: rule.coverage,
      appliedFallbackVersion: rule.appliedFallbackVersion,
      admissionYear: rule.admissionYear,
      warnings,
      recommendations,
      watchlist: user.watchlist || [],
      skillTree: user.skillTree || [],
      overallScore: user.overallScore || 0,
      overallScoreMax: user.overallScoreMax || 100,
    });
  } catch (err) {
    res.status(err.status || 500).json({
      error: err.message,
      ...(err.code ? { code: err.code } : {}),
    });
  }
}

router.get('/me', requireIdentity, requireServiceConsent, handleGraduation);
router.get('/:studentId', requireIdentity, requireServiceConsent, handleGraduation);

export default router;
