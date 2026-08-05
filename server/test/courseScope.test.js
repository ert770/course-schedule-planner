// #13：`Courses.type = '必修'` 是「某系所某年級的必修」，不是「這位學生的必修」。
// 未依系所與年級收斂時，全校 2094 筆必修都會被當成每位學生的必修，
// 產生的課表橫跨 79 個系所並含 12 個不同研究所的碩士論文。

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  parseClassName,
  buildStudentScope,
  isRequiredForStudent,
  isOtherStudentsRequiredCourse,
} from '../src/skills/courseScope.js';
import { getAbbreviations, getDepartmentByAbbreviation } from '../src/data/departmentMapping.js';
import { pickClassNameTarget } from '../src/db/database.js';
import { generateSchedule } from '../src/skills/scheduler.js';
import { buildScheduleConstraints } from '../src/services/constraintService.js';
import { makeCourse } from './fixtures.js';

describe('班級名稱解析：系所班級', () => {
  test('學士班：簡稱 + 年級 + 班別', () => {
    const parsed = parseClassName('資訊二合');

    assert.equal(parsed.isDepartmentClass, true);
    assert.equal(parsed.department, '資訊工程學系');
    assert.equal(parsed.abbreviation, '資訊');
    assert.equal(parsed.degree, 'bachelor');
    assert.equal(parsed.grade, 2);
  });

  test('碩士班與博士班', () => {
    assert.deepEqual(
      (({ degree, grade, department }) => ({ degree, grade, department }))(parseClassName('資訊碩一')),
      { degree: 'master', grade: 1, department: '資訊工程學系' }
    );
    assert.deepEqual(
      (({ degree, grade, department }) => ({ degree, grade, department }))(parseClassName('中文博三')),
      { degree: 'doctor', grade: 3, department: '中國文學系' }
    );
  });

  test('碩專必須先於碩比對，否則碩專一會被判成碩士班', () => {
    const parsed = parseClassName('智能工程碩專一學位學程');

    assert.equal(parsed.degree, 'masterInService');
    assert.equal(parsed.grade, 1);
    assert.equal(parsed.department, '智能工程碩士在職專班');
  });

  test('進修學制', () => {
    const parsed = parseClassName('室設進修一');

    assert.equal(parsed.degree, 'continuing');
    assert.equal(parsed.grade, 1);
    assert.equal(parsed.department, '室內設計進修學士班');
  });

  test('學位學程班級仍是系所班級', () => {
    const parsed = parseClassName('建築二學位學程');

    assert.equal(parsed.isDepartmentClass, true);
    assert.equal(parsed.department, '建築學系');
    assert.equal(parsed.grade, 2);
  });

  test('多簡稱指向同一系所', () => {
    // `機電`（大學部）與 `機械`（碩士班）是同一系所的不同學制簡稱。
    assert.equal(parseClassName('機電三甲').department, '機械與電腦輔助工程學系');
    assert.equal(parseClassName('機械碩二').department, '機械與電腦輔助工程學系');
    assert.deepEqual(
      getAbbreviations('機械與電腦輔助工程學系').sort(),
      ['機械', '機電']
    );
  });

  test('前綴重疊的簡稱取最長者', () => {
    // `資訊` 與 `資訊電機`、`商學` 與 `商學進修` 前綴重疊。
    assert.equal(parseClassName('資訊電機碩專一學位學程').department, '資訊電機工程碩士在職學位學程');
    assert.equal(parseClassName('商學進修一學位學程甲班').department, '商學進修學士班');
    assert.equal(parseClassName('資訊一甲').department, '資訊工程學系');
  });
});

