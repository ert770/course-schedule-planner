// roadmap #10 任務 4：探索清單服務。課程與 profile 都用注入的，不連 MySQL。
//
// 要釘住的契約：
//   - 起點（喜歡的課）與推薦候選是兩個集合：起點不限學期，候選只取當學期；
//   - 系外選修的認列狀態照實回傳，不說成「可計入畢業學分」；
//   - 推薦以課號為單位，班次物件原樣帶出，能直接交給既有的驗證；
//   - 通識沒有領域時不做單位分散；
//   - （ADR-033）只剩語意相似一種比較方式；至少一個相同的主題標籤（工具、上課方式、太常見不算），
//     分數 ≥ 0.40，只靠籠統標籤時 ≥ 0.45；0 學分課不當起點；
//   - （ADR-033）「依你的修課與興趣」至少一個完全相同的標籤，只靠相近標籤不列。
import { describe, test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { makeCourse } from './fixtures.js';
import {
  exploreForUser,
  exploreByProfile,
  EXPLORATION_CACHE_TTL_MS,
  FAVORITE_SOURCE,
  RECOGNITION_STATUS,
  resetExplorationCache,
} from '../src/services/explorationService.js';
import { validateScheduleAgainstConstraints } from '../src/skills/scheduleValidator.js';
import { buildCourseTextDocuments, buildCourseTextEmbeddingIndex, COURSE_TEXT_VECTOR_VERSION } from '../src/skills/courseTextVector.js';
import { interestTagCatalog } from '../src/data/interestTagCatalog.js';
import { DEFAULT_TAG_DOWNWEIGHTS } from '../src/skills/tagVectorSpace.js';
import { TAG_KIND, tagKind, GENERIC_TAG_DEPARTMENT_SPREAD } from '../src/skills/explorationTagGate.js';
import tagNeighbors from '../src/data/tagVectorNeighbors.json' with { type: 'json' };

const ACTIVE = { year: 114, semester: '下學期' };
const PAST = { year: 113, semester: '上學期' };
const IDENTITY = { canonicalId: 'T1', numericId: '1' };

// 測試用的主題標籤：可跨課配對、沒有降權、彼此不在相近表裡。
const downweighted = new Set(Object.keys(DEFAULT_TAG_DOWNWEIGHTS.tags));
const neighborIds = id => new Set((tagNeighbors.neighbors[id] ?? []).map(item => item.canonicalTagId));
const topicTags = interestTagCatalog.canonicalTags
  .filter(tag => tagKind(tag.id) === TAG_KIND.TOPIC && !downweighted.has(tag.id));
const [TOPIC_A, TOPIC_B, TOPIC_C] = topicTags.reduce((picked, tag) => (
  picked.length < 3 && picked.every(other => !neighborIds(other.id).has(tag.id) && !neighborIds(tag.id).has(other.id))
    ? [...picked, tag] : picked
), []).map(tag => tag.name);
const nameWhere = predicate => interestTagCatalog.canonicalTags.find(predicate).name;
const TOOL_TAG = nameWhere(tag => tagKind(tag.id) === TAG_KIND.TOOL && tag.eligibility?.crossCourseMatchEligible);
const FORMAT_TAG = nameWhere(tag => tagKind(tag.id) === TAG_KIND.FORMAT && tag.eligibility?.crossCourseMatchEligible);

const AI = '人工智慧與機器學習的原理，包含神經網路與深度學習。';
const NET = '網路通訊協定與資訊安全，包含加密與防火牆。';

// 假的「課程內容」：依說明裡的關鍵字給主題標籤與文字向量，模擬真實資料中兩者大致一致的情形。
const AI_WORDS = ['人工智慧', '機器學習', '深度學習'];
const NET_WORDS = ['資訊安全'];
const has = (text, words) => words.some(word => String(text ?? '').includes(word));
function topicsOf(description) {
  return [...(has(description, AI_WORDS) ? [TOPIC_A] : []), ...(has(description, NET_WORDS) ? [TOPIC_B] : [])];
}
function textVectorOf(description) {
  const raw = [has(description, AI_WORDS) ? 1 : 0, has(description, NET_WORDS) ? 1 : 0, 0.05];
  const norm = Math.hypot(...raw);
  return raw.map(value => value / norm);
}

let nextId = 1;
function section(catalogCourseCode, name, department, description, overrides = {}) {
  const id = nextId;
  nextId += 1;
  return makeCourse(id, {
    name, catalogCourseCode, code: catalogCourseCode, department, description,
    category: '選修', type: '選修', credits: 3, gradeLevel: 3,
    dayOfWeek: (id % 5) + 1, startPeriod: 3, endPeriod: 4,
    timeBlocks: [{ dayOfWeek: (id % 5) + 1, startPeriod: 3, endPeriod: 4 }],
    ragTag: topicsOf(description),
    ...ACTIVE,
    ...overrides,
  });
}

// 填充課：沒有主題標籤，也不會被推薦；保留它們讓課程資料不只幾門。
function fillers() {
  const texts = ['會計報表編製', '土木結構力學', '財務金融市場', '行銷策略管理', '建築空間設計',
    '材料熱處理', '國際貿易實務', '統計抽樣調查', '化學反應工程', '光電元件製程'];
  return texts.map((text, index) => section(`FILL${index}`, `填充${index}`, '填充一甲', text, {
    gradeLevel: 1, ...PAST,
  }));
}

const unit = values => { const n = Math.hypot(...values); return Float32Array.from(values, v => v / n); };

// 探索向量（ADR-035）：課名、課程說明、課程主題三個欄位。測試中三欄預設相同（依說明關鍵字），
// `vectors` 可覆寫課號的三欄（陣列＝三欄同值；物件＝逐欄），`historyOnly` 是只有課名向量的課（本學期沒開）。
function vectorLoader(courses, vectors = {}, historyOnly = {}) {
  const entries = new Map();
  for (const course of courses) {
    const code = String(course.catalogCourseCode).toUpperCase();
    if (entries.has(code) || !course.description) continue;
    const override = vectors[code];
    const base = Array.isArray(override) ? override : textVectorOf(course.description);
    const field = name => (override && !Array.isArray(override) && name in override
      ? (override[name] ? unit(override[name]) : null) : unit(base));
    entries.set(code, { source: 'catalog', name: course.name,
      vectors: { name: field('name'), description: field('description'), topic: field('topic') } });
  }
  for (const [code, values] of Object.entries(historyOnly)) {
    entries.set(code, { source: 'history', name: code, vectors: { name: unit(values), description: null, topic: null } });
  }
  return async () => ({ available: true,
    index: { entries, method: { model: 'fixture-only', dimension: 3, generatedAt: '2026-11-24T00:00:00Z' } } });
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
    loadExplorationVectors: vectorLoader(courses),
    ...extra,
  });
}

