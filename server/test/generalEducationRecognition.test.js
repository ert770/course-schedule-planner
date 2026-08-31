// Roadmap #23：通識的畢業認列（基礎必修／選修拆分、依入學年度選規則、過渡規則）。
//
// 核心性質：**拆分不得改變總數**。`basic + elective` 必須恆等於既有
// `getEarnedCredits().general`——這一格先前是單一桶，本輪只是把它再切成兩半，
// 不是換一套算法。G20 釘住這件事。

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  CORE_REQUIRED_COURSE_CODES,
  classifyGeneralEducationEntry,
  evaluateGeneralEducationProgress,
  resolveGeneralEducationRecognitionVersion,
  splitGeneralEducationCredits,
} from '../src/data/generalEducationRecognition.js';
import { getEarnedCredits } from '../src/data/courseHistory.js';

function ge(overrides = {}) {
  return {
    academicYear: 113,
    semester: 1,
    courseCode: 'GEH1028',
    courseName: '決策與賽局:溝通創造雙贏',
    credits: 2,
    passed: true,
    requirementType: '選修',
    generalEducationCategory: '(M)',
    graduationCategory: 'general',
    ...overrides,
  };
}

// demo 帳號的真實 12 筆通識（實查 MySQL user_id=1）：
// 基礎必修 8 門 16 學分（領域欄位皆為 null）、選修 4 門 8 學分（領域欄位有值）。
function demoGeneralEntries() {
  return [
    ge({ courseCode: 'CHIN1065', courseName: '中文思辨與表達(一)', credits: 2, academicYear: 112, generalEducationCategory: null, requirementType: '必修' }),
    ge({ courseCode: 'CHIN1066', courseName: '中文思辨與表達(二)', credits: 2, academicYear: 112, generalEducationCategory: null, requirementType: '必修' }),
    ge({ courseCode: 'ENGL1008', courseName: '大學基礎英文(一)中級', credits: 2, academicYear: 112, generalEducationCategory: null, requirementType: '必修' }),
    ge({ courseCode: 'ENGL1027', courseName: '大學基礎英文(二)中級', credits: 2, academicYear: 112, generalEducationCategory: null, requirementType: '必修' }),
    ge({ courseCode: 'ENGL1048', courseName: '大學精進英文(一)中級', credits: 2, academicYear: 113, generalEducationCategory: null, requirementType: '必修' }),
    ge({ courseCode: 'ENGL1056', courseName: '大學精進英文(二)中級', credits: 2, academicYear: 113, generalEducationCategory: null, requirementType: '必修' }),
    ge({ courseCode: 'GEK2000', courseName: '科學與人文的對話', credits: 2, academicYear: 112, generalEducationCategory: null, requirementType: '必修' }),
    ge({ courseCode: 'GEG2000', courseName: '現代公民與社會實踐', credits: 2, academicYear: 112, generalEducationCategory: null, requirementType: '必修' }),
    ge({ courseCode: 'GEG1016', courseName: '生態環境保育', credits: 2, academicYear: 113 }),
    ge({ courseCode: 'GEH1028', courseName: '決策與賽局:溝通創造雙贏', credits: 2, academicYear: 113 }),
    ge({ courseCode: 'GEH1081', courseName: '美好時光，社群聚場', credits: 2, academicYear: 113 }),
    ge({ courseCode: 'GEK1018', courseName: '奈米科技與生活', credits: 2, academicYear: 114, generalEducationCategory: '(N)' }),
  ];
}

const CS_REQUIREMENT = { generalBasic: 16, generalElective: 12 };

