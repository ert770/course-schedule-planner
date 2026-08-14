// 資料庫契約測試：斷言程式碼依賴的每一個資料假設。
//
// 其他測試刻意用合成資料，因為排課邏輯是純函式，合成資料才能穩定重現邊界情境。
// **但那也代表沒有任何測試會在資料庫變動時失敗。** 本檔補上這個缺口：
// 它直接連真實 MySQL，把「程式默默假設成立、一旦不成立就靜默出錯」的前提
// 全部寫成斷言。
//
// 每一條斷言都對應一個實際踩過的坑：
//
// | 斷言 | 對應的坑 |
// | --- | --- |
// | `subid3` 全部非空，且同一 `subid3` 會對到多個 `course_id` | 班次去重的整個前提 |
// | `dept` 的解析率不得低於基準，且假陽性名單為空 | 解析規則被改壞會立刻紅燈 |
// | `User_Profiles.department` 全部對得到 A 表 | 組員輸錯系所名稱會被抓到 |
// | `type` 只有 必修／選修 | 類別解析的前提 |
// | `time_str` 可解析率 | 時間解析與衝堂判定的前提 |
//
// **沒設定 `DB_*` 時整組標記為 skip**，測試輸出會顯示 skipped 而不是靜默通過
// ——「沒跑」與「跑過且通過」必須分得出來。
//
// 基準值以 2026-08-04 的資料庫實測為準，刻意留有餘裕：門檻是用來抓「規則被改壞」
// 或「資料大幅變動」，不是用來鎖死每一筆資料。

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  GENERAL_EDUCATION_DOMAINS_112_TO_114,
  RECOGNIZED_GENERAL_EDUCATION_COURSES_114_2,
} from '../src/data/generalEducationCatalog.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// `server/.env` 由 dotenv 在 app 啟動時載入，測試不經過 app，因此自行讀取。
// 這裡只解析 `KEY=VALUE`，不引入額外相依。
function loadEnvFile() {
  const envPath = path.join(__dirname, '..', '.env');
  if (!fs.existsSync(envPath)) return;

  for (const line of fs.readFileSync(envPath, 'utf-8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (process.env[key] !== undefined) continue;
    process.env[key] = rawValue.trim().replace(/^(['"])(.*)\1$/, '$2');
  }
}

loadEnvFile();

const DB_CONFIGURED = Boolean(process.env.DB_HOST && process.env.DB_USER && process.env.DB_NAME);
const skip = DB_CONFIGURED ? false : '未設定 DB_HOST／DB_USER／DB_NAME，跳過資料庫契約測試';

// 2026-08-04 實測值，作為基準。
const BASELINE = {
  distinctDepartments: 562,
  departmentClassRatio: 0.859,
  courseRows: 3086,
  sections: 3560,
  timeParseRatio: 0.937,
  profiles: 1,
};

// 門檻相對基準留的餘裕。
const RATIO_TOLERANCE = 0.05;
const COUNT_TOLERANCE = 0.25;

let queryRows;
let closePool;
let getAll;
let parseClassName;
let getAbbreviations;
let normalizeDepartment;

before(async () => {
  if (!DB_CONFIGURED) return;

  ({ queryRows, closePool } = await import('../src/db/mysql.js'));
  ({ getAll } = await import('../src/db/database.js'));
  ({ parseClassName } = await import('../src/skills/courseScope.js'));
  ({ getAbbreviations } = await import('../src/data/departmentMapping.js'));
  ({ normalizeDepartment } = await import('../src/utils/text.js'));
});

// 連線池會讓 test runner 的 event loop 一直不結束，`npm test` 因此永遠不會返回。
after(async () => {
  if (closePool) await closePool();
});

function atLeast(actual, baseline, tolerance) {
  return actual >= baseline * (1 - tolerance);
}

describe('資料庫契約：Courses.subid3 是課號，course_id 不是', () => {
  test('每一筆 Courses 都有非空的 subid3', { skip }, async () => {
    const [row] = await queryRows(
      'SELECT COUNT(*) AS total,'
      + ' SUM(CASE WHEN `subid3` IS NULL OR TRIM(`subid3`) = \'\' THEN 1 ELSE 0 END) AS blanks'
      + ' FROM `Courses`'
    );

    assert.equal(
      Number(row.blanks), 0,
      'subid3 是判定「同一門課」的唯一依據，空值會讓班次去重退回課名比對'
    );
    assert.ok(
      atLeast(Number(row.total), BASELINE.courseRows, COUNT_TOLERANCE),
      `Courses 筆數 ${row.total} 遠低於基準 ${BASELINE.courseRows}，資料可能不完整`
    );
  });

  test('同一 subid3 會對到多個 course_id —— 一課多班次確實存在', { skip }, async () => {
    // 若這個前提不成立，`getCourseKey()` 用 subid3 去重就是多餘的，
    // 反過來說它成立就代表**不能**用 course_id 當課程識別碼。
    const rows = await queryRows(
      'SELECT `subid3`, COUNT(DISTINCT `course_id`) AS sections'
      + ' FROM `Courses` GROUP BY `subid3` HAVING sections > 1'
    );

    assert.ok(rows.length > 0, '找不到任何一課多班次的資料，班次去重的前提不成立');

    const algorithms = await queryRows(
      'SELECT DISTINCT `course_id` FROM `Courses` WHERE `subid3` = ?', ['IECS3002']
    );
    assert.ok(
      algorithms.length > 1,
      '計算機演算法（IECS3002）應有多個班次的 course_id，這是 B1-B5 案例的資料來源'
    );
  });
});

describe('資料庫契約：Courses.dept 是班級名稱', () => {
  let names;

  before(async () => {
    if (!DB_CONFIGURED) return;
    const rows = await queryRows('SELECT DISTINCT `dept` FROM `Courses` WHERE `dept` IS NOT NULL');
    names = rows.map(row => row.dept);
  });

  test('相異班級名稱數量不得大幅偏離基準', { skip }, async () => {
    assert.ok(
      atLeast(names.length, BASELINE.distinctDepartments, COUNT_TOLERANCE),
      `相異 dept 值 ${names.length} 遠低於基準 ${BASELINE.distinctDepartments}`
    );
  });

  test('可解析為系所班級的比例不得低於基準', { skip }, async () => {
    // 解析規則（`parseClassName`）被改壞時，這條會立刻紅燈——
    // 比例掉下來代表大量班級名稱突然對不到系所，必修範圍會整批判錯。
    const resolved = names.filter(name => parseClassName(name).isDepartmentClass);
    const ratio = resolved.length / names.length;

    assert.ok(
      atLeast(ratio, BASELINE.departmentClassRatio, RATIO_TOLERANCE),
      `系所班級解析率 ${(ratio * 100).toFixed(1)}% 低於基準 `
      + `${(BASELINE.departmentClassRatio * 100).toFixed(1)}%`
    );
  });

  test('假陽性名單為空 —— 非系所班級不得被判成系所班級', { skip }, async () => {
    // 這些名稱開頭剛好是某個系所簡稱，只比對前綴會全部判錯。
    const nonDepartmentPatterns = [
      /英[A-Z]?班/u,
      /\((SFSU|Monash|UQ|SJSU|RMIT|UNSW)\)/u,
      /學院.*綜合班/u,
      /^國際生/u,
      /^未完成課程/u,
    ];
    const shouldNotResolve = names.filter(
      name => nonDepartmentPatterns.some(pattern => pattern.test(name))
    );

    assert.ok(shouldNotResolve.length > 0, '資料中找不到任何非系所班級樣態，看門條件失效');

    const falsePositives = shouldNotResolve.filter(
      name => parseClassName(name).isDepartmentClass
    );
    assert.deepEqual(falsePositives, [], '這些名稱不是系所班級，被誤判會讓必修範圍納入他系課程');
  });

  test('解析成功的班級都對得到系所全名', { skip }, async () => {
    const unmapped = names
      .map(name => parseClassName(name))
      .filter(parsed => parsed.isDepartmentClass && !parsed.department)
      .map(parsed => parsed.className);

    assert.deepEqual(unmapped, [], 'A 表缺少這些班級的系所簡稱，必修判定會漏掉整個系所');
  });
});

describe('資料庫契約：#12B 114-2 通識分類', () => {
  test('四領域課程都有正式課號，資料量不低於已核對基準', { skip }, async () => {
    const placeholders = GENERAL_EDUCATION_DOMAINS_112_TO_114.map(() => '?').join(',');
    const [row] = await queryRows(
      'SELECT COUNT(*) AS sections, COUNT(DISTINCT c.`subid3`) AS courseCodes,'
      + ' SUM(CASE WHEN c.`subid3` IS NULL OR TRIM(c.`subid3`) = \'\' THEN 1 ELSE 0 END) AS blanks'
      + ' FROM `Courses` c INNER JOIN `Course_Sections` cs'
      + ' ON BINARY c.`course_id` = BINARY cs.`course_id`'
      + ` WHERE cs.\`year\` = 114 AND cs.\`semester\` = '下學期'`
      + ` AND c.\`dept\` IN (${placeholders})`,
      GENERAL_EDUCATION_DOMAINS_112_TO_114
    );

    assert.equal(Number(row.blanks), 0, '四領域課程不得缺 catalogCourseCode');
    assert.ok(Number(row.courseCodes) >= 167, `通識正式課號只有 ${row.courseCodes} 筆`);
    assert.ok(Number(row.sections) >= 208, `通識班次只有 ${row.sections} 筆`);
  });

  test('114-2 三門跨院認抵課均可用正式課號對到唯一課程', { skip }, async () => {
    for (const expected of RECOGNIZED_GENERAL_EDUCATION_COURSES_114_2) {
      const rows = await queryRows(
        'SELECT c.`subid3`, c.`name`, c.`credits`, cs.`year`, cs.`semester`'
        + ' FROM `Courses` c INNER JOIN `Course_Sections` cs'
        + ' ON BINARY c.`course_id` = BINARY cs.`course_id`'
        + ' WHERE c.`subid3` = ? AND cs.`year` = ? AND cs.`semester` = ?',
        [expected.catalogCourseCode, expected.academicYear, expected.semester]
      );

      assert.equal(rows.length, 1, `${expected.catalogCourseCode} 應唯一對到 114-2 認抵課`);
      assert.equal(rows[0].name, expected.name);
      assert.equal(Number(rows[0].credits), expected.credits);
    }
  });
});

describe('資料庫契約：User_Profiles.department 必須對得到 A 表', () => {
  test('每一筆 profile 的系所都查得到簡稱', { skip }, async () => {
    // 組員把系所名稱打錯時，值看起來正常，但所有系所比對都不會成立，
    // 該使用者的必修範圍完全判不出來且沒有任何錯誤。
    const rows = await queryRows('SELECT `user_id`, `department` FROM `User_Profiles`');

    assert.ok(
      atLeast(rows.length, BASELINE.profiles, COUNT_TOLERANCE),
      `User_Profiles 筆數 ${rows.length} 低於基準 ${BASELINE.profiles}`
    );

    const bad = rows
      .map(row => ({ userId: row.user_id, department: normalizeDepartment(row.department) }))
      .filter(item => !item.department || getAbbreviations(item.department).length === 0);

    assert.deepEqual(
      bad, [],
      '這些 profile 的系所對不到 `docs/DEPARTMENT_MAPPING.md` 的 A 表，必修範圍將無法判定'
    );
  });
});

describe('資料庫契約：Courses.type 與時間欄位', () => {
  test('type 只有 必修 與 選修 兩種值', { skip }, async () => {
    // 排課引擎的類別優先度表另有 `核心選修`／`通識`／`系外選修`，
    // 那三個值必須由 `courseCategory.js` 解析產生，不會出現在資料裡。
    // 若哪天資料庫真的多出第三種值，解析規則要跟著改。
    const rows = await queryRows('SELECT DISTINCT `type` FROM `Courses` WHERE `type` IS NOT NULL');
    const types = rows.map(row => row.type).sort();

    assert.deepEqual(types, ['必修', '選修']);
  });

  test('time_str 的可解析率不得低於基準', { skip }, async () => {
    // 解析不出時段的課程不佔時段、不衝堂，也不受時間類限制。
    // 可解析率掉下來代表大量課程會變成「無限制」，被貪婪填充無限塞入。
    const courses = await getAll('courses');

    assert.ok(
      atLeast(courses.length, BASELINE.sections, COUNT_TOLERANCE),
      `section 筆數 ${courses.length} 遠低於基準 ${BASELINE.sections}`
    );

    const parsed = courses.filter(course => (course.timeBlocks || []).length > 0);
    const ratio = parsed.length / courses.length;

    assert.ok(
      atLeast(ratio, BASELINE.timeParseRatio, RATIO_TOLERANCE),
      `time_str 可解析率 ${(ratio * 100).toFixed(1)}% 低於基準 `
      + `${(BASELINE.timeParseRatio * 100).toFixed(1)}%`
    );
  });

  test('解析不出時段的課程都有可解釋的原因', { skip }, async () => {
    // 節次 `00` 代表尚未排定，`未決定` 是另一種寫法。除這兩類外不應有解析失敗，
    // 否則就是 `parseTimeBlocks()` 漏了某種格式。
    const courses = await getAll('courses');
    const unexplained = courses
      .filter(course => (course.timeBlocks || []).length === 0)
      .map(course => String(course.timeStr || '').trim())
      .filter(timeStr => timeStr && !/[(（]\s*[一二三四五六日天]\s*[)）]\s*00/u.test(timeStr))
      .filter(timeStr => !timeStr.includes('未決定'));

    assert.deepEqual(
      [...new Set(unexplained)], [],
      '出現無法解釋的 time_str 格式，parseTimeBlocks() 需補上對應規則'
    );
  });
});