describe('班級名稱解析：非系所班級不得被誤判', () => {
  // 這些名稱開頭剛好是某個系所簡稱，單純比對前綴會全部判錯。
  const falsePositives = [
    ['建設英班', 'englishProgram'],
    ['資電英A班', 'englishProgram'],
    ['資電學院綜合班', 'collegeWide'],
    ['商學院綜合班', 'collegeWide'],
    ['金融學院碩士綜合班', 'collegeWide'],
    ['資通安全學程', 'creditProgram'],
    ['人工智慧探索應用學分學程', 'creditProgram'],
    ['商學一(UQ)', 'internationalProgram'],
  ];

  for (const [className, category] of falsePositives) {
    test(`${className} 不是系所班級`, () => {
      const parsed = parseClassName(className);

      assert.equal(parsed.isDepartmentClass, false, `${className} 被誤判為系所班級`);
      assert.equal(parsed.category, category);
      assert.equal(parsed.department, null);
    });
  }

  test('國際學程班級：資訊工程學系的一般班級簡稱是 資訊，不是 資工', () => {
    assert.equal(parseClassName('資工一(SFSU)').isDepartmentClass, false);
    assert.equal(getDepartmentByAbbreviation('資工'), null);
  });

  test('共同科目名稱自帶年級時解析得出年級', () => {
    assert.equal(parseClassName('軍訓(一年級)').grade, 1);
    assert.equal(parseClassName('大二英文綜合班').grade, 2);
    assert.equal(parseClassName('國文綜合班').category, 'commonCurriculum');
  });

  test('空值不會爆炸', () => {
    for (const value of [null, undefined, '', '   ']) {
      const parsed = parseClassName(value);
      assert.equal(parsed.isDepartmentClass, false);
    }
  });
});

describe('學生範圍', () => {
  test('系所與年級齊備才算可判定', () => {
    assert.equal(buildStudentScope({ department: '資訊工程學系', gradeLevel: 3 }).resolved, true);
    assert.equal(buildStudentScope({ department: '資訊工程學系' }).resolved, false);
    assert.equal(buildStudentScope({ gradeLevel: 3 }).resolved, false);
    assert.equal(buildStudentScope({}).resolved, false);
  });

  test('不在對照表中的系所名稱不算可判定', () => {
    assert.equal(buildStudentScope({ department: '不存在系', gradeLevel: 1 }).resolved, false);
  });

  test('系所帶多餘引號時仍可判定（D3 連動）', () => {
    const scope = buildStudentScope({ department: "'資訊工程學系'", gradeLevel: 1 });

    assert.equal(scope.resolved, true);
    assert.deepEqual(scope.abbreviations, ['資訊']);
  });

  test('grade 為字串時仍可判定', () => {
    assert.equal(buildStudentScope({ department: '資訊工程學系', grade: '1' }).resolved, true);
  });
});

describe('必修範圍判定', () => {
  const scope = buildStudentScope({ department: '資訊工程學系', gradeLevel: 1 });
  const required = (department) => ({ category: '必修', department });

  test('本系所本年級的必修才算這位學生的必修', () => {
    assert.equal(isRequiredForStudent(required('資訊一甲'), scope), true);
    assert.equal(isRequiredForStudent(required('資訊一合'), scope), true);
  });

  test('同系所其他年級的必修不算', () => {
    assert.equal(isRequiredForStudent(required('資訊二合'), scope), false);
    assert.equal(isOtherStudentsRequiredCourse(required('資訊二合'), scope), true);
  });

  test('同系所其他學制的必修不算', () => {
    assert.equal(isRequiredForStudent(required('資訊碩一'), scope), false);
    assert.equal(isOtherStudentsRequiredCourse(required('資訊碩一'), scope), true);
  });

  test('其他系所的必修不算', () => {
    assert.equal(isRequiredForStudent(required('會計一甲'), scope), false);
    assert.equal(isOtherStudentsRequiredCourse(required('會計一甲'), scope), true);
  });

  test('選修不受必修範圍影響', () => {
    const elective = { category: '選修', department: '會計一甲' };

    assert.equal(isRequiredForStudent(elective, scope), false);
    assert.equal(isOtherStudentsRequiredCourse(elective, scope), false);
  });

  test('通識與共同科目不算必修，但也不算別人的必修', () => {
    for (const className of ['國文綜合班', '體育選修', '資電學院綜合班', '華語教師學程']) {
      assert.equal(isRequiredForStudent(required(className), scope), false, className);
      assert.equal(isOtherStudentsRequiredCourse(required(className), scope), false, className);
    }
  });

  test('無法判定學生範圍時，不把任何課當成必修，也不排除候選', () => {
    const unknown = buildStudentScope({});

    assert.equal(isRequiredForStudent(required('資訊一甲'), unknown), false);
    assert.equal(isOtherStudentsRequiredCourse(required('資訊一甲'), unknown), false);
  });
});

