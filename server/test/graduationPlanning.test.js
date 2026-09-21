import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildGraduationPlanning,
  inferRemainingSemesters,
} from '../src/data/graduationPlanning.js';
import { buildBreadthSequence, generateSchedule } from '../src/skills/scheduler.js';
import { buildDiverseScheduleMip } from '../src/skills/optimization/scheduleMipModel.js';
import { makeCourse } from './fixtures.js';

function history(creditsByCategory) {
  let index = 0;
  return Object.entries(creditsByCategory).flatMap(([graduationCategory, credits]) => (
    Array.from({ length: credits }, () => ({
      courseCode: `H${index += 1}`,
      courseName: `歷史課程${index}`,
      academicYear: 113,
      semester: 1,
      credits: 1,
      score: 80,
      letterGrade: 'A',
      passed: true,
      requirementType: graduationCategory === 'required' ? '必修' : '選修',
      generalEducationCategory: null,
      graduationCategory,
    }))
  ));
}

test('大四下預設把目前學期算進去，因此剩餘一學期', () => {
  assert.deepEqual(
    inferRemainingSemesters({ gradeLevel: 4 }, { semester: '下學期' }),
    { value: 1, source: 'grade-and-active-term' }
  );
});

test('明確設定的剩餘學期優先於年級推算', () => {
  assert.deepEqual(
    inferRemainingSemesters({ gradeLevel: 4, remainingSemesters: 3 }, { semester: '下學期' }),
    { value: 3, source: 'profile' }
  );
});

test('歷史修課產生每學期選修／通識／系外目標', () => {
  const planning = buildGraduationPlanning({
    department: '資訊工程學系',
    admissionYear: 112,
    gradeLevel: 4,
    remainingSemesters: 1,
    courseHistory: history({ required: 61, elective: 22, general: 24, external: 11 }),
  });
  assert.equal(planning.enabled, true);
  assert.deepEqual(planning.gaps, {
    required: 2, elective: 6, general: 4, external: 0, unspecified: 0,
  });
  assert.deepEqual(planning.semesterTargets, { elective: 6, general: 4, external: 0 });
  assert.deepEqual(buildBreadthSequence(planning), ['general', 'general']);
});

test('greedy 先排必修，再以 6 學分選修與兩門通識停止，不填滿 25 學分', () => {
  const planning = {
    enabled: true,
    ruleVersion: '114',
    appliedFallbackVersion: false,
    remainingSemesters: 1,
    remainingSemestersSource: 'profile',
    gaps: { required: 2, elective: 6, general: 4, external: 0, unspecified: 0 },
    semesterTargets: { elective: 6, general: 4, external: 0 },
    warnings: [],
  };
  const courses = [
    makeCourse(1, { name: '當學期必修', catalogCourseCode: 'R1', category: '必修', department: '資訊四合', credits: 2, dayOfWeek: 1 }),
    ...Array.from({ length: 5 }, (_, index) => makeCourse(index + 10, {
      name: `本系選修${index + 1}`,
      catalogCourseCode: `E${index + 1}`,
      category: '選修',
      department: '資訊四合',
      credits: 3,
      dayOfWeek: index + 1,
      startPeriod: 3,
      endPeriod: 4,
    })),
    ...[
      ['IINE2832', '世界經濟論壇－曾經滄海：幾個世界經濟的“POINTS OF NO RETURN＂'],
      ['IINE2833', '世界經濟論壇（英語授課）－TURNING POINTS OF WORLD-ECONOMY'],
      ['HSS1007', '台灣考古學與原住民'],
    ].map(([catalogCourseCode, name], index) => makeCourse(index + 30, {
      name,
      catalogCourseCode,
      category: '選修',
      department: '世界格局與歷史地理視野',
      credits: 2,
      year: 114,
      semester: '下學期',
      dayOfWeek: index + 1,
      startPeriod: 8,
      endPeriod: 9,
    })),
  ];
  const result = generateSchedule(courses, {
    department: '資訊工程學系', gradeLevel: 4, className: '資訊四合',
    minCredits: 9, maxCredits: 25, graduationPlanning: planning,
  }, { planSet: 'primary-only', includeMipInputs: true });

  const selected = result.graduationPlanning.selected;
  assert.equal(selected.required.courses, 1);
  assert.equal(selected.elective.courses, 2);
  assert.equal(selected.elective.credits, 6);
  assert.equal(selected.general.courses, 2);
  assert.equal(result.totalCredits, 12);
  assert.ok(result.totalCredits < 25);

  const model = buildDiverseScheduleMip(result.mipInputs, {
    creditTarget: result.totalCredits,
    baselineUtility: 0,
    qualityScale: 1,
    qualityLossLimit: 1,
    objective: 'quality',
  });
  assert.equal(model.status, 'ready');
  const categoryRows = model.rows.filter(row => row.meta.type === 'graduation-category-parity');
  assert.deepEqual(
    categoryRows.map(row => [row.meta.bucket, row.meta.bound]),
    [['elective', 2], ['general', 2]]
  );
});

test('通識候選不足時保留缺口，不用更多本系選修補滿最低學分', () => {
  const planning = {
    enabled: true,
    ruleVersion: '114',
    appliedFallbackVersion: false,
    remainingSemesters: 1,
    remainingSemestersSource: 'profile',
    gaps: { required: 0, elective: 6, general: 4, external: 0, unspecified: 0 },
    semesterTargets: { elective: 6, general: 4, external: 0 },
    warnings: [],
  };
  const courses = Array.from({ length: 5 }, (_, index) => makeCourse(index + 100, {
    name: `本系選修${index + 1}`,
    catalogCourseCode: `ONLY-E${index + 1}`,
    category: '選修',
    department: '資訊四合',
    credits: 3,
    dayOfWeek: index + 1,
    startPeriod: 3,
    endPeriod: 4,
  }));

  const result = generateSchedule(courses, {
    department: '資訊工程學系', gradeLevel: 4, className: '資訊四合',
    minCredits: 9, maxCredits: 25, graduationPlanning: planning,
  }, { planSet: 'primary-only' });

  assert.equal(result.totalCredits, 6);
  assert.equal(result.graduationPlanning.selected.elective.courses, 2);
  assert.equal(result.graduationPlanning.selected.general.courses, 0);
  assert.equal(result.solver.repairAttempted, false);
  assert.ok(result.warnings.some(message => message.includes('通識缺少可排入課程')));
});
