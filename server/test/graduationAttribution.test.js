// Roadmap #23：逐門認列追溯與補學分推薦。
//
// 兩組性質分開測：
//   G10-G12 追溯——「這 61 學分是哪些課湊出來的」必須恆等於既有的學分計算，
//           不得長成第二套算法（`completedCredits` 就是這樣長出來又漂移的）。
//   G13-G16 推薦——只推真的補得上缺口的課。改動前實測第一名是 0 學分的「班級活動」。

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  ATTRIBUTION_SOURCE_COURSE_HISTORY,
  getEarnedCredits,
  getEarnedCreditsAttribution,
} from '../src/data/courseHistory.js';
import { buildCreditRecommendations } from '../src/routes/graduation.js';
import { resolveGraduationRule } from '../src/data/graduationRuleVersions.js';
import { reconcileAdmissionYear } from '../src/data/admissionYear.js';
import { buildStudentScope } from '../src/skills/courseScope.js';
import { sanitizeProfileScopeArgs } from '../src/services/agentService.js';

function entry(overrides = {}) {
  return {
    academicYear: 113,
    semester: 1,
    courseCode: 'IECS3002',
    courseName: '資料結構',
    score: 88,
    letterGrade: 'A',
    credits: 3,
    passed: true,
    requirementType: '必修',
    generalEducationCategory: null,
    graduationCategory: 'required',
    ...overrides,
  };
}

// 重建 demo 帳號的分類分佈（實測 MySQL：required 61／elective 22／general 24／
// external 11，另有 3 筆 nonGraduation 不計入，共 53 筆、118 學分）。
function demoHistory() {
  const groups = [
    ['required', '必修', [...Array(18).fill(3), ...Array(7).fill(1)]],
    ['elective', '選修', [...Array(6).fill(3), 2, 2]],
    ['general', '必修', Array(12).fill(2)],
    ['external', '選修', [3, 2, 2, 2, 2]],
    ['nonGraduation', '必修', [1, 1, 1]],
  ];
  let index = 0;
  return groups.flatMap(([graduationCategory, requirementType, credits]) =>
    credits.map(value => {
      index += 1;
      return entry({
        academicYear: 112 + Math.floor((index - 1) / 20),
        semester: index % 2 === 0 ? 2 : 1,
        courseCode: `HIST${String(index).padStart(4, '0')}`,
        courseName: `歷史修課 ${index}`,
        credits: value,
        requirementType,
        graduationCategory,
      });
    })
  );
}

const RULE = resolveGraduationRule({ program: '資訊工程學系', admissionYear: 114 });

describe('G10 逐門追溯的總和必須等於既有的學分計算', () => {
  // 這是本組最重要的一條。追溯若自己走一套篩選邏輯，兩邊遲早給出不同數字，
  // 而畫面上會同時出現「尚缺 X 學分」與一份加起來對不上的課程清單。
  test('G10 每個分類的 credits 恆等於 getEarnedCredits() 的對應值', () => {
    const history = demoHistory();
    const earned = getEarnedCredits(history);
    const attribution = getEarnedCreditsAttribution(history, RULE);

    for (const [category, credits] of Object.entries(earned)) {
      assert.equal(
        attribution[category].credits, credits,
        `${category} 的追溯總和與 getEarnedCredits() 不一致`
      );
    }
  });

  test('G10 逐門列出的學分加總也等於該分類的 credits', () => {
    const attribution = getEarnedCreditsAttribution(demoHistory(), RULE);

    for (const [category, bucket] of Object.entries(attribution)) {
      const summed = bucket.courses.reduce((total, item) => total + item.credits, 0);
      assert.equal(summed, bucket.credits, `${category} 的逐門加總對不上`);
    }
  });

  test('G10 對照 demo 真實分佈：61／22／24／11，共 118 學分', () => {
    const attribution = getEarnedCreditsAttribution(demoHistory(), RULE);

    assert.equal(attribution.required.credits, 61);
    assert.equal(attribution.elective.credits, 22);
    assert.equal(attribution.general.credits, 24);
    assert.equal(attribution.external.credits, 11);
    assert.equal(attribution.unspecified.credits, 0);

    const total = Object.values(attribution).reduce((sum, bucket) => sum + bucket.credits, 0);
    assert.equal(total, 118);
  });
});

