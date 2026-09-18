import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  normalizeCourseGradeLevel,
  courseGradeLevelLabel,
  isCourseGradeEligible,
} from '../src/data/courseGradeLevel.js';
import { filterCategorizedCourses } from '../src/skills/courseQuery.js';
import { buildCourseQueryScope } from '../src/skills/courseScope.js';
import { generateSchedule } from '../src/skills/scheduler.js';

describe('Courses.target_grade → course.gradeLevel', () => {
  test('只接受 0～5，0 不是缺值', () => {
    assert.equal(normalizeCourseGradeLevel(0), 0);
    assert.equal(normalizeCourseGradeLevel('5'), 5);
    assert.equal(normalizeCourseGradeLevel(6), null);
    assert.equal(normalizeCourseGradeLevel(null), null);
  });

  test('0 全年級可修，1～4精確比對，5涵蓋研究所', () => {
    assert.equal(isCourseGradeEligible({ gradeLevel: 0 }, 3), true);
    assert.equal(isCourseGradeEligible({ gradeLevel: 3 }, 3), true);
    assert.equal(isCourseGradeEligible({ gradeLevel: 2 }, 3), false);
    assert.equal(isCourseGradeEligible({ gradeLevel: 5 }, 5), true);
    assert.equal(courseGradeLevelLabel(5), '研究所');
  });

  test('課程搜尋排除年級不符，保留全年級課程', () => {
    const scope = buildCourseQueryScope({
      department: '資訊工程學系', gradeLevel: 3, className: '甲',
    });
    const result = filterCategorizedCourses([
      { id: 1, name: '全年級', department: '資訊三甲', category: '必修', gradeLevel: 0 },
      { id: 2, name: '大三', department: '資訊三甲', category: '必修', gradeLevel: 3 },
      { id: 3, name: '大二', department: '資訊三甲', category: '必修', gradeLevel: 2 },
    ], {}, scope);
    assert.deepEqual(result.map(course => course.id), [1, 2]);
  });

  test('scheduler 對直接指定的候選也執行同一個年級閘門（同系選修除外）', () => {
    const result = generateSchedule([
      {
        id: 11, name: '全年級選修', department: '資訊三甲', category: '選修',
        gradeLevel: 0, credits: 3, dayOfWeek: 1, startPeriod: 2, endPeriod: 3,
      },
      {
        id: 12, name: '外系大二選修', department: '電機二甲', category: '選修',
        gradeLevel: 2, credits: 3, dayOfWeek: 2, startPeriod: 2, endPeriod: 3,
      },
      {
        id: 13, name: '本系大二選修', department: '資訊二合', category: '選修',
        gradeLevel: 2, credits: 3, dayOfWeek: 3, startPeriod: 2, endPeriod: 3,
      },
    ], {
      department: '資訊工程學系', gradeLevel: 3, className: '資訊三甲', minCredits: 0,
    });

    assert.equal(result.schedule.some(course => course.id === 11), true);
    // 外系的年級不符照舊排除。
    assert.equal(result.schedule.some(course => course.id === 12), false);
    assert.equal(
      result.excludedCourses.some(item => item.course.id === 12 && item.constraintId === 'COURSE_GRADE_MISMATCH'),
      true
    );
    // #13C-5：同系其他年級的選修可以修（排序在後，見 scheduler.test.js 的 CY 系列）。
    assert.equal(result.schedule.some(course => course.id === 13), true);
    assert.equal(
      result.excludedCourses.some(item => item.course.id === 13 && item.constraintId === 'COURSE_GRADE_MISMATCH'),
      false
    );
  });
});