describe('必修不得換班：班別收斂', () => {
  // 資工系選課公告明文「不接受必修課程換班級的要求」。
  // 資訊三甲～三丁各開一班計算機演算法，學生只能選自己班的那一班。
  const required = (department) => ({ category: '必修', department });
  const scope = buildStudentScope({
    department: '資訊工程學系',
    gradeLevel: 3,
    className: '資訊三甲',
  });

  test('班別解析成 classSuffix', () => {
    assert.equal(parseClassName('資訊三甲').classSuffix, '甲');
    assert.equal(parseClassName('資訊三合').classSuffix, '合');
    assert.equal(scope.classSuffix, '甲');
    assert.equal(scope.classMismatch, false);
  });

  test('本班的必修才算這位學生的必修', () => {
    assert.equal(isRequiredForStudent(required('資訊三甲'), scope), true);
    assert.equal(isRequiredForStudent(required('資訊三乙'), scope), false);
    assert.equal(isOtherStudentsRequiredCourse(required('資訊三乙'), scope), true);
  });

  test('合班的必修是全年級共同修習，仍算本班', () => {
    // 資料庫實例：資料結構與資料結構實習開在 `資訊二合`，是資訊二甲～二丁全體的必修。
    const secondYear = buildStudentScope({
      department: '資訊工程學系',
      gradeLevel: 2,
      className: '資訊二甲',
    });

    assert.equal(isRequiredForStudent(required('資訊二合'), secondYear), true);
    assert.equal(isRequiredForStudent(required('資訊二甲'), secondYear), true);
    assert.equal(isRequiredForStudent(required('資訊二乙'), secondYear), false);
  });

  test('未設定班別時維持系所 + 年級判定，不得因此排不出必修', () => {
    const noClass = buildStudentScope({ department: '資訊工程學系', gradeLevel: 3 });

    assert.equal(noClass.classSuffix, null);
    assert.equal(isRequiredForStudent(required('資訊三甲'), noClass), true);
    assert.equal(isRequiredForStudent(required('資訊三乙'), noClass), true);
  });

  test('班別的系所與 profile 不符時忽略班別並標記', () => {
    // 系所對不上就無從調解，只能忽略班別——否則會靜默排除掉全部必修。
    const mismatch = buildStudentScope({
      department: '資訊工程學系',
      gradeLevel: 3,
      className: '電機三甲',
    });

    assert.equal(mismatch.classMismatch, true);
    assert.equal(mismatch.classSuffix, null);
    assert.equal(mismatch.grade, 3, '年級沿用 profile');
    assert.equal(isRequiredForStudent(required('資訊三甲'), mismatch), true);
  });

  test('F16-b 年級以班別為準：班別是本系班級時覆寫 profile 的年級', () => {
    // 班別名稱本身就編碼了年級，而且是使用者最後明確選的值。
    // 先前的做法是「不一致就忽略班別」，導致改了班別課表卻毫無變化。
    const scope = buildStudentScope({
      department: '資訊工程學系',
      gradeLevel: 3,
      className: '資訊二乙',
    });

    assert.equal(scope.classMismatch, false);
    assert.equal(scope.grade, 2, '年級應改依班別');
    assert.equal(scope.profileGrade, 3);
    assert.equal(scope.gradeOverriddenByClass, true);
    assert.equal(scope.classSuffix, '乙');

    assert.equal(isRequiredForStudent(required('資訊二乙'), scope), true);
    assert.equal(isRequiredForStudent(required('資訊二合'), scope), true);
    assert.equal(isRequiredForStudent(required('資訊三甲'), scope), false);
  });

  test('F16-b 年級與班別一致時不標記覆寫', () => {
    const scope = buildStudentScope({
      department: '資訊工程學系',
      gradeLevel: 3,
      className: '資訊三甲',
    });

    assert.equal(scope.gradeOverriddenByClass, false);
    assert.equal(scope.grade, 3);
  });

  test('F16-b 端到端：只改班別，課表隨之改變並附上不一致警告', () => {
    const candidates = [
      makeCourse(1, { category: '必修', department: '資訊三甲', dayOfWeek: 1, startPeriod: 2, endPeriod: 3 }),
      makeCourse(2, { category: '必修', department: '資訊二乙', dayOfWeek: 2, startPeriod: 2, endPeriod: 3 }),
    ];
    const base = {
      department: '資訊工程學系',
      gradeLevel: 3,
      minCredits: 0,
      maxCredits: 99,
      maxCoursesPerDay: 99,
    };

    const asThirdYear = generateSchedule(candidates, { ...base, className: '資訊三甲' });
    const asSecondYear = generateSchedule(candidates, { ...base, className: '資訊二乙' });

    assert.deepEqual(asThirdYear.schedule.map(course => course.id), [1]);
    assert.deepEqual(asSecondYear.schedule.map(course => course.id), [2]);
    assert.ok(
      asSecondYear.warnings.some(warning => warning.includes('與個人資料的 3 年級不一致')),
      asSecondYear.warnings.join(' | ')
    );
  });

  test('端到端 A/B：有班別時只排入本班必修', () => {
    const candidates = [
      makeCourse(1, { category: '必修', department: '資訊三甲', dayOfWeek: 1, startPeriod: 2, endPeriod: 3 }),
      makeCourse(2, { category: '必修', department: '資訊三乙', dayOfWeek: 2, startPeriod: 2, endPeriod: 3 }),
      makeCourse(3, { category: '必修', department: '資訊三丙', dayOfWeek: 3, startPeriod: 2, endPeriod: 3 }),
    ];
    const base = { department: '資訊工程學系', gradeLevel: 3, minCredits: 0, maxCredits: 99, maxCoursesPerDay: 99 };

    const withoutClass = generateSchedule(candidates, base);
    const withClass = generateSchedule(candidates, { ...base, className: '資訊三甲' });

    assert.deepEqual(withoutClass.schedule.map(course => course.id).sort(), [1, 2, 3]);
    assert.deepEqual(withClass.schedule.map(course => course.id), [1]);
    assert.ok(
      withoutClass.warnings.some(warning => warning.includes('未設定班別')),
      withoutClass.warnings.join(' | ')
    );
  });

  test('班別由已儲存偏好帶入排課限制', () => {
    const constraints = buildScheduleConstraints({}, {
      department: '資訊工程學系',
      gradeLevel: 3,
      className: '資訊三甲',
    });

    assert.equal(constraints.className, '資訊三甲');
  });
});