describe('G11 追溯的排除規則與既有計算一致', () => {
  test('G11 nonGraduation 的課不出現在任何分類裡', () => {
    const attribution = getEarnedCreditsAttribution(demoHistory(), RULE);
    const allCourses = Object.values(attribution).flatMap(bucket => bucket.courses);

    assert.equal(allCourses.length, 50, '53 筆扣掉 3 筆 nonGraduation');
    assert.ok(allCourses.every(item => !item.courseName.includes('nonGraduation')));
  });

  test('G11 未通過的課不列入追溯（那是重補修對象，不是已修）', () => {
    const history = [
      entry({ courseCode: 'A001', passed: true }),
      entry({ courseCode: 'A002', passed: false }),
    ];
    const attribution = getEarnedCreditsAttribution(history, RULE);

    assert.equal(attribution.required.courses.length, 1);
    assert.equal(attribution.required.courses[0].courseCode, 'A001');
  });

  test('G11 同一課號重修時只算最新一次（與 getPassedCourseCodes 同一套判定）', () => {
    const history = [
      entry({ courseCode: 'A001', academicYear: 112, semester: 1, passed: false, credits: 3 }),
      entry({ courseCode: 'A001', academicYear: 113, semester: 1, passed: true, credits: 3 }),
    ];
    const attribution = getEarnedCreditsAttribution(history, RULE);

    assert.equal(attribution.required.courses.length, 1);
    assert.equal(attribution.required.credits, 3);
    assert.equal(attribution.required.courses[0].academicYear, 113);
  });

  test('G11 分類缺漏或不認得時歸入 unspecified，不靜默丟掉學分', () => {
    const attribution = getEarnedCreditsAttribution(
      [entry({ graduationCategory: '莫名其妙的分類', credits: 3 })], RULE
    );

    assert.equal(attribution.unspecified.credits, 3);
  });
});

describe('G12 每筆認列都帶得到規則來源與待確認狀態', () => {
  test('G12 每一門課附上 ruleVersion、ruleSource 與 attributionSource', () => {
    const attribution = getEarnedCreditsAttribution(demoHistory(), RULE);
    const allCourses = Object.values(attribution).flatMap(bucket => bucket.courses);

    assert.ok(allCourses.length > 0);
    for (const item of allCourses) {
      assert.equal(item.ruleVersion, '114');
      assert.match(item.ruleSource, /registration\.fcu\.edu\.tw/);
      assert.equal(item.attributionSource, ATTRIBUTION_SOURCE_COURSE_HISTORY);
      assert.equal(item.needsVerification, false);
    }
  });

  test('G12 系所被標記待人工複核時，旗標傳到每一筆認列上', () => {
    const flaggedRule = resolveGraduationRule({ program: '財務金融學系', admissionYear: 114 });
    const attribution = getEarnedCreditsAttribution([entry()], flaggedRule);

    assert.equal(attribution.required.courses[0].needsVerification, true);
  });

  test('G12 沒有傳 rule 時三個欄位為 null，不自行決定套哪一版', () => {
    const attribution = getEarnedCreditsAttribution([entry()]);
    const [item] = attribution.required.courses;

    assert.equal(item.ruleVersion, null);
    assert.equal(item.ruleSource, null);
    assert.equal(item.needsVerification, false);
  });

  test('G12 課程依修課時間排序，讀起來是一條時間線', () => {
    const history = [
      entry({ courseCode: 'C', academicYear: 114, semester: 1 }),
      entry({ courseCode: 'A', academicYear: 112, semester: 1 }),
      entry({ courseCode: 'B', academicYear: 113, semester: 2 }),
    ];
    const codes = getEarnedCreditsAttribution(history, RULE).required.courses
      .map(item => item.courseCode);

    assert.deepEqual(codes, ['A', 'B', 'C']);
  });
});

// ---------------------------------------------------------------------------

// 用真的 `buildStudentScope()` 建 scope，不手工捏物件——手捏會漏掉
// `abbreviations` 之類的欄位，讓測試在跟正式路徑不同的形狀上通過（第一版就踩到了）。
const CS_SCOPE = buildStudentScope({
  department: '資訊工程學系', gradeLevel: 3, className: '資訊三乙',
});

function course(overrides = {}) {
  return {
    id: 1,
    catalogCourseCode: 'IECS2011',
    name: '系統分析與設計',
    credits: 3,
    type: '選修',
    department: '資訊三乙',
    year: 114,
    semester: '下學期',
    ...overrides,
  };
}

const FULL_GAPS = { required: 2, elective: 6, general: 4, external: 3, unspecified: 0 };

