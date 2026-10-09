// roadmap #10 任務 4：探索清單服務。課程與 profile 都用注入的，不連 MySQL。
//
// 要釘住的契約：
//   - 起點（喜歡的課）與推薦候選是兩個集合：起點不限學期，候選只取當學期；
//   - 系外選修的認列狀態照實回傳，不說成「可計入畢業學分」；
//   - 推薦以課號為單位，班次物件原樣帶出，能直接交給既有的驗證；
//   - 通識沒有領域時不做單位分散。
import { describe, test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { makeCourse } from './fixtures.js';
import {
  exploreForUser,
  EXPLORATION_CACHE_TTL_MS,
  FAVORITE_SOURCE,
  RECOGNITION_STATUS,
  resetExplorationCache,
} from '../src/services/explorationService.js';
import { validateScheduleAgainstConstraints } from '../src/skills/scheduleValidator.js';

const ACTIVE = { year: 114, semester: '下學期' };
const PAST = { year: 113, semester: '上學期' };
const IDENTITY = { canonicalId: 'T1', numericId: '1' };

const AI = '人工智慧與機器學習的原理，包含神經網路與深度學習。';
const NET = '網路通訊協定與資訊安全，包含加密與防火牆。';

let nextId = 1;
function section(catalogCourseCode, name, department, description, overrides = {}) {
  const id = nextId;
  nextId += 1;
  return makeCourse(id, {
    name, catalogCourseCode, code: catalogCourseCode, department, description,
    category: '選修', type: '選修', credits: 3, gradeLevel: 3,
    dayOfWeek: (id % 5) + 1, startPeriod: 3, endPeriod: 4,
    timeBlocks: [{ dayOfWeek: (id % 5) + 1, startPeriod: 3, endPeriod: 4 }],
    ...ACTIVE,
    ...overrides,
  });
}

// 填充課：把文件數撐大，讓測試用的詞不會因為出現比例太高被當成停用詞。
function fillers() {
  const texts = ['會計報表編製', '土木結構力學', '財務金融市場', '行銷策略管理', '建築空間設計',
    '材料熱處理', '國際貿易實務', '統計抽樣調查', '化學反應工程', '光電元件製程',
    '水利防洪規劃', '都市計畫法規', '運輸物流配送', '保險精算評價', '中古文學選讀',
    '西洋音樂賞析', '有機合成實驗', '流體動量傳遞', '航太推進系統', '纖維紡織加工',
    '財政租稅制度', '勞動法令解析', '合作經濟組織', '科技管理個案', '景觀植栽配置',
    '室內照明規劃', '歷史文獻考證', '日語會話練習', '德語文法入門', '運動生理評估'];
  return texts.map((text, index) => section(`FILL${index}`, `填充${index}`, '填充一甲', text, {
    gradeLevel: 1, ...PAST,
  }));
}

function history(courseCode, courseName, score, extra = {}) {
  return {
    academicYear: 113, semester: 1, courseCode, courseName, score, letterGrade: null,
    credits: 3, passed: score >= 60, requirementType: '必修',
    generalEducationCategory: null, graduationCategory: 'required', ...extra,
  };
}

function profile(courseHistory) {
  return {
    department: '資訊工程學系', gradeLevel: 3, className: '資訊三乙',
    targetCreditsMin: 12, targetCreditsMax: 25, courseHistory,
  };
}

function run(courses, courseHistory, input = {}, extra = {}) {
  return exploreForUser(IDENTITY, input, {
    loadCourses: async () => courses,
    loadProfile: async () => profile(courseHistory),
    ...extra,
  });
}

beforeEach(() => {
  resetExplorationCache();
  nextId = 1;
});

describe('XS1 起點與候選分開', () => {
  // 起點課只在過去的學期開過；它不是推薦候選，但說明還在，所以能當起點。
  test('XS1 本學期沒開的已修課仍可當起點', async () => {
    const courses = [
      section('IECS3059', '人工智慧導論', '資訊三合', AI, PAST),
      section('COME3046', '機器學習', '通訊三甲', AI),
      ...fillers(),
    ];
    const result = await run(courses, [history('IECS3059', '人工智慧導論', 90)], { favoriteCourseCode: 'IECS3059' });

    assert.deepEqual(result.favorite, { courseCode: 'IECS3059', name: '人工智慧導論', source: FAVORITE_SOURCE.USER });
    assert.deepEqual(result.outside.items.map(item => item.courseCode), ['COME3046']);
  });

  test('XS1b 非當學期的班次即使最相似也不會被推薦', async () => {
    const courses = [
      section('IECS3059', '人工智慧導論', '資訊三合', AI),
      section('OLD1', '舊學期的機器學習', '通訊三甲', AI, PAST),
      section('NOW1', '本學期的網路課', '通訊三甲', `${NET}機器學習`),
      ...fillers(),
    ];
    const result = await run(courses, [history('IECS3059', '人工智慧導論', 90)], { favoriteCourseCode: 'IECS3059' });
    const codes = result.outside.items.map(item => item.courseCode);

    assert.equal(codes.includes('OLD1'), false);
    assert.deepEqual(codes, ['NOW1']);
  });

  // 唯一的不可用原因是「任何學期都查不到說明」，不是「本學期沒開」。
  test('XS1c 課程資料中完全查不到說明的已修課標為 no-description', async () => {
    const courses = [section('IECS3059', '人工智慧導論', '資訊三合', AI), ...fillers()];
    const result = await run(courses, [
      history('IECS3059', '人工智慧導論', 80),
      history('CHIN1065', '中文思辨與表達(一)', 95, { graduationCategory: 'general' }),
    ]);
    const missing = result.favorites.find(item => item.courseCode === 'CHIN1065');

    assert.deepEqual(
      { available: missing.available, reason: missing.reason },
      { available: false, reason: 'no-description' }
    );
    assert.equal(result.favorites.find(item => item.courseCode === 'IECS3059').available, true);
    await assert.rejects(
      run(courses, [history('CHIN1065', '中文思辨與表達(一)', 95)], { favoriteCourseCode: 'CHIN1065' }),
      error => error.status === 400 && error.code === 'FAVORITE_UNAVAILABLE'
    );
  });

  test('XS1d 不是已通過的課不能當起點', async () => {
    const courses = [section('IECS3059', '人工智慧導論', '資訊三合', AI), section('COME3046', '機器學習', '通訊三甲', AI), ...fillers()];
    await assert.rejects(
      run(courses, [history('IECS3059', '人工智慧導論', 40)], { favoriteCourseCode: 'IECS3059' }),
      error => error.status === 400 && error.code === 'FAVORITE_NOT_IN_HISTORY'
    );
    await assert.rejects(
      run(courses, [history('IECS3059', '人工智慧導論', 90)], { favoriteCourseCode: 'COME3046' }),
      error => error.code === 'FAVORITE_NOT_IN_HISTORY'
    );
  });
});

describe('XS2 預設起點與空狀態', () => {
  test('XS2 未指定時取成績最高、有說明的本系課，並標明是系統代選', async () => {
    const courses = [
      section('IECS3059', '人工智慧導論', '資訊三合', AI),
      section('IECS4052', '資訊與網路安全', '資訊三合', NET),
      section('GEX1', '通識課', '科技知識原理與趨勢浪潮', '科學史'),
      ...fillers(),
    ];
    const result = await run(courses, [
      history('IECS3059', '人工智慧導論', 70),
      history('IECS4052', '資訊與網路安全', 88),
      // 成績最高但不是本系課，不該被選為預設。
      history('GEX1', '通識課', 99, { graduationCategory: 'general' }),
    ]);

    assert.deepEqual(result.favorite, {
      courseCode: 'IECS4052', name: '資訊與網路安全', source: FAVORITE_SOURCE.SYSTEM_DEFAULT,
    });
  });

  test('XS2b 沒有修課紀錄', async () => {
    const result = await run([section('COME3046', '機器學習', '通訊三甲', AI), ...fillers()], []);

    assert.equal(result.favorite, null);
    assert.equal(result.emptyReason, 'no-course-history');
    assert.deepEqual(result.outside.items, []);
  });

  test('XS2c 有修課紀錄但都查不到說明', async () => {
    const result = await run(fillers(), [history('CHIN1065', '中文思辨與表達(一)', 95)]);

    assert.equal(result.favorite, null);
    assert.equal(result.emptyReason, 'no-available-favorite');
  });
});

describe('XS3 候選的安全條件', () => {
  const base = () => [section('IECS3059', '人工智慧導論', '資訊三合', AI), ...fillers()];
  const fav = [history('IECS3059', '人工智慧導論', 90)];

  test('XS3 已通過的課不會被推薦', async () => {
    const courses = [...base(), section('COME3046', '機器學習', '通訊三甲', AI)];
    const result = await run(courses, [...fav, history('COME3046', '機器學習', 85, { graduationCategory: 'external' })]);

    assert.deepEqual(result.outside.items, []);
  });

  test('XS3b 沒有上課時間的班次不列入', async () => {
    const courses = [...base(), section('COME3046', '機器學習', '通訊三甲', AI, {
      dayOfWeek: null, startPeriod: null, endPeriod: null, timeBlocks: [],
    })];
    assert.deepEqual((await run(courses, fav)).outside.items, []);
  });

  // 不認列的系外選修（與本系課名重複）不該出現在探索清單。
  test('XS3c 機械條件判定不認列的系外選修不列入', async () => {
    const courses = [...base(), section('MCAE9999', '資料結構', '機電三甲', AI)];
    assert.deepEqual((await run(courses, fav)).outside.items, []);
  });

  test('XS3d 本系的課不算系外', async () => {
    const courses = [...base(), section('IECS3021', '程式語言', '資訊三合', AI)];
    assert.deepEqual((await run(courses, fav)).outside.items, []);
  });
});

describe('XS4 認列狀態照實回傳', () => {
  test('XS4 通過機械條件的系外選修標為仍須向系辦確認', async () => {
    const courses = [
      section('IECS3059', '人工智慧導論', '資訊三合', AI),
      section('COME3046', '機器學習', '通訊三甲', AI),
      ...fillers(),
    ];
    const [item] = (await run(courses, [history('IECS3059', '人工智慧導論', 90)])).outside.items;

    assert.equal(item.recognition.status, RECOGNITION_STATUS.NEEDS_OFFICE_CONFIRMATION);
    assert.equal(item.recognition.needsOfficeConfirmation, true);
    assert.equal(item.unit, '通訊工程學系');
  });

  // 系所不在支援清單時，系外選修的機械判定沒有跑過（checked: false）。
  test('XS4b 不支援的系所標為尚無法判定', async () => {
    const courses = [
      section('MGT3001', '管理學進階', '企管三甲', AI),
      section('COME3046', '機器學習', '通訊三甲', AI),
      ...fillers(),
    ];
    const result = await exploreForUser(IDENTITY, {}, {
      loadCourses: async () => courses,
      loadProfile: async () => ({
        department: '企業管理學系', gradeLevel: 3, className: '企管三甲',
        courseHistory: [history('MGT3001', '管理學進階', 90)],
      }),
    });
    const [item] = result.outside.items;

    assert.equal(item.courseCode, 'COME3046');
    assert.equal(item.recognition.status, RECOGNITION_STATUS.UNCHECKED);
    assert.equal(item.recognition.checked, false);
  });

  test('XS4c 通識帶領域與規則版本，不另加認列承諾', async () => {
    const courses = [
      section('IECS3059', '人工智慧導論', '資訊三合', AI),
      section('GEK1005', '人工智慧入門與省思', '科技知識原理與趨勢浪潮', AI, { credits: 2 }),
      ...fillers(),
    ];
    const [item] = (await run(courses, [history('IECS3059', '人工智慧導論', 90)])).general.items;

    assert.deepEqual(item.recognition, {
      status: RECOGNITION_STATUS.GENERAL_EDUCATION, ruleVersion: '112-114', domain: '科技知識原理與趨勢浪潮',
    });
    assert.equal(item.unit, '科技知識原理與趨勢浪潮');
  });
});

describe('XS5 推薦單位是課號，加入課表的單位是班次', () => {
  const courses = () => [
    section('IECS3059', '人工智慧導論', '資訊三合', AI),
    section('COME3046', '機器學習', '通訊三甲', AI, { instructor: '甲老師', dayOfWeek: 1, timeBlocks: [{ dayOfWeek: 1, startPeriod: 3, endPeriod: 4 }] }),
    section('COME3046', '機器學習', '通訊三乙', AI, { instructor: '乙老師', dayOfWeek: 2, timeBlocks: [{ dayOfWeek: 2, startPeriod: 6, endPeriod: 7 }] }),
    ...fillers(),
  ];
  const fav = [history('IECS3059', '人工智慧導論', 90)];

  test('XS5 同課號兩個班次合成一筆推薦，兩個班次都帶出', async () => {
    const result = await run(courses(), fav);

    assert.equal(result.outside.items.length, 1);
    const [item] = result.outside.items;
    assert.deepEqual(item.sections.map(s => s.instructor).sort(), ['乙老師', '甲老師']);
    assert.equal(result.poolSize.outsideCourses, 1);
  });

  // 班次物件要能原樣交給既有的加課流程：驗證讀 timeBlocks、term、eligibility 等欄位。
  test('XS5b 班次是完整的標準物件', async () => {
    const [item] = (await run(courses(), fav)).outside.items;

    for (const s of item.sections) {
      for (const key of ['id', 'catalogCourseCode', 'timeBlocks', 'term', 'credits', 'category', 'eligibility']) {
        assert.ok(Object.hasOwn(s, key), `班次缺少 ${key}`);
      }
      assert.equal(s.term.isActiveTerm, true);
      assert.equal(s.category, '系外選修');
      assert.ok(s.outsideElective, '系外選修要帶認列評估');
    }
  });

  test('XS5c 回傳的班次原樣送進驗證器不會因缺欄位被誤判', async () => {
    const [item] = (await run(courses(), fav)).outside.items;
    const constraints = { department: '資訊工程學系', gradeLevel: 3, className: '資訊三乙', maxCredits: 25 };

    for (const s of item.sections) {
      const result = validateScheduleAgainstConstraints([s], constraints, { excludedCourses: [] });
      const hard = result.violations.filter(v => v.constraintId !== 'CREDIT_FLOOR');
      assert.deepEqual(hard.map(v => v.constraintId), [], `班次 ${s.id}`);
    }
    // 兩個班次時段不同；同時放進去只會因為「同一門課兩個班次」被擋，不是因為缺欄位。
    const both = validateScheduleAgainstConstraints(item.sections, constraints, { excludedCourses: [] });
    assert.ok(both.violations.some(v => v.constraintId === 'DUPLICATE_SECTION'));
  });
});

describe('XS6 通識的分散單位', () => {
  const fav = [history('IECS3059', '人工智慧導論', 90)];

  test('XS6 有領域時每個領域至多一門', async () => {
    const courses = [
      section('IECS3059', '人工智慧導論', '資訊三合', AI),
      section('GEK1', '人工智慧入門', '科技知識原理與趨勢浪潮', AI, { credits: 2 }),
      section('GEK2', '機器學習與社會', '科技知識原理與趨勢浪潮', `${AI}社會影響`, { credits: 2 }),
      section('GEW1', '深度學習的歷史', '世界格局與歷史地理視野', `深度學習的發展史。${NET}`, { credits: 2 }),
      ...fillers(),
    ];
    const result = await run(courses, fav);

    assert.equal(result.general.diversification, 'domain');
    const units = result.general.items.map(item => item.unit);
    assert.equal(new Set(units).size, units.length);
    assert.deepEqual(result.general.items.map(item => item.courseCode), ['GEK1', 'GEW1']);
  });

  // 115 學年度起通識不分領域（domain 為 null）。ACTIVE_TERM 目前是 114，無法直接放 115 的
  // 當學期班次；這裡用「被標為通識、開在學院綜合班（不屬於任何領域）」的課重現 domain 為 null 的情形。
  // 規則本身（任何一門沒有 unit 就整組不分散）另由 courseExploration.test.js 的 EX3d 驗證。
  test('XS6b 通識沒有領域時不做單位分散，取最相似的幾門不同課號', async () => {
    const general = (code, name, text) => section(code, name, '創能學院綜合班', text, {
      credits: 2, isGeneralEducation: true,
    });
    const courses = [
      section('IECS3059', '人工智慧導論', '資訊三合', AI),
      general('GEN1', '人工智慧入門', AI),
      general('GEN2', '機器學習與社會', `${AI}社會影響`),
      general('GEN3', '神經網路導讀', '神經網路與深度學習的入門'),
      ...fillers(),
    ];
    const result = await run(courses, fav);
    const codes = result.general.items.map(item => item.courseCode);

    assert.equal(result.general.diversification, 'none');
    assert.equal(codes.length, 3);
    assert.equal(new Set(codes).size, 3);
    assert.ok(result.general.items.every(item => item.unit === null && item.recognition.domain === null));
  });
});

describe('XS7 快取', () => {
  test('XS7 TTL 內不重新載入課程，過期後重新載入', async () => {
    let loads = 0;
    let clock = 1_000_000;
    const courses = [section('IECS3059', '人工智慧導論', '資訊三合', AI), ...fillers()];
    const deps = {
      loadCourses: async () => { loads += 1; return courses; },
      loadProfile: async () => profile([history('IECS3059', '人工智慧導論', 90)]),
      now: () => clock,
    };

    await exploreForUser(IDENTITY, {}, deps);
    await exploreForUser(IDENTITY, {}, deps);
    assert.equal(loads, 1);

    clock += EXPLORATION_CACHE_TTL_MS + 1;
    await exploreForUser(IDENTITY, {}, deps);
    assert.equal(loads, 2);

    resetExplorationCache();
    await exploreForUser(IDENTITY, {}, deps);
    assert.equal(loads, 3);
  });
});

test('XS8 回應帶方法說明且不含內部向量', async () => {
  const courses = [
    section('IECS3059', '人工智慧導論', '資訊三合', AI),
    section('COME3046', '機器學習', '通訊三甲', AI),
    ...fillers(),
  ];
  const result = await run(courses, [history('IECS3059', '人工智慧導論', 90)]);

  assert.deepEqual(result.method, { representation: 'tfidf-char-bigram', selection: 'one-per-unit-cosine', k: 5 });
  const [item] = result.outside.items;
  assert.equal(Object.hasOwn(item, 'vector'), false);
  assert.ok(item.similarity > 0 && item.similarity <= 1);
  assert.ok(Array.isArray(item.sharedTerms));
  assert.equal(result.favorites.every(f => !Object.hasOwn(f, 'graduationCategory')), true);
});