describe('班別的儲存位置優先順序', () => {
  // 目標狀態是 `User_Profiles.class_name`；欄位還沒新增前才走本機後備。
  test('欄位存在時一律寫進 User_Profiles', () => {
    assert.equal(
      pickClassNameTarget({ isMysqlProfileWrite: true, hasColumn: true, hasUsersJsonRow: true }),
      'column'
    );
    assert.equal(
      pickClassNameTarget({ isMysqlProfileWrite: true, hasColumn: true, hasUsersJsonRow: false }),
      'column'
    );
  });

  test('欄位不存在但有 users.json 對應列時寫進 users.json', () => {
    assert.equal(
      pickClassNameTarget({ isMysqlProfileWrite: true, hasColumn: false, hasUsersJsonRow: true }),
      'usersJson'
    );
  });

  test('MySQL 使用者、無欄位、也沒有 users.json 對應列時寫進本機 profile', () => {
    // 這是關鍵情境：先前這種使用者的班別會「儲存成功」地消失——
    // SQL 沒有欄位可寫卻仍回傳成功的 profile，本機寫入又被提早 return 跳過，
    // 下一次排課直接退回系所 + 年級。
    assert.equal(
      pickClassNameTarget({ isMysqlProfileWrite: true, hasColumn: false, hasUsersJsonRow: false }),
      'localProfile'
    );
  });

  test('非 MySQL 寫入路徑不會寫進欄位', () => {
    assert.equal(
      pickClassNameTarget({ isMysqlProfileWrite: false, hasColumn: true, hasUsersJsonRow: false }),
      'localProfile'
    );
  });
});