describe('G13 補學分推薦不再推補不了缺口的課', () => {
  // 本次的核心迴歸。改動前 `departmentCourses[0]` 沒排序也沒過濾，實測資訊工程學系
  // 119 門候選裡第一門就是 0 學分的「班級活動」，前端還把它標成「通識推薦」。
  test('G13 班級活動（0 學分、不計入畢業）不會被推薦', () => {
    const courses = [
      course({ id: 10, catalogCourseCode: 'GEID0010', name: '班級活動', credits: 0, type: '必修' }),
      course({ id: 11, catalogCourseCode: 'IECS2024', name: '行動應用程式開發', credits: 3 }),
    ];
    const recommendations = buildCreditRecommendations({
      courses, scope: CS_SCOPE, gaps: FULL_GAPS, rule: RULE,
    });

    assert.ok(
      recommendations.every(item => item.course.name !== '班級活動'),
      '班級活動補不了任何畢業學分缺口，不得出現在推薦裡'
    );
    assert.ok(recommendations.length > 0, '正常的課仍要推得出來');
  });

  test('G13 體育與國防科技同樣不推（沿用 countsTowardGraduation 判定）', () => {
    const courses = [
      course({ id: 20, catalogCourseCode: 'ATHL1005', name: '體育－羽球', credits: 1 }),
      course({ id: 21, catalogCourseCode: 'MILT1035', name: '國防科技', credits: 1, type: '必修' }),
    ];
    const recommendations = buildCreditRecommendations({
      courses, scope: CS_SCOPE, gaps: FULL_GAPS, rule: RULE,
    });

    assert.equal(recommendations.length, 0);
  });
});

describe('G14 推薦的課必須真的補得上它宣稱的缺口', () => {
  test('G14 每筆推薦的 fillsGap 分類缺口都 > 0', () => {
    const courses = [course(), course({ id: 2, catalogCourseCode: 'IECS2024', name: '行動應用程式開發' })];
    const recommendations = buildCreditRecommendations({
      courses, scope: CS_SCOPE, gaps: FULL_GAPS, rule: RULE,
    });

    assert.ok(recommendations.length > 0);
    for (const item of recommendations) {
      assert.ok(FULL_GAPS[item.fillsGap] > 0, `${item.fillsGap} 的缺口應大於 0`);
      assert.equal(item.gapBefore, FULL_GAPS[item.fillsGap]);
      assert.ok(item.gapLabel, '要帶可讀標籤，前端才不必再寫死分類名稱');
    }
  });

  // 開發過程中實際踩到的漏洞：`classifyCsCourse()` 依課名比對，比對不到就退回
  // MySQL 原始的 `選修`。第一版的分類對照表沒有這個鍵，實測讓資訊工程學系 119 門
  // 候選裡的 11 門（高等資訊安全、影像處理、資訊保密與安全…）被靜默排除。
  test('G14 未被課程地圖細分的本系選修仍算進 elective 缺口', () => {
    const recommendations = buildCreditRecommendations({
      // 課名不在資工必選修科目表裡 → 類別停在原始的 `選修`。
      courses: [course({ catalogCourseCode: 'IECS9999', name: '高等資訊安全' })],
      scope: CS_SCOPE,
      gaps: FULL_GAPS,
      rule: RULE,
    });

    assert.equal(recommendations.length, 1);
    assert.equal(recommendations[0].fillsGap, 'elective');
  });

  test('G14 該分類缺口已補滿時不推該類的課', () => {
    const recommendations = buildCreditRecommendations({
      courses: [course()],
      scope: CS_SCOPE,
      gaps: { required: 2, elective: 0, general: 4, external: 3, unspecified: 0 },
      rule: RULE,
    });

    assert.ok(recommendations.every(item => item.fillsGap !== 'elective'));
  });

  test('G14 所有缺口都補滿時回空陣列，不硬推一門', () => {
    const recommendations = buildCreditRecommendations({
      courses: [course()],
      scope: CS_SCOPE,
      gaps: { required: 0, elective: 0, general: 0, external: 0, unspecified: 0 },
      rule: RULE,
    });

    assert.deepEqual(recommendations, []);
  });

  test('G14 缺口算不出來（gaps 為 null）時回空陣列', () => {
    // 系所查不到或沒有修課歷史時 gaps 是 null——沒有缺口就無從驗證「補得上」，
    // 硬推等於回到舊行為。
    assert.deepEqual(
      buildCreditRecommendations({ courses: [course()], scope: CS_SCOPE, gaps: null }),
      []
    );
  });
});

