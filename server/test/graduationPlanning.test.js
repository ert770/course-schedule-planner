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

// 2026-10-02 規則變更：配額決定先排什麼，最低學分仍是下限。原本這條斷言的是
// 「停在 6 學分、不補」；現在通識缺口仍照實警告，但會補到最低 9 學分。
test('通識候選不足時仍警告缺口，並補到最低學分為止', () => {
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

  assert.equal(result.totalCredits, 9);
  assert.equal(result.graduationPlanning.selected.elective.courses, 3);
  assert.equal(result.graduationPlanning.selected.general.courses, 0);
  assert.equal(result.solver.repairAttempted, false);
  assert.ok(result.warnings.some(message => message.includes('通識缺少可排入課程')));
  // 補的那一門要標出來，而且補到下限就停，不會一路填到 25。
  assert.equal(result.graduationPlanning.creditFloorTopUp.courses, 1);
  assert.equal(result.graduationPlanning.creditFloorTopUp.credits, 3);
  assert.ok(result.warnings.some(message => message.includes('為達最低 9 學分')));
});

// 快畢業的學生：缺口分攤到剩餘學期後，本學期目標只有幾學分。只照配額排會低於
// 最低學分（真實帳號曾只排出 5 學分、替代方案全部無解）。
function nearGraduationPlanning() {
  return {
    enabled: true,
    ruleVersion: '114',
    appliedFallbackVersion: false,
    remainingSemesters: 3,
    remainingSemestersSource: 'grade-and-active-term',
    gaps: { required: 0, elective: 6, general: 4, external: 0, unspecified: 0 },
    semesterTargets: { elective: 2, general: 4 / 3, external: 0 },
    warnings: [],
  };
}

function nearGraduationCourses() {
  const electives = Array.from({ length: 4 }, (_, index) => makeCourse(index + 200, {
    name: `本系選修${index + 1}`, catalogCourseCode: `NG-E${index + 1}`, category: '選修',
    department: '資訊三乙', credits: 3, dayOfWeek: index + 1, startPeriod: 3, endPeriod: 4,
  }));
  // 通識的分類來自官方認抵表，必須用真的課號與領域名稱才會被認成通識。
  const generals = [
    ['IINE2832', '世界經濟論壇－曾經滄海：幾個世界經濟的“POINTS OF NO RETURN＂'],
    ['IINE2833', '世界經濟論壇（英語授課）－TURNING POINTS OF WORLD-ECONOMY'],
    ['HSS1007', '台灣考古學與原住民'],
  ].map(([catalogCourseCode, name], index) => makeCourse(index + 300, {
    name, catalogCourseCode, category: '選修', department: '世界格局與歷史地理視野',
    credits: 2, year: 114, semester: '下學期', dayOfWeek: index + 1, startPeriod: 6, endPeriod: 7,
  }));
  const outside = Array.from({ length: 3 }, (_, index) => makeCourse(index + 400, {
    name: `系外選修${index + 1}`, catalogCourseCode: `NG-X${index + 1}`, category: '系外選修',
    department: '企管三甲', credits: 3, dayOfWeek: index + 1, startPeriod: 8, endPeriod: 9,
  }));
  return [...electives, ...generals, ...outside];
}

const NEAR_GRADUATION_STUDENT = { department: '資訊工程學系', gradeLevel: 3, className: '資訊三乙' };

test('畢業配額低於最低學分時補到下限，且只從缺口未補完的類別補', () => {
  const result = generateSchedule(nearGraduationCourses(), {
    ...NEAR_GRADUATION_STUDENT,
    minCredits: 12, maxCredits: 25, graduationPlanning: nearGraduationPlanning(),
  }, { planSet: 'primary-only' });
  const { selected, creditFloorTopUp } = result.graduationPlanning;

  assert.ok(result.totalCredits >= 12, `只排出 ${result.totalCredits} 學分`);
  // 補到下限就停：最後一門最多讓學分超過下限不到一門課的量。
  assert.ok(result.totalCredits < 12 + 3);
  // 系外缺口為 0，補課時不該拿系外選修來湊。
  assert.equal(selected.external.courses, 0);
  assert.ok(creditFloorTopUp.courses > 0);
  // 配額階段是 1 門選修（3）＋1 門通識（2），其餘都是補的。
  assert.equal(creditFloorTopUp.credits, result.totalCredits - 5);
});

