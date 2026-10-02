// Roadmap #10：唯讀 benchmark 共用的 demo persona 案例載入。
//
// 由 `planDiversityAcceptanceReport.js` 抽出，`highsSpike.js` 共用同一份，
// 確保兩者量測的是同一批候選池。只執行 SELECT，不寫事件、不寫學習權重。

import { ACTIVE_TERM } from '../../src/data/activeTerm.js';
import { getFailedRequiredCourseCodes } from '../../src/data/courseHistory.js';
import { demoPersonaCanonicalId } from '../../src/data/demoPersonas.js';
import { buildGraduationPlanning } from '../../src/data/graduationPlanning.js';
import { buildScheduleConstraints } from '../../src/services/constraintService.js';
import { buildStudentScope } from '../../src/skills/courseScope.js';
import { searchCoursesForSchedule } from '../../src/skills/courseQuery.js';
import {
  computeLearnedBoosts,
  learnPreferenceWeights,
  SUFFICIENCY_STATUS,
} from '../../src/skills/preferenceLearning.js';
import {
  getInteractionEventsForExport,
  hasPersonalizationConsent,
} from '../../src/services/interactionEventService.js';

// 與線上 `scheduleService.prepareGenerationInputs()` 組出同一份限制。
//
// 2026-10-02 之前 benchmark 各自呼叫 `buildScheduleConstraints()`，漏掉了線上會帶的
// `graduationPlanning`（依畢業缺口分配本學期課程）。結果是 benchmark 量到 25 學分、3 個方案，
// 同一位使用者在線上只有 5 學分、1 個方案——量的不是線上實際行為。集中在這裡組，
// 之後線上多帶一項 trusted context 時只需要改這一處。
export function buildCaseConstraints(input, prefs, { reviews, learnedPreference }) {
  return buildScheduleConstraints(input, prefs, {
    reviews,
    courseReviews: reviews,
    learnedPreference,
    graduationPlanning: buildGraduationPlanning(prefs, ACTIVE_TERM),
  });
}

export const CASE_IDS = Object.freeze([
  'persona-compact',
  'persona-challenge',
  'persona-easy',
]);

export function identityFor(persona) {
  return {
    canonicalId: demoPersonaCanonicalId(persona),
    numericId: String(persona.userId),
    studentId: persona.studentId ?? null,
  };
}

function explicitLearningProfile(prefs) {
  return {
    interest: 0,
    compact: prefs?.preferCompact ? 1 : 0,
    easy: 0,
  };
}

export function absentLearnedPreference(reason) {
  return {
    applied: false,
    reason,
    boosts: null,
    modelVersion: null,
    computedAt: null,
    sufficiency: null,
  };
}

export async function deriveLearnedPreferenceReadOnly(identity, prefs, evaluationTime) {
  if (!await hasPersonalizationConsent(identity)) {
    return absentLearnedPreference('no-consent');
  }

  const events = await getInteractionEventsForExport(identity);
  const explicitProfile = explicitLearningProfile(prefs);
  const learned = learnPreferenceWeights(events, {
    explicitProfile,
    now: evaluationTime,
    activeTerm: ACTIVE_TERM,
  });
  if (learned.sufficiency.status !== SUFFICIENCY_STATUS.SUFFICIENT) {
    return {
      ...absentLearnedPreference('insufficient'),
      modelVersion: learned.modelVersion,
      sufficiency: learned.sufficiency,
    };
  }

  return {
    applied: true,
    reason: 'applied-read-only-recompute',
    boosts: computeLearnedBoosts(learned.weights, explicitProfile),
    modelVersion: learned.modelVersion,
    computedAt: evaluationTime.toISOString(),
    sufficiency: learned.sufficiency,
  };
}

export function withoutAxisPreferences(prefs) {
  return {
    ...prefs,
    preferCompact: false,
    preferEasy: false,
    preferEasyCourses: false,
    preferChallengingCourses: false,
    preferredTrack: null,
    preferredKeywords: [],
    interests: [],
  };
}

export async function buildCandidates(constraints, allCourses) {
  const scope = buildStudentScope(constraints);
  const candidates = await searchCoursesForSchedule({}, scope);
  const failedRequiredCodes = new Set(getFailedRequiredCourseCodes(constraints.courseHistory));
  const seen = new Set(candidates.map(course => String(course.id)));

  for (const course of allCourses) {
    if (
      failedRequiredCodes.has(course.catalogCourseCode)
      && !seen.has(String(course.id))
    ) {
      candidates.push(course);
      seen.add(String(course.id));
    }
  }
  return candidates;
}

// 真實課程資料上的固定課控制組：二年級資工甲班會由 scope 推導本人必修；
// 另用一筆不及格的一年級必修（二年級可重補修；三年級課會被年級規則排除）產生重補修，
// 再指定一門不衝堂的系選修。
export function buildFixedCoursesControl(allCourses) {
  const explicit = allCourses.find(course => (
    course.catalogCourseCode === 'IECS2072'
    && course.department === '資訊二合'
    && Number(course.dayOfWeek) === 3
    && Number(course.startPeriod) === 3
  ));
  const retry = allCourses.find(course => (
    course.catalogCourseCode === 'IECS1008'
    && course.department === '資訊一甲'
  ));
  if (!explicit || !retry) {
    throw new Error('fixed-courses-control 找不到 IECS2072 指定課或 IECS1008 重補修課');
  }

  return {
    prefs: {
      department: '資訊工程學系',
      gradeLevel: 2,
      className: '資訊二甲',
      targetCreditsMin: 12,
      targetCreditsMax: 25,
      interests: ['人工智慧', '資料科學'],
      courseHistory: [{
        academicYear: 114,
        semester: 2,
        courseCode: retry.catalogCourseCode,
        courseName: retry.name,
        score: 40,
        credits: Number(retry.credits) || 3,
        passed: false,
        requirementType: '必修',
      }],
      mustTakeCourses: [Number(explicit.id)],
    },
    // 每日上限 5：週一已有 4 門固定課，重補修的資訊一合班（週一 11-12 節）剛好排得進去，
    // 其他日子的上限仍會約束 MILP，保留「每日上限含固定課」的驗證路徑。
    input: { maxCoursesPerDay: 5 },
    expected: {
      explicitSectionId: Number(explicit.id),
      retryCourseCode: retry.catalogCourseCode,
      className: '資訊二甲',
    },
  };
}