describe('G18 基礎必修與選修的切分', () => {
  test('G18 對 demo 真實資料切出 16／8，與實查 MySQL 的結果相符', () => {
    const split = splitGeneralEducationCredits(demoGeneralEntries());

    assert.equal(split.basic, 16);
    assert.equal(split.elective, 8);
    assert.equal(split.disagreements.length, 0, '12 筆真實資料兩個來源應完全一致');
  });

  test('G18 兩門核心必修由固定課號辨識，不靠課名', () => {
    const split = splitGeneralEducationCredits(demoGeneralEntries());

    assert.deepEqual(split.coreRequiredCompletedCodes.sort(), ['GEG2000', 'GEK2000']);
    assert.deepEqual(Object.keys(CORE_REQUIRED_COURSE_CODES).sort(), ['GEG2000', 'GEK2000']);
  });

  // 英文有初／中／高級，課號各不相同（實測同一位學生就有四個不同課號），
  // 因此基礎必修的非核心部分只能靠課名前綴。
  test('G18 不同級別的英文課號都能被認出是基礎必修', () => {
    const entries = [
      ge({ courseCode: 'ENGL9001', courseName: '大學基礎英文(一)初級', credits: 2, generalEducationCategory: null }),
      ge({ courseCode: 'ENGL9002', courseName: '大學精進英文(二)高級', credits: 2, generalEducationCategory: null }),
    ];

    assert.equal(splitGeneralEducationCredits(entries).basic, 4);
  });

  test('G18 兩個來源不一致時保守歸入選修並記錄，不靜默決定', () => {
    // 課名像基礎必修，但領域欄位有值——資料本身互相矛盾。
    const conflicting = ge({
      courseCode: 'CHIN1065', courseName: '中文思辨與表達(一)', generalEducationCategory: '(M)',
    });
    const split = splitGeneralEducationCredits([conflicting]);

    assert.equal(split.elective, 2, '歸選修才不會讓「基礎必修已修滿」提早成立');
    assert.equal(split.basic, 0);
    assert.equal(split.disagreements.length, 1);
    assert.deepEqual(
      { byIdentity: split.disagreements[0].byIdentity, byDomain: split.disagreements[0].byDomain },
      { byIdentity: 'basic', byDomain: 'elective' }
    );
  });

  test('G18 空清單回傳全 0，不丟例外', () => {
    const split = splitGeneralEducationCredits([]);

    assert.equal(split.basic, 0);
    assert.equal(split.elective, 0);
    assert.deepEqual(split.disagreements, []);
  });

  test('G18 classifyGeneralEducationEntry 對單筆的判定與理由都取得到', () => {
    assert.equal(classifyGeneralEducationEntry(ge()).bucket, 'elective');
    assert.equal(
      classifyGeneralEducationEntry(ge({ courseCode: 'GEK2000', generalEducationCategory: null })).bucket,
      'basic'
    );
  });
});

describe('G19 依入學年度選通識認列版本', () => {
  test('G19 112～114 入學：基礎必修 16 學分（含兩門核心必修 4 學分）', () => {
    const { entry, appliedFallbackVersion } = resolveGeneralEducationRecognitionVersion(112);

    assert.equal(entry.version, '112-114');
    assert.equal(entry.basicCredits, 16);
    assert.equal(entry.coreRequiredCredits, 4);
    assert.equal(appliedFallbackVersion, false);
  });

  test('G19 115 起入學：核心必修取消，基礎必修降為 12 學分', () => {
    const { entry } = resolveGeneralEducationRecognitionVersion(115);

    assert.equal(entry.version, 'from-115');
    assert.equal(entry.basicCredits, 12);
    assert.equal(entry.coreRequiredCredits, 0);
    assert.deepEqual(entry.coreRequiredCodes, []);
  });

  test('G19 入學年度未知或早於 112 時退回並說明，不自己發明一版', () => {
    for (const year of [null, 111]) {
      const { appliedFallbackVersion, fallbackReason } = resolveGeneralEducationRecognitionVersion(year);

      assert.equal(appliedFallbackVersion, true, `${year} 應標示退回`);
      assert.match(fallbackReason, /僅供參考/);
    }
  });

  test('G19 認抵上限有數值但明確標示目前無法執行', () => {
    const { entry } = resolveGeneralEducationRecognitionVersion(112);

    assert.equal(entry.recognitionCapCredits, 6);
    assert.equal(
      entry.recognitionCapEnforceable, false,
      '資料庫沒有欄位標記某門課是認抵來的，寫了也執行不到——不得宣稱有做'
    );
  });
});