test('配額本身已達最低學分時不進入補足階段', () => {
  const planning = {
    ...nearGraduationPlanning(),
    remainingSemesters: 1,
    semesterTargets: { elective: 6, general: 4, external: 0 },
  };
  const result = generateSchedule(nearGraduationCourses(), {
    ...NEAR_GRADUATION_STUDENT,
    minCredits: 9, maxCredits: 25, graduationPlanning: planning,
  }, { planSet: 'primary-only' });

  assert.equal(result.totalCredits, 10);
  assert.equal(result.graduationPlanning.creditFloorTopUp.courses, 0);
  assert.equal(result.warnings.some(message => message.includes('為達最低')), false);
});

test('缺口全部補完後仍不足時，退回任何排得進去的課', () => {
  const planning = {
    ...nearGraduationPlanning(),
    gaps: { required: 0, elective: 3, general: 2, external: 0, unspecified: 0 },
    semesterTargets: { elective: 3, general: 2, external: 0 },
  };
  const result = generateSchedule(nearGraduationCourses(), {
    ...NEAR_GRADUATION_STUDENT,
    minCredits: 12, maxCredits: 25, graduationPlanning: planning,
  }, { planSet: 'primary-only' });

  assert.ok(result.totalCredits >= 12);
  assert.ok(result.graduationPlanning.creditFloorTopUp.courses > 0);
});

// 規則：距離畢業門檻的總學分低於最低學分時，本學期就只排到最低學分。
// 這裡刻意讓類別缺口被高估（修課紀錄沒分類時的實況：選修缺 28、通識缺 16），
// 只照類別配額會排滿 3 門選修＋2 門通識；判斷必須看總學分，不看類別缺口。
function overestimatedPlanning(totalEarned) {
  return {
    ...nearGraduationPlanning(),
    remainingSemesters: 1,
    totalRequired: 128,
    totalEarned,
    gaps: { required: 0, elective: 28, general: 16, external: 0, unspecified: 0 },
    semesterTargets: { elective: 28, general: 16, external: 0 },
  };
}

test('距離畢業的總學分低於最低學分時，排到最低學分就停', () => {
  const result = generateSchedule(nearGraduationCourses(), {
    ...NEAR_GRADUATION_STUDENT,
    minCredits: 9, maxCredits: 25, graduationPlanning: overestimatedPlanning(126),
  }, { planSet: 'primary-only' });

  assert.equal(result.graduationPlanning.totalGap, 2);
  assert.equal(result.graduationPlanning.creditFloorOnly, true);
  assert.ok(result.totalCredits >= 9, `只排出 ${result.totalCredits} 學分`);
  // 達到下限就停：不會再照類別配額排到 3 門選修＋2 門通識（13 學分）。
  assert.ok(result.totalCredits < 9 + 3, `排到 ${result.totalCredits} 學分`);
});

test('距離畢業的總學分不低於最低學分時，照類別配額排', () => {
  const result = generateSchedule(nearGraduationCourses(), {
    ...NEAR_GRADUATION_STUDENT,
    minCredits: 9, maxCredits: 25, graduationPlanning: overestimatedPlanning(110),
  }, { planSet: 'primary-only' });

  assert.equal(result.graduationPlanning.totalGap, 18);
  assert.equal(result.graduationPlanning.creditFloorOnly, false);
  assert.equal(result.graduationPlanning.selected.elective.courses, 3);
  assert.equal(result.graduationPlanning.selected.general.courses, 2);
  assert.equal(result.totalCredits, 13);
});

test('沒有總學分資料時不套用這條規則', () => {
  const planning = { ...overestimatedPlanning(126), totalEarned: null };
  const result = generateSchedule(nearGraduationCourses(), {
    ...NEAR_GRADUATION_STUDENT,
    minCredits: 9, maxCredits: 25, graduationPlanning: planning,
  }, { planSet: 'primary-only' });

  assert.equal(result.graduationPlanning.totalGap, null);
  assert.equal(result.graduationPlanning.creditFloorOnly, false);
  assert.equal(result.totalCredits, 13);
});
