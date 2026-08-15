import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  annotateCourseCategory,
  buildScopeReason,
  refineOutsideElectiveScopeReason,
} from '../src/skills/courseCategory.js';
import { buildCourseQueryScope } from '../src/skills/courseScope.js';
import { makeCourse } from './fixtures.js';

const ACTIVE = { academicYear: 114, semester: '下學期', isActiveTerm: true };
const OFF_TERM = { academicYear: 113, semester: '上學期', isActiveTerm: false };

describe('#20 buildScopeReason：term 是最外層閘門', () => {
  test('非本學期時，不管類別或 eligibility 為何都優先回報開課學期', () => {
    const reason = buildScopeReason({
      term: OFF_TERM,
      category: '必修',
      eligibility: 'eligible',
      eligibilityReason: '本來會顯示的必修理由',
    });
    assert.match(reason, /113學年上學期開課，非本學期候選範圍/);
  });

  test('學年學期缺值時仍給出可讀文字，不拋例外', () => {
    const reason = buildScopeReason({
      term: { academicYear: null, semester: null, isActiveTerm: false },
      category: '選修',
      eligibility: 'eligible',
      eligibilityReason: '',
    });
    assert.match(reason, /未知學年未知學期開課/);
  });
});

describe('#20 buildScopeReason：本學期內的各類別', () => {
  test('eligibility=unknown 時原樣沿用 eligibilityReason', () => {
    const reason = buildScopeReason({
      term: ACTIVE,
      category: 'commonCurriculum',
      eligibility: 'unknown',
      eligibilityReason: 'B 類正式適用對象規則尚未確認。',
    });
    assert.equal(reason, 'B 類正式適用對象規則尚未確認。');
  });

  test('本人必修', () => {
    const reason = buildScopeReason({
      term: ACTIVE,
      category: '必修',
      eligibility: 'eligible',
      eligibilityReason: '班級系所、學制、年級及班別符合目前學生資料。',
    });
    assert.match(reason, /^本人必修：/);
  });

  test('他人必修，不可加選', () => {
    const reason = buildScopeReason({
      term: ACTIVE,
      category: '必修',
      eligibility: 'ineligible',
      eligibilityReason: '此為其他系所、學制、年級或班別的必修。',
    });
    assert.match(reason, /^他人必修，不可加選：/);
  });

  test('通識', () => {
    const reason = buildScopeReason({
      term: ACTIVE,
      category: '通識',
      eligibility: 'eligible',
      eligibilityReason: '',
    });
    assert.match(reason, /通識課程，可搜尋與加選/);
  });

  test('系外選修（尚未套用認列結果前的預設文字）', () => {
    const reason = buildScopeReason({
      term: ACTIVE,
      category: '系外選修',
      eligibility: 'eligible',
      eligibilityReason: '',
    });
    assert.match(reason, /系外選修，認列條件另行判定/);
  });

  test('一般選修（其餘情況的預設值）', () => {
    const reason = buildScopeReason({
      term: ACTIVE,
      category: '一般選修',
      eligibility: 'eligible',
      eligibilityReason: '',
    });
    assert.match(reason, /一般選修，可搜尋與加選/);
  });
});

describe('#20 refineOutsideElectiveScopeReason', () => {
  test('outside.checked 為 false 時回傳 null，呼叫端應保留原本 scopeReason', () => {
    assert.equal(refineOutsideElectiveScopeReason({ checked: false }), null);
    assert.equal(refineOutsideElectiveScopeReason(undefined), null);
  });

  test('不符合認列條件時說明不計入畢業學分並附第一條原因', () => {
    const reason = refineOutsideElectiveScopeReason({
      checked: true,
      eligible: false,
      reasons: ['進修部開設課程不認列為系外選修'],
    });
    assert.match(reason, /^系外選修不計入畢業學分：進修部開設課程不認列為系外選修$/);
  });

  test('符合認列條件但仍須系辦確認', () => {
    const reason = refineOutsideElectiveScopeReason({
      checked: true,
      eligible: true,
      needsOfficeConfirmation: true,
    });
    assert.match(reason, /惟依規定仍須向系辦公室確認/);
  });

  test('符合認列條件且不需額外確認', () => {
    const reason = refineOutsideElectiveScopeReason({
      checked: true,
      eligible: true,
      needsOfficeConfirmation: false,
    });
    assert.match(reason, /符合認列條件，可加選並計入畢業學分/);
  });
});

describe('#20 annotateCourseCategory：term／scopeReason 附加到候選課程', () => {
  const scope = buildCourseQueryScope({ department: '資訊工程學系', grade: 3, className: '乙' });

  test('本學期候選課程帶有 term.isActiveTerm 為 true', () => {
    const course = annotateCourseCategory(
      makeCourse(1, { department: '資訊三乙', category: '必修', year: 114, semester: '下學期' }),
      scope
    );
    assert.deepEqual(course.term, { academicYear: 114, semester: '下學期', isActiveTerm: true });
    assert.match(course.scopeReason, /^本人必修：/);
  });

  test('非本學期候選課程帶有 term.isActiveTerm 為 false，scopeReason 說明開課學期', () => {
    const course = annotateCourseCategory(
      makeCourse(2, { department: '資訊三乙', category: '必修', year: 113, semester: '上學期' }),
      scope
    );
    assert.equal(course.term.isActiveTerm, false);
    assert.match(course.scopeReason, /113學年上學期開課，非本學期候選範圍/);
  });

  test('未標註學年學期的候選課程視為本學期（相容既有無 term 資料的情境）', () => {
    const course = annotateCourseCategory(makeCourse(3, { department: '資訊三乙' }), scope);
    assert.equal(course.term.isActiveTerm, true);
  });
});