describe('G20 通識畢業進度與總數一致性', () => {
  test('G20 拆分後的 basic + elective 恆等於 getEarnedCredits().general', () => {
    const entries = demoGeneralEntries();
    // 用同一批資料走既有的總數計算，兩邊必須對得起來。
    const earned = getEarnedCredits(entries);
    const progress = evaluateGeneralEducationProgress({
      generalEntries: entries, admissionYear: 112, requirement: CS_REQUIREMENT,
    });

    assert.equal(
      progress.basic.earned + progress.elective.earned, earned.general,
      '拆分只是把同一桶切成兩半，總數不得改變'
    );
    assert.equal(earned.general, 24);
  });

  test('G20 demo（112 入學）：基礎 16／16 已滿、選修 8／12 缺 4', () => {
    const progress = evaluateGeneralEducationProgress({
      generalEntries: demoGeneralEntries(), admissionYear: 112, requirement: CS_REQUIREMENT,
    });

    assert.deepEqual(progress.basic, { earned: 16, required: 16, gap: 0 });
    assert.deepEqual(progress.elective, { earned: 8, required: 12, gap: 4 });
    assert.equal(progress.ruleVersion, '112-114');
    assert.equal(progress.appliedFallbackVersion, false);
    assert.deepEqual(progress.coreRequired.missingCodes, []);
  });

  test('G20 系所自訂的通識學分優先於版本預設值（外文系英文學分與通則不同）', () => {
    const progress = evaluateGeneralEducationProgress({
      generalEntries: demoGeneralEntries(),
      admissionYear: 112,
      requirement: { generalBasic: 8, generalElective: 12 },
    });

    assert.equal(progress.basic.required, 8, '對照表有值就以它為準');
    assert.equal(progress.basic.gap, 0);
  });

  test('G20 查不到系所對照時退回版本預設值', () => {
    const progress = evaluateGeneralEducationProgress({
      generalEntries: demoGeneralEntries(), admissionYear: 115, requirement: null,
    });

    assert.equal(progress.basic.required, 12);
    assert.equal(progress.elective.required, 12);
  });

  test('G20 沒有修課紀錄時回全 0 缺口，不丟例外', () => {
    const progress = evaluateGeneralEducationProgress({
      generalEntries: [], admissionYear: 112, requirement: CS_REQUIREMENT,
    });

    assert.equal(progress.basic.earned, 0);
    assert.equal(progress.basic.gap, 16);
    assert.equal(progress.elective.gap, 12);
  });
});

describe('G21 核心必修過渡規則（唯一在現有資料上算得出來的一條）', () => {
  // 114 以前入學、未完成兩門核心必修者，可用多修的通識選修補足。
  // 來源：112 學年度起通識選修課程改革說明。
  test('G21 未完成核心必修但通識選修有剩：用剩餘學分補足基礎必修缺口', () => {
    const entries = demoGeneralEntries()
      // 拿掉兩門核心必修（基礎剩 12，缺 4）
      .filter(item => !['GEK2000', 'GEG2000'].includes(item.courseCode))
      // 補足通識選修到 16 學分（超出 12 的需求 4 學分）
      .concat([
        ge({ courseCode: 'GEX0001', courseName: '額外通識一', credits: 2 }),
        ge({ courseCode: 'GEX0002', courseName: '額外通識二', credits: 2 }),
        ge({ courseCode: 'GEX0003', courseName: '額外通識三', credits: 2 }),
        ge({ courseCode: 'GEX0004', courseName: '額外通識四', credits: 2 }),
      ]);

    const progress = evaluateGeneralEducationProgress({
      generalEntries: entries, admissionYear: 112, requirement: CS_REQUIREMENT,
    });

    assert.deepEqual(progress.coreRequired.missingCodes.sort(), ['GEG2000', 'GEK2000']);
    assert.equal(progress.elective.earned, 16, '通識選修 16 學分，超出需求 4 學分');
    assert.equal(progress.basic.gap, 0, '4 學分剩餘應補足基礎必修的 4 學分缺口');
    assert.ok(progress.notes.some(note => note.includes('過渡規則')), '要說明用了過渡規則');
  });

  // 反例：沒有多餘的通識選修就補不了，不得無中生有。
  test('G21 通識選修沒有剩餘時不補足，缺口照實回報', () => {
    const entries = demoGeneralEntries()
      .filter(item => !['GEK2000', 'GEG2000'].includes(item.courseCode));

    const progress = evaluateGeneralEducationProgress({
      generalEntries: entries, admissionYear: 112, requirement: CS_REQUIREMENT,
    });

    assert.equal(progress.elective.earned, 8, '選修 8 學分，未達 12，沒有剩餘可挪用');
    assert.equal(progress.basic.gap, 4, '缺口不得被憑空補掉');
    assert.equal(progress.notes.length, 0);
  });

  test('G21 115 起入學沒有核心必修，這條規則不適用', () => {
    const progress = evaluateGeneralEducationProgress({
      generalEntries: [], admissionYear: 115, requirement: null,
    });

    assert.deepEqual(progress.coreRequired.requiredCodes, []);
    assert.deepEqual(progress.coreRequired.missingCodes, []);
  });

  // 有官方出處但目前沒有資料可執行的規則，要明列出來而不是假裝有做。
  test('G21 無法執行的規則明列在 unverifiableRules，附阻塞原因', () => {
    const progress = evaluateGeneralEducationProgress({
      generalEntries: [], admissionYear: 112, requirement: null,
    });

    assert.equal(progress.unverifiableRules.length, 3);
    for (const item of progress.unverifiableRules) {
      assert.ok(item.rule, '要說明是哪一條規則');
      assert.ok(item.blockedBy, '要說明為什麼執行不了');
    }
    assert.ok(
      progress.unverifiableRules.some(item => item.rule.includes('認抵')),
      '跨院認抵上限必須列在無法執行的規則裡'
    );
  });
});
