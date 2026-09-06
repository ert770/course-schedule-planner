import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { parseCourseHistoryMarkdown } from '../src/data/courseHistoryMarkdown.js';
import {
  DEMO_EVENT_COUNT_PER_PERSONA,
  DEMO_PERSONAS,
  buildDemoPersonaEvents,
  demoPersonaCanonicalId,
  learnDemoPersonaWeights,
} from '../src/data/demoPersonas.js';
import { SUFFICIENCY_STATUS } from '../src/skills/preferenceLearning.js';

const COURSE_REFS = Array.from({ length: 50 }, (_, index) => ({
  catalogCourseCode: `TEST${String(index + 1).padStart(4, '0')}`,
  sectionId: index + 1,
}));

describe('DP1 Markdown 歷史修課解析', () => {
  test('DP1 支援一般與通識欄位順序、排除無課號列並合併完全重複列', () => {
    const markdown = `
## 基礎／共同課程
| 課程編碼 | 科目 | 實際修習學年 | 實際修習學期 | 實際修習學分 | 計入畢業學分 | 取得學分記錄 |
|---|---|---:|---:|---:|---:|---:|
| CHIN1065 | 中文思辨與表達(一) | 112 | 1 | 2 | 2 | 88 |
| CHIN1065 | 中文思辨與表達(一) | 112 | 1 | 2 | 2 | 88 |
| — | 大學基礎英文(一) | — | — | 2 | — | X |

## 通識課程
| 通識類別 | 課程編碼 | 科目 | 實際修習學年 | 實際修習學期 | 實際修習學分 | 計入畢業學分 | 取得學分記錄 |
|---|---|---|---:|---:|---:|---:|---:|
| H | GEH1001 | 人文課程 | 113 | 2 | 2 | 2 | 91 |
`;

    const result = parseCourseHistoryMarkdown(markdown, { sourceName: 'fixture.md' });

    assert.equal(result.entries.length, 2);
    assert.equal(result.duplicateRows, 1);
    assert.equal(result.skippedWithoutCourseCode, 1);
    assert.deepEqual(result.entries.find(item => item.courseCode === 'GEH1001'), {
      academicYear: 113,
      semester: 2,
      courseCode: 'GEH1001',
      courseName: '人文課程',
      score: 91,
      letterGrade: null,
      credits: 2,
      passed: true,
      requirementType: '通識',
      generalEducationCategory: 'H',
      graduationCategory: 'general',
    });
  });

  test('DP1 同一修課唯一鍵內容衝突時拒絕猜測', () => {
    const markdown = `
## 資工核心／系內課程
| 課程編碼 | 科目 | 實際修習學年 | 實際修習學期 | 實際修習學分 | 計入畢業學分 | 取得學分記錄 |
|---|---|---:|---:|---:|---:|---:|
| IECS1001 | 程式設計 | 112 | 1 | 3 | 3 | 80 |
| IECS1001 | 程式設計 | 112 | 1 | 3 | 3 | 90 |
`;
    assert.throws(
      () => parseCourseHistoryMarkdown(markdown, { sourceName: 'conflict.md' }),
      /互相衝突/
    );
  });
});

describe('DP2 三組可重播 demo persona', () => {
  test('DP2 每人產生 50 筆有效、固定 ID 的學習訊號', () => {
    for (const persona of DEMO_PERSONAS) {
      const first = buildDemoPersonaEvents(persona, COURSE_REFS);
      const replay = buildDemoPersonaEvents(persona, COURSE_REFS);
      assert.equal(first.length, DEMO_EVENT_COUNT_PER_PERSONA);
      assert.deepEqual(replay, first);
      assert.equal(new Set(first.map(event => event.eventId)).size, first.length);
      assert.equal(demoPersonaCanonicalId(persona), String(persona.studentId ?? persona.userId));
    }
  });

  test('DP2 三人都達 sufficient，且證據集中在各自指定軸', () => {
    for (const persona of DEMO_PERSONAS) {
      const events = buildDemoPersonaEvents(persona, COURSE_REFS);
      const learned = learnDemoPersonaWeights(persona, events);
      assert.equal(learned.sufficiency.status, SUFFICIENCY_STATUS.SUFFICIENT);
      assert.equal(learned.sufficiency.usableEventCount, DEMO_EVENT_COUNT_PER_PERSONA);
      assert.equal(learned.evidence[persona.signal.axis].length, DEMO_EVENT_COUNT_PER_PERSONA);
    }
  });
});
