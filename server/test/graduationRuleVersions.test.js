// Roadmap #23：版本化畢業規則的解析。
//
// 這組測試釘住的核心性質是**誠實**：目前只有 114 學年度一版真實資料，
// 套用在其他入學年度的學生身上時，系統必須說出來，而不是假裝那就是他那年的規則。

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  DEGREE_BACHELOR,
  LATEST_GRADUATION_RULE_VERSION,
  listGraduationRuleVersions,
  normalizeAdmissionYear,
  resolveGraduationRule,
  resolveGraduationRuleVersion,
} from '../src/data/graduationRuleVersions.js';

describe('G7 版本解析：入學年度落在涵蓋範圍內', () => {
  test('G7 114 學年度入學生選到 114 版，不觸發 fallback', () => {
    const result = resolveGraduationRule({ program: '資訊工程學系', admissionYear: 114 });

    assert.equal(result.ruleVersion, '114');
    assert.equal(result.appliedFallbackVersion, false);
    assert.equal(result.fallbackReason, null);
    assert.equal(result.requirement.total, 128);
    assert.equal(result.admissionYear, 114);
  });

  test('G7 115 學年度入學生同樣落在 114 版（academicYearTo 為 null＝目前最新一版）', () => {
    const result = resolveGraduationRule({ program: '資訊工程學系', admissionYear: 115 });

    assert.equal(result.ruleVersion, '114');
    assert.equal(result.appliedFallbackVersion, false);
  });

  test('G7 規則來源與涵蓋範圍會一併回傳，讓每筆認列都追溯得到', () => {
    const result = resolveGraduationRule({ program: '資訊工程學系', admissionYear: 114 });

    assert.match(result.ruleSource, /^https:\/\/registration\.fcu\.edu\.tw\//);
    assert.deepEqual(result.coverage, { from: 114, to: null });
    assert.equal(result.degree, DEGREE_BACHELOR);
  });
});

describe('G8 版本解析：入學年度沒有對應版本時退回最新一版並說出來', () => {
  // 這是 #23 最容易被含糊帶過的地方。112 入學生的必選修科目表根本還沒取得，
  // 直接套 114 版而不吭聲，使用者會以為那就是他適用的規則。
  test('G8 112 學年度入學生退回 114 版，且 fallbackReason 明講原因', () => {
    const result = resolveGraduationRule({ program: '資訊工程學系', admissionYear: 112 });

    assert.equal(result.ruleVersion, '114');
    assert.equal(result.appliedFallbackVersion, true);
    assert.match(result.fallbackReason, /112 學年度入學適用的版本尚未取得/);
    assert.match(result.fallbackReason, /僅供參考/);
    // 退回版本不代表算不出來——學分數字照給，只是標示可信度。
    assert.equal(result.requirement.total, 128);
  });

  test('G8 入學年度未知（null）時同樣退回並說明，不丟例外', () => {
    const result = resolveGraduationRule({ program: '資訊工程學系', admissionYear: null });

    assert.equal(result.ruleVersion, LATEST_GRADUATION_RULE_VERSION);
    assert.equal(result.appliedFallbackVersion, true);
    assert.match(result.fallbackReason, /入學年度未知/);
    assert.equal(result.admissionYear, null);
  });

  test('G8 完全不給參數也不丟例外（畢業進度不能因為缺欄位就整個掛掉）', () => {
    const result = resolveGraduationRule();

    assert.equal(result.requirement, null);
    assert.equal(result.appliedFallbackVersion, true);
    assert.equal(result.program, null);
  });
});

describe('G9 版本解析的邊界', () => {
  test('G9 查不到的系所回傳 requirement null，但版本資訊照給', () => {
    const result = resolveGraduationRule({ program: '不存在系', admissionYear: 114 });

    assert.equal(result.requirement, null);
    assert.equal(result.ruleVersion, '114');
    assert.equal(result.needsVerification, false);
  });

  test('G9 needsVerification 旗標從對照表往下傳，讓每筆認列都帶得到', () => {
    // 財務金融學系在對照表裡被標記為抽取結果可疑。
    const flagged = resolveGraduationRule({ program: '財務金融學系', admissionYear: 114 });
    const clean = resolveGraduationRule({ program: '資訊工程學系', admissionYear: 114 });

    assert.equal(flagged.needsVerification, true);
    assert.equal(clean.needsVerification, false);
  });

  test('G9 normalizeAdmissionYear：不合法值一律 null，不強行轉換', () => {
    for (const value of [null, undefined, '', 'abc', 0, -5, 12.5, 3000, {}, []]) {
      assert.equal(
        normalizeAdmissionYear(value), null,
        `${JSON.stringify(value)} 應為 null`
      );
    }
    assert.equal(normalizeAdmissionYear(112), 112);
    assert.equal(normalizeAdmissionYear('114'), 114);
  });

  test('G9 沒有資料的學制退回學士班規則並標示，不假裝有碩博資料', () => {
    const { appliedFallbackVersion, fallbackReason } =
      resolveGraduationRuleVersion(114, 'master');

    assert.equal(appliedFallbackVersion, true);
    assert.match(fallbackReason, /master/);
  });

  // 誠實記錄：架構支援多版本，但實際只有一版資料。這個測試是為了讓
  // 「補進 112／113 版」這件事發生時有人會注意到要回來更新文件與 roadmap。
  test('G9 目前只有一個真實規則版本（補進歷史版本時本測試會提醒更新文件）', () => {
    const versions = listGraduationRuleVersions();

    assert.equal(versions.length, 1, '版本數改變時請一併更新 roadmap #23 與變更報告的「不宣稱」段落');
    assert.equal(versions[0].version, '114');
    assert.equal(versions[0].programCount, 49);
  });
});