beforeEach(() => {
  resetExplorationCache();
  nextId = 1;
});

test('XS0 測試用標籤分類正確', () => {
  assert.ok(TOPIC_A && TOPIC_B && TOPIC_C && TOOL_TAG && FORMAT_TAG);
});

describe('XS1 起點與候選分開', () => {
  // 起點課只在過去的學期開過；它不是推薦候選，但內容還在，所以能當起點。
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

  test('XS1c 沒有探索向量的已修課不能當起點並標明原因；本學期沒開的課有課名向量也能當起點', async () => {
    const courses = [section('IECS3059', '人工智慧導論', '資訊三合', AI), section('COME3046', '機器學習', '通訊三甲', AI), ...fillers()];
    const loader = vectorLoader(courses, {}, { IECS2007: [1, 0, 0.05] });
    const result = await run(courses, [
      history('IECS3059', '人工智慧導論', 80),
      history('CHIN2011', '中國文學史(二)', 95, { graduationCategory: 'general' }),
      history('IECS2007', '離散數學', 70),
    ], {}, { loadExplorationVectors: loader });
    const of = code => result.favorites.find(item => item.courseCode === code);
    assert.deepEqual([of('CHIN2011').available, of('CHIN2011').reason], [false, 'no-course-vector']);
    assert.equal(of('IECS2007').available, true);

    const chosen = await run(courses, [history('CHIN2011', '中國文學史(二)', 95)], { favoriteCourseCode: 'CHIN2011' }, { loadExplorationVectors: loader });
    assert.equal(chosen.favorite, null);
    assert.equal(chosen.emptyReason, 'favorite-no-course-vector');

    // 只有課名向量的起點只比課名。
    const nameOnly = await run(courses, [history('IECS2007', '離散數學', 70)], { favoriteCourseCode: 'IECS2007' }, { loadExplorationVectors: loader });
    const [item] = nameOnly.outside.items;
    assert.equal(item.courseCode, 'COME3046');
    assert.equal(item.semanticMatch.parts.description, null);
    assert.equal(item.semanticMatch.parts.topic, null);
    assert.ok(item.semanticMatch.parts.name > 0.9);
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

  // 2026-11-24 使用者決定：不計入畢業學分的課（體育、國防科技、班級活動）與實習課不進探索。
  test('XS1e 體育、國防、班級活動與實習課不列為起點，也不推薦', async () => {
    const courses = [
      section('ATHL1004', '體育(二)', '體育一甲', AI),
      section('MILT1035', '國防科技', '共同一甲', AI),
      section('GEID0010', '班級活動', '資訊三合', AI, { credits: 0 }),
      section('IECS2061', '資料結構實習', '資訊二合', AI),
      section('IECS3059', '人工智慧導論', '資訊三合', AI),
      section('ATHL2001', '體育－羽球', '體育二甲', AI),
      section('COME3046', '機器學習', '通訊三甲', AI),
      ...fillers(),
    ];
    const result = await run(courses, [
      history('ATHL1004', '體育(二)', 90), history('MILT1035', '國防科技', 90),
      history('GEID0010', '班級活動', 90, { credits: 0 }), history('IECS2061', '資料結構實習', 90),
      history('IECS3059', '人工智慧導論', 80),
    ]);
    assert.deepEqual(result.favorites.map(item => item.courseCode), ['IECS3059']);
    const codes = [...result.outside.items, ...result.general.items].map(item => item.courseCode);
    assert.equal(codes.includes('ATHL2001'), false);
    await assert.rejects(run(courses, [history('ATHL1004', '體育(二)', 90)], { favoriteCourseCode: 'ATHL1004' }),
      error => error.code === 'FAVORITE_NOT_IN_HISTORY');
  });

  // 2026-11-24 使用者決定：全校共同必修（中文思辨與表達、大學基礎／精進英文、核心必修）也不進探索。
  test('XS1f 全校共同必修不列為起點，也不推薦；同內容的一般課照常推薦', async () => {
    const courses = [
      section('CHIN1066', '中文思辨與表達(二)', '國文綜合班', AI),
      section('ENGL1027', '大學基礎英文(二)中級', '通訊三甲', AI),
      section('ENGL1056', '大學精進英文(二)中級', '通訊三甲', AI),
      section('GEG2000', '現代公民與社會實踐', '通訊三甲', AI),
      section('IECS3059', '人工智慧導論', '資訊三合', AI),
      section('COME3046', '機器學習', '通訊三甲', AI),
      ...fillers(),
    ];
    const result = await run(courses, [
      history('CHIN1066', '中文思辨與表達(二)', 90), history('ENGL1026', '大學基礎英文(二)初級', 90),
      history('GEK2000', '科學與人文的對話', 90), history('IECS3059', '人工智慧導論', 80),
    ]);
    assert.deepEqual(result.favorites.map(item => item.courseCode), ['IECS3059']);
    const codes = [...result.outside.items, ...result.general.items].map(item => item.courseCode);
    assert.ok(codes.includes('COME3046'));
    for (const code of ['ENGL1027', 'ENGL1056', 'GEG2000']) assert.equal(codes.includes(code), false, code);
    await assert.rejects(run(courses, [history('CHIN1066', '中文思辨與表達(二)', 90)], { favoriteCourseCode: 'CHIN1066' }),
      error => error.code === 'FAVORITE_NOT_IN_HISTORY');
  });
});

describe('XS2 預設起點與空狀態', () => {
  test('XS2 起點選單依課名排序（英文 A～Z 在前、中文依筆畫），未指定時取第一門並標明是系統代選', async () => {
    const courses = [
      section('IECS3059', '資料探勘', '資訊三合', AI),
      section('IECS4052', 'Web程式設計', '資訊三合', NET),
      section('IECS1001', 'Python程式設計', '資訊三合', AI),
      section('GEX1', '人工智慧與社會', '科技知識原理與趨勢浪潮', AI),
      ...fillers(),
    ];
    const result = await run(courses, [
      history('IECS3059', '資料探勘', 99),
      history('IECS4052', 'Web程式設計', 60),
      history('IECS1001', 'Python程式設計', 70),
      history('GEX1', '人工智慧與社會', 95, { graduationCategory: 'general' }),
    ]);
    assert.deepEqual(result.favorites.map(item => item.name), ['Python程式設計', 'Web程式設計', '人工智慧與社會', '資料探勘']);
    assert.deepEqual(result.favorite, { courseCode: 'IECS1001', name: 'Python程式設計', source: FAVORITE_SOURCE.SYSTEM_DEFAULT });
  });

  test('XS2b 沒有修課紀錄', async () => {
    const result = await run([section('COME3046', '機器學習', '通訊三甲', AI), ...fillers()], []);

    assert.equal(result.favorite, null);
    assert.equal(result.emptyReason, 'no-course-history');
    assert.deepEqual(result.outside.items, []);
  });

  test('XS2c 有修課紀錄但都不能當起點', async () => {
    const result = await run(fillers(), [history('CHIN2011', '中國文學史(二)', 95)]);

    assert.equal(result.favorite, null);
    assert.equal(result.emptyReason, 'no-available-favorite');
  });

  test('XS2d 課程內容比較資料不可用時回空狀態，不改用其他方法', async () => {
    const courses = [section('IECS3059', '人工智慧導論', '資訊三合', AI), ...fillers()];
    const result = await run(courses, [history('IECS3059', '人工智慧導論', 90)], {}, {
      loadExplorationVectors: async () => ({ available: false, reason: 'exploration-vectors-unavailable' }),
    });
    assert.equal(result.emptyReason, 'exploration-vectors-unavailable');
    assert.deepEqual(result.outside.items, []);
  });

  test('XS2e「共同用詞」已停用：representation 只接受 embedding', async () => {
    const courses = [section('IECS3059', '人工智慧導論', '資訊三合', AI), ...fillers()];
    const fav = [history('IECS3059', '人工智慧導論', 90)];
    for (const representation of ['tfidf', 'unknown']) {
      await assert.rejects(run(courses, fav, { representation }), error => error.code === 'INVALID_EXPLORATION_REPRESENTATION');
    }
    const explicit = await run(courses, fav, { representation: 'embedding' });
    assert.equal(explicit.emptyReason, null);
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
      loadExplorationVectors: vectorLoader(courses),
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
      loadExplorationVectors: vectorLoader(courses),
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

  assert.equal(result.method.representation, 'course-exploration-vectors-v1');
  assert.deepEqual(result.method.fields, ['name', 'description', 'topic']);
  assert.equal(result.method.selection, 'one-per-unit-cosine');
  assert.equal(result.method.minSimilarity, 0.55);
  const [item] = result.outside.items;
  assert.equal(Object.hasOwn(item, 'vector'), false);
  assert.equal(Object.hasOwn(item, 'sharedTerms'), false);
  assert.ok(item.similarity >= 0.55 && item.similarity <= 1);
  assert.equal(item.semanticMatch.sourceCourseCode, 'IECS3059');
  assert.deepEqual(Object.keys(item.semanticMatch.parts), ['name', 'description', 'topic']);
  assert.deepEqual(item.semanticMatch.commonTags, [TOPIC_A]);
  assert.equal(result.favorites.every(f => !Object.hasOwn(f, 'graduationCategory')), true);
});

// 階段 4：「依你的修課與興趣」模式（標籤空間使用者向量）。
describe('XS9 依修課與興趣探索', () => {
  const [a, b, c, d] = [TOPIC_A, TOPIC_B, TOPIC_C, topicTags.at(-1).name];
  const tagged = (code, name, department, ragTag, overrides = {}) => section(code, name, department, '', { ragTag, ...overrides });
  const electiveHistory = history('IECS3200', '已修選修', 90, { requirementType: '選修', graduationCategory: 'elective' });
  const consented = { loadEvents: async () => ({ consented: true, events: [] }) };
  const runProfile = (courses, courseHistory, extra = consented) => exploreByProfile(IDENTITY, {
    loadCourses: async () => courses,
    loadProfile: async () => profile(courseHistory),
    ...extra,
  });

  test('XS9 依使用者向量排序、每系一門，理由引用修過的課；講課與實習課合併', async () => {
    const courses = [
      tagged('IECS3200', '已修選修', '資訊三合', [a, b], PAST),
      tagged('COME1', '通訊相近課', '通訊三甲', [a, b]),
      tagged('COME2', '通訊次相近課', '通訊三甲', [a]),
      tagged('ACCT1', '會計相近課', '會計二甲', [b, c]),
      tagged('ACCT1P', '會計相近課實習', '會計二甲', [b, c]),
      tagged('LAW1', '無關課', '財法三甲', [d]),
      ...fillers(),
    ];
    const result = await runProfile(courses, [electiveHistory]);

    assert.equal(result.mode, 'profile');
    assert.equal(result.emptyReason, null);
    assert.equal(result.method.requireExactTag, true);
    const codes = result.outside.items.map(item => item.courseCode);
    assert.deepEqual(codes, ['COME1', 'ACCT1'], '每個系所只取最相近的一門，無關課不列');
    const acct = result.outside.items.find(item => item.courseCode === 'ACCT1');
    assert.deepEqual(acct.sections.map(s => s.catalogCourseCode).sort(), ['ACCT1', 'ACCT1P']);
    assert.equal(result.outside.items[0].reasons.closestEvidence.courseCode, 'IECS3200');
    assert.equal(result.outside.items[0].reasons.closestEvidence.source, 'history');
    assert.ok(result.outside.items[0].reasons.tags.some(tag => tag.courseTag === a));
    assert.equal('vector' in result.outside.items[0], false);
    assert.equal(result.signals.historyCourses, 1);
  });

  test('XS9b 未同意個人化學習時不計算，沒有任何訊號時回報原因', async () => {
    const courses = [tagged('IECS3200', '已修選修', '資訊三合', [a, b], PAST), tagged('COME1', '通訊相近課', '通訊三甲', [a, b]), ...fillers()];
    const noConsent = await runProfile(courses, [electiveHistory], { loadEvents: async () => ({ consented: false, events: [] }) });
    assert.equal(noConsent.emptyReason, 'no-personalization-consent');
    assert.deepEqual(noConsent.outside.items, []);
    assert.equal(noConsent.signals, null);

    const requiredOnly = await runProfile(courses, [history('IECS3200', '已修必修', 90)]);
    assert.equal(requiredOnly.emptyReason, 'no-profile-signal', '必修不進使用者向量');
  });

  test('XS9c 從一門課出發的模式也合併講課與實習課，並標明模式', async () => {
    const courses = [
      section('IECS3059', '人工智慧導論', '資訊三合', AI),
      section('COME3046', '機器學習', '通訊三甲', AI),
      section('COME3046P', '機器學習實習', '通訊三甲', AI),
      ...fillers(),
    ];
    const result = await run(courses, [history('IECS3059', '人工智慧導論', 90)]);
    assert.equal(result.mode, 'favorite');
    assert.deepEqual(result.outside.items.map(item => item.courseCode), ['COME3046']);
    assert.equal(result.outside.items[0].sections.length, 2);
  });

  // ADR-033：只靠相近標籤（或只有工具、上課方式標籤相同）的課不列，換下一門完全相同的課補上。
  test('XS9d 至少一個完全相同、且不是工具或上課方式的標籤', async () => {
    const [left, right] = Object.entries(tagNeighbors.neighbors)
      .flatMap(([id, list]) => list.map(item => [id, item.canonicalTagId]))
      .find(([x, y]) => [x, y].every(id => tagKind(id) === TAG_KIND.TOPIC && !downweighted.has(id)));
    const nameOf = id => interestTagCatalog.canonicalTags.find(tag => tag.id === id).name;
    const courses = [
      tagged('IECS3200', '已修選修', '資訊三合', [nameOf(left), TOOL_TAG, FORMAT_TAG], PAST),
      tagged('NEAR1', '只有相近標籤', '通訊三甲', [nameOf(right)]),
      tagged('TOOL1', '只有相同工具', '會計二甲', [TOOL_TAG]),
      tagged('FMT1', '只有相同上課方式', '財法三甲', [FORMAT_TAG]),
      tagged('EXACT1', '完全相同', '機電三甲', [nameOf(left)]),
      ...fillers(),
    ];
    const result = await runProfile(courses, [electiveHistory]);
    assert.deepEqual(result.outside.items.map(item => item.courseCode), ['EXACT1']);
    assert.ok(result.outside.items[0].reasons.tags.some(tag => tag.courseTag === nameOf(left) && !tag.viaNeighbor),
      '理由要列出入選依據的完全相同標籤');
  });
});

describe('XS10 三種相近程度與門檻（ADR-035）', () => {
  const fav = [history('IECS3059', '人工智慧導論', 90)];
  // 與起點 [1,0,0] 的 cosine 為 c 的向量。
  const at = c => [c, Math.sqrt(1 - c ** 2), 0];

  test('XS10 分數是三欄平均，未達 0.55 不列；仍排除舊學期、已修與沒有時間的課', async () => {
    const courses = [
      section('IECS3059', '人工智慧導論', '資訊三合', AI),
      section('HIGH', '高分課', '通訊三甲', AI),
      section('MIXED', '課名不像但內容像', '機電三甲', AI),
      section('LOW', '低分課', '會計二甲', AI),
      section('OLD', '舊課', '財法三甲', AI, PAST),
      section('NOTIME', '沒時間的課', '企管三甲', AI, { timeBlocks: [], dayOfWeek: null }),
      ...fillers(),
    ];
    const vectors = {
      IECS3059: [1, 0, 0],
      HIGH: at(0.9),
      // 課名 0.2、說明 0.8、主題 0.8 → 平均 0.6
      MIXED: { name: at(0.2), description: at(0.8), topic: at(0.8) },
      // 平均 0.5
      LOW: at(0.5),
      OLD: [1, 0, 0], NOTIME: [1, 0, 0],
    };
    const result = await run(courses, fav, { favoriteCourseCode: 'IECS3059' }, { loadExplorationVectors: vectorLoader(courses, vectors) });
    const byCode = Object.fromEntries(result.outside.items.map(item => [item.courseCode, item]));
    assert.deepEqual(result.outside.items.map(item => item.courseCode), ['HIGH', 'MIXED']);
    assert.ok(Math.abs(byCode.MIXED.similarity - 0.6) < 0.001);
    assert.deepEqual(byCode.MIXED.semanticMatch.parts, { name: 0.2, description: 0.8, topic: 0.8 });
  });

  test('XS10b 只有一邊有的欄位不比，平均只算兩邊都有的欄位', async () => {
    const courses = [section('IECS3059', '人工智慧導論', '資訊三合', AI), section('NODESC', '沒有說明向量', '通訊三甲', AI), ...fillers()];
    const vectors = { IECS3059: [1, 0, 0], NODESC: { name: at(0.7), description: null, topic: at(0.5) } };
    const result = await run(courses, fav, { favoriteCourseCode: 'IECS3059' }, { loadExplorationVectors: vectorLoader(courses, vectors) });
    const [item] = result.outside.items;
    assert.equal(item.courseCode, 'NODESC');
    assert.ok(Math.abs(item.similarity - 0.6) < 0.001);
    assert.equal(item.semanticMatch.parts.description, null);
  });
});