describe('#13 端到端：課表不得出現他系或他年級的必修', () => {
  const candidates = [
    makeCourse(1, { category: '必修', department: '資訊一甲', dayOfWeek: 1, startPeriod: 2, endPeriod: 3 }),
    makeCourse(2, { category: '必修', department: '資訊三甲', dayOfWeek: 2, startPeriod: 2, endPeriod: 3 }),
    makeCourse(3, { category: '必修', department: '會計一甲', dayOfWeek: 3, startPeriod: 2, endPeriod: 3 }),
    makeCourse(4, { category: '必修', department: '運輸物流碩二', dayOfWeek: 4, startPeriod: 2, endPeriod: 3 }),
    makeCourse(5, { category: '選修', department: '資訊一甲', dayOfWeek: 5, startPeriod: 2, endPeriod: 3 }),
  ];

  test('資訊工程學系一年級：只排入本系一年級的必修', () => {
    const result = generateSchedule(candidates, {
      department: '資訊工程學系',
      gradeLevel: 1,
      minCredits: 0,
      maxCredits: 6,
    });

    const ids = result.schedule.map(course => course.id);
    assert.ok(ids.includes(1), '本系一年級必修應排入');
    assert.ok(!ids.includes(2), '同系三年級必修不得排入');
    assert.ok(!ids.includes(3), '他系必修不得排入');
    assert.ok(!ids.includes(4), '研究所必修不得排入');
  });

  test('他系與他年級的必修完全不進候選，連選修填充也不會撿到', () => {
    // 學分上限開大，讓貪婪填充有機會把所有課都塞進來。
    const result = generateSchedule(candidates, {
      department: '資訊工程學系',
      gradeLevel: 1,
      minCredits: 0,
      maxCredits: 99,
      maxCoursesPerDay: 99,
    });

    const ids = result.schedule.map(course => course.id);
    assert.deepEqual(ids.sort(), [1, 5], '只應剩本系一年級必修與選修');
    assert.ok(result.warnings.some(w => w.includes('已排除 3 門')), result.warnings.join(' | '));
  });

  test('同一批課程換成三年級學生會得到不同的必修', () => {
    const result = generateSchedule(candidates, {
      department: '資訊工程學系',
      gradeLevel: 3,
      minCredits: 0,
      maxCredits: 6,
    });

    const ids = result.schedule.map(course => course.id);
    assert.ok(ids.includes(2), '三年級應排入資訊三甲的必修');
    assert.ok(!ids.includes(1), '三年級不應排入資訊一甲的必修');
  });

  test('未設定系所時明確警告，不得靜默退回全校必修', () => {
    const result = generateSchedule(candidates, { minCredits: 0, maxCredits: 6 });

    assert.ok(
      result.warnings.some(w => w.includes('未設定系所與年級')),
      result.warnings.join(' | ')
    );
  });

  test('只缺年級時，訊息只提年級', () => {
    const result = generateSchedule(candidates, {
      department: '資訊工程學系',
      minCredits: 0,
      maxCredits: 6,
    });

    assert.ok(
      result.warnings.some(w => w.includes('未設定年級') && !w.includes('系所')),
      result.warnings.join(' | ')
    );
  });

  test('系所對不到對照表時報錯，不得與「未設定」混為一談', () => {
    // 「沒填」要使用者去補，「填了但查不到」是資料錯誤（打錯字或 A 表缺漏）。
    // 合併成同一句話會讓後者永遠查不出來。
    const result = generateSchedule(candidates, {
      department: '資訊工程學糸',
      gradeLevel: 1,
      minCredits: 0,
      maxCredits: 6,
    });

    assert.equal(result.success, false);
    assert.ok(
      result.warnings.some(w => w.includes('不在系所對照表中')),
      result.warnings.join(' | ')
    );
    assert.ok(
      !result.warnings.some(w => w.includes('未設定系所')),
      '不得回報成「未設定系所」'
    );
  });

  test('明確指定的他班必修豁免整批排除，改為排入並警告', () => {
    // 這裡的判定是依系所與年級「推論」，不是校方的選課權限——
    // 轉系、輔系、跨班加簽都可能讓學生真的修得到。
    const auto = generateSchedule(candidates, {
      department: '資訊工程學系',
      gradeLevel: 1,
      minCredits: 0,
      maxCredits: 99,
      maxCoursesPerDay: 99,
    });
    const explicit = generateSchedule(candidates, {
      department: '資訊工程學系',
      gradeLevel: 1,
      minCredits: 0,
      maxCredits: 99,
      maxCoursesPerDay: 99,
      explicitCourseIds: [2],
    });

    assert.ok(!auto.schedule.some(course => course.id === 2), '未指定時應排除資訊三甲的必修');
    assert.ok(explicit.schedule.some(course => course.id === 2), '明確指定時應排入');
    assert.ok(
      explicit.warnings.some(w => w.includes('其他班別或系所的必修')),
      explicit.warnings.join(' | ')
    );
  });

  test('非本人必修不得靠必修優先權壓過本系選修', () => {
    // 實測資料曾出現 `商創一(RMIT)｜管理學`、`未完成課程(大學)｜商業應用統計`
    // 被排進資訊系學生的課表：它們不是這位學生的必修，卻仍享有必修的最高優先度。
    // 兩門課同時段且學分上限只容得下一門。選修排在候選清單前面，
    // 因此只要非本人必修不再享有較高的類別優先度，選修就會被選中；
    // 若它仍是必修優先度（0 對 2，分數差 240），順序再前面也會被壓過。
    const sameSlot = { dayOfWeek: 2, startPeriod: 2, endPeriod: 3 };
    const courses = [
      makeCourse(11, { category: '選修', department: '資訊一甲', ...sameSlot }),
      makeCourse(10, { category: '必修', department: '國文綜合班', ...sameSlot }),
    ];

    const result = generateSchedule(courses, {
      department: '資訊工程學系',
      gradeLevel: 1,
      minCredits: 0,
      maxCredits: 3,
    });

    assert.deepEqual(result.schedule.map(course => course.id), [11]);
  });

  test('通識與共同科目不會被系所條件過濾掉', () => {
    const withCommon = [
      ...candidates,
      makeCourse(6, { category: '必修', department: '國文綜合班', dayOfWeek: 6, startPeriod: 2, endPeriod: 3 }),
    ];

    const result = generateSchedule(withCommon, {
      department: '資訊工程學系',
      gradeLevel: 1,
      minCredits: 0,
      maxCredits: 99,
      maxCoursesPerDay: 99,
    });

    assert.ok(result.schedule.some(course => course.id === 6), '全校共同科目應仍是候選');
    assert.ok(
      result.warnings.some(w => w.includes('尚無適用對象規則')),
      result.warnings.join(' | ')
    );
  });

  test('系所與年級由已儲存偏好帶入排課限制', () => {
    const constraints = buildScheduleConstraints({}, {
      department: '資訊工程學系',
      gradeLevel: 1,
    });

    assert.equal(constraints.department, '資訊工程學系');
    assert.equal(constraints.gradeLevel, 1);
  });
});
