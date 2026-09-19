// Roadmap #10：唯讀 benchmark 共用的 demo persona 案例載入。
//
// 由 `planDiversityAcceptanceReport.js` 抽出，`highsSpike.js` 共用同一份，
// 確保兩者量測的是同一批候選池。只執行 SELECT，不寫事件、不寫學習權重。

import { ACTIVE_TERM } from '../../src/data/activeTerm.js';
import { getFailedRequiredCourseCodes } from '../../src/data/courseHistory.js';
import { demoPersonaCanonicalId } from '../../src/data/demoPersonas.js';
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