describe('G15 推薦的排序與去重', () => {
  test('G15 一門課開多個班次時只推薦一次', () => {
    const courses = [
      course({ id: 1 }),
      course({ id: 2 }),
      course({ id: 3 }),
    ];
    const recommendations = buildCreditRecommendations({
      courses, scope: CS_SCOPE, gaps: FULL_GAPS, rule: RULE,
    });

    assert.equal(recommendations.length, 1, '同一個 catalogCourseCode 只該出現一次');
  });

  test('G15 已修過並通過的課不再推薦', () => {
    const recommendations = buildCreditRecommendations({
      courses: [course()],
      scope: CS_SCOPE,
      gaps: FULL_GAPS,
      passedCourseCodes: new Set(['IECS2011']),
      rule: RULE,
    });

    assert.deepEqual(recommendations, []);
  });

  test('G15 相同輸入產生相同順序（測試才釘得住）', () => {
    const courses = [
      course({ id: 1, catalogCourseCode: 'IECS2011', name: 'A', credits: 3 }),
      course({ id: 2, catalogCourseCode: 'IECS2024', name: 'B', credits: 3 }),
      course({ id: 3, catalogCourseCode: 'IECS2026', name: 'C', credits: 2 }),
    ];
    const first = buildCreditRecommendations({ courses, scope: CS_SCOPE, gaps: FULL_GAPS, rule: RULE });
    const second = buildCreditRecommendations({
      courses: [...courses].reverse(), scope: CS_SCOPE, gaps: FULL_GAPS, rule: RULE,
    });

    assert.deepEqual(
      first.map(item => item.course.catalogCourseCode),
      second.map(item => item.course.catalogCourseCode),
      '輸入順序不同不該改變推薦順序'
    );
    // 學分高者優先，同學分則依課號。
    assert.equal(first[0].credits, 3);
  });

  test('G15 推薦帶上規則版本，讓「依哪一版算的」追溯得到', () => {
    const [first] = buildCreditRecommendations({
      courses: [course()], scope: CS_SCOPE, gaps: FULL_GAPS, rule: RULE,
    });

    assert.equal(first.ruleVersion, '114');
    assert.match(first.ruleSource, /registration\.fcu\.edu\.tw/);
  });
});

describe('G17 update_student_profile 的佔位值不得被當成使用者的變更', () => {
  // 實測發現的真實問題：在 `update_student_profile` 的 schema 加上 admissionYear 之後，
  // 模型會用 `admissionYear: 0` 這種佔位值把欄位湊滿（4/4 次都送 0）。
  // 不清掉的話，使用者會在確認訊息看到「入學年度改成 0」，確認後真的寫進資料庫——
  // `normalizeNumber(0, null)` 會回傳 0，把真實的 112 洗掉。
  test('G17 admissionYear 的佔位值 0 被丟棄，其他欄位照常保留', () => {
    const cleaned = sanitizeProfileScopeArgs({
      department: '資訊工程學系', gradeLevel: 3, className: '資訊三乙', admissionYear: 0,
    });

    assert.ok(!('admissionYear' in cleaned), '0 不是使用者講得出來的入學年度');
    assert.equal(cleaned.department, '資訊工程學系');
    assert.equal(cleaned.gradeLevel, 3);
    assert.equal(cleaned.className, '資訊三乙');
  });

  test('G17 合法的入學年度照樣留下', () => {
    assert.equal(sanitizeProfileScopeArgs({ admissionYear: 112 }).admissionYear, 112);
  });

  test('G17 空字串與非正整數一律視為沒填', () => {
    const cleaned = sanitizeProfileScopeArgs({
      department: '', className: '   ', gradeLevel: 0, admissionYear: -3,
    });

    assert.deepEqual(cleaned, {});
  });

  test('G17 沒有這些欄位時不會憑空生出來', () => {
    assert.deepEqual(sanitizeProfileScopeArgs({ confirmationToken: 'tok' }), { confirmationToken: 'tok' });
  });
});

describe('G16 入學年度的交叉驗證（migration 回填用）', () => {
  // 實測 demo 帳號：ACTIVE_TERM 114、年級 3 → 112；修課歷史最早 112。兩者一致。
  test('G16 兩個來源一致時採用該值', () => {
    const result = reconcileAdmissionYear({
      gradeLevel: 3, earliestHistoryYear: 112, activeAcademicYear: 114,
    });

    assert.equal(result.admissionYear, 112);
    assert.equal(result.reason, null);
  });

  test('G16 兩個來源不一致時回 null 並說明，不挑一個用', () => {
    const result = reconcileAdmissionYear({
      gradeLevel: 3, earliestHistoryYear: 110, activeAcademicYear: 114,
    });

    assert.equal(result.admissionYear, null);
    assert.match(result.reason, /不一致/);
    assert.deepEqual(result.sources, { fromGrade: 112, fromHistory: 110 });
  });

  test('G16 只有單一來源時不採用——無法交叉驗證就不寫入', () => {
    const noHistory = reconcileAdmissionYear({ gradeLevel: 3, earliestHistoryYear: null, activeAcademicYear: 114 });
    const noGrade = reconcileAdmissionYear({ gradeLevel: null, earliestHistoryYear: 112, activeAcademicYear: 114 });

    assert.equal(noHistory.admissionYear, null);
    assert.match(noHistory.reason, /缺修課歷史/);
    assert.equal(noGrade.admissionYear, null);
    assert.match(noGrade.reason, /缺年級/);
  });

  test('G16 兩個來源都沒有時回 null，不丟例外', () => {
    const result = reconcileAdmissionYear({});

    assert.equal(result.admissionYear, null);
    assert.match(result.reason, /都算不出/);
  });
});
