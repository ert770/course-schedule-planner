// Roadmap #26：證據導向推薦理由的純函式測試。
//
// 這裡釘住的核心是**誠實邊界**：沒有證據的地方必須說「沒有」，
// 而且「沒有競爭者」與「還沒算」要分得出來。這兩件事錯了，
// 使用者會以為系統有依據／有算過，那比不顯示更糟。

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  CONFIDENCE,
  COMPETITION_STATUS,
  DATA_SOURCES,
  RECOMMENDATION_REASON_VERSION,
  SELECTION_REASONS,
  buildAlternatives,
  buildRecommendationReason,
} from '../src/skills/recommendationReason.js';

function course(overrides = {}) {
  return {
    id: 1,
    name: '課程一',
    category: '一般選修',
    sourceCategory: '選修',
    classificationSource: 'curriculum_table',
    eligibility: 'eligible',
    easinessSource: 'reviews',
    reviewEvidence: { reviewCount: 5, easyScore: 72 },
    countsTowardGraduation: true,
    ...overrides,
  };
}

describe('R1 主要原因代號', () => {
  test('R1 本人必修優先於其他判定', () => {
    const reason = buildRecommendationReason({
      course: course(), formallyRequired: true, requiredSelection: true,
    });

    assert.equal(reason.selectedBecause, SELECTION_REASONS.REQUIRED_COURSE);
  });

  test('R1 使用者指名的課', () => {
    const reason = buildRecommendationReason({ course: course(), requiredSelection: true });

    assert.equal(reason.selectedBecause, SELECTION_REASONS.USER_SPECIFIED);
  });

  test('R1 關注課程與重補修由 placementReason 判定', () => {
    assert.equal(
      buildRecommendationReason({ course: course(), placementReason: '關注課程' }).selectedBecause,
      SELECTION_REASONS.WATCHING
    );
    assert.equal(
      buildRecommendationReason({
        course: course(), placementReason: '不及格必修重補修優先',
      }).selectedBecause,
      SELECTION_REASONS.RETAKE_REQUIRED
    );
  });

  test('R1 每份理由都帶版本，讓互動事件可回溯用哪一版算的', () => {
    assert.equal(
      buildRecommendationReason({ course: course() }).reasonVersion,
      RECOMMENDATION_REASON_VERSION
    );
  });
});

describe('R2 信心度由證據完整度決定，不憑感覺', () => {
  test('R2 有評價、資格明確 → high', () => {
    assert.equal(buildRecommendationReason({ course: course() }).confidence, CONFIDENCE.HIGH);
  });

  test('R2 涼度只是推估（proxy）→ medium，不得算成證據充分', () => {
    const reason = buildRecommendationReason({
      course: course({ easinessSource: 'proxy', reviewEvidence: null }),
    });

    assert.equal(reason.confidence, CONFIDENCE.MEDIUM);
  });

  test('R2 沒有評價 → medium', () => {
    const reason = buildRecommendationReason({
      course: course({ easinessSource: 'reviews', reviewEvidence: null }),
    });

    assert.equal(reason.confidence, CONFIDENCE.MEDIUM);
  });

  test('R2 資格待確認 → low（連能不能修都還沒確定，最嚴重）', () => {
    const reason = buildRecommendationReason({ course: course({ eligibility: 'unknown' }) });

    assert.equal(reason.confidence, CONFIDENCE.LOW);
  });

  test('R2 系所範圍無法解析 → low（必修判定整個懸空）', () => {
    const reason = buildRecommendationReason({ course: course({ scopeResolved: false }) });

    assert.equal(reason.confidence, CONFIDENCE.LOW);
  });
});

describe('R3 資料來源只列真的查過的', () => {
  test('R3 沒有評價的課不得列 Course_Reviews', () => {
    const reason = buildRecommendationReason({
      course: course({ reviewEvidence: null, easinessSource: 'proxy' }),
    });

    assert.ok(!reason.dataSources.includes(DATA_SOURCES.COURSE_REVIEWS),
      'proxy 涼度不算查過評價——否則「可追溯」就變成裝飾');
    assert.ok(reason.dataSources.includes(DATA_SOURCES.COURSE_SECTIONS));
  });

  test('R3 有評價才列評價來源', () => {
    const reason = buildRecommendationReason({ course: course() });

    assert.ok(reason.dataSources.includes(DATA_SOURCES.COURSE_REVIEWS));
  });

  test('R3 類別由 MySQL 原始值決定時不列必選修科目表', () => {
    const reason = buildRecommendationReason({
      course: course({ classificationSource: 'mysql' }),
    });

    assert.ok(!reason.dataSources.includes(DATA_SOURCES.CURRICULUM_TABLE));
  });
});

describe('R4 「沒有競爭者」與「還沒算」必須分得出來', () => {
  // 實測 demo 帳號現況就是 0 個落選者。兩者都用空陣列表示的話，
  // 畫面與 Agent 都無從分辨，使用者會以為系統沒算。
  test('R4 沒有落選者時回報 no-competitors，不是空陣列', () => {
    const alternatives = buildAlternatives(1000, []);

    assert.equal(alternatives.status, COMPETITION_STATUS.NO_COMPETITORS);
    assert.deepEqual(alternatives.candidates, []);
  });

  test('R4 有落選者時附上分數差', () => {
    const alternatives = buildAlternatives(1000, [
      { course: { id: 2, name: '課程二', catalogCourseCode: 'X2' }, score: 940 },
    ]);

    assert.equal(alternatives.status, COMPETITION_STATUS.HAD_COMPETITORS);
    assert.equal(alternatives.candidates[0].scoreDelta, 60);
    assert.equal(alternatives.candidates[0].name, '課程二');
  });

  test('R4 完全沒有傳 alternatives 時是 not-applicable，與「沒有競爭者」不同', () => {
    const reason = buildRecommendationReason({ course: course() });

    assert.equal(reason.alternativesRejected.status, COMPETITION_STATUS.NOT_APPLICABLE);
  });
});

describe('R5 分數組成與命中偏好', () => {
  test('R5 只列非 0 的分數元件，避免一堆 0 稀釋真正起作用的項目', () => {
    const scoringPolicy = {
      version: 'personalized-scoring-v1',
      weights: { interest: 1, compact: 0, easy: -1.4 },
    };
    const reason = buildRecommendationReason({
      course: course(),
      scoreComponents: { base: 1000, category: -240, easy: 0, interest: 0 },
      scoringPolicy,
    });

    assert.deepEqual(
      reason.scoreBreakdown,
      [{ component: 'base', value: 1000 }, { component: 'category', value: -240 }]
    );
    assert.equal(reason.scoreTotal, 760, 'scoreTotal 要含被過濾掉的 0，總分才正確');
    assert.deepEqual(reason.scoringPolicy, scoringPolicy, '理由必須保存實際排序使用的權重版本');
  });

  test('R5 內容偏好與興趣命中都會列出來源類型', () => {
    const reason = buildRecommendationReason({
      course: course(),
      contentHits: [{ preferenceId: 'practicalExam', label: '實作評量', score: 40 }],
      interestHits: ['資訊安全'],
    });

    assert.deepEqual(reason.matchedPreferences.map(item => item.type), ['content', 'interest']);
    assert.equal(reason.matchedPreferences[1].label, '資訊安全');
  });

  test('R5 沒有命中任何偏好時是空陣列，不硬掰理由', () => {
    const reason = buildRecommendationReason({ course: course() });

    assert.deepEqual(reason.matchedPreferences, []);
  });
});

describe('R6 評價證據與涼度來源原樣帶出，不重新判定', () => {
  test('R6 沒有評價時 reviewEvidence 為 null，不是 0 分', () => {
    const reason = buildRecommendationReason({ course: course({ reviewEvidence: null }) });

    assert.equal(reason.reviewEvidence, null);
  });

  test('R6 easinessSource 原樣帶出，供呈現層決定措辭', () => {
    assert.equal(
      buildRecommendationReason({ course: course({ easinessSource: 'proxy' }) }).easinessSource,
      'proxy'
    );
  });

  test('R6 必修豁免時段偏好會記成付出的代價', () => {
    const reason = buildRecommendationReason({
      course: course(),
      tradeoffs: [{ type: 'time-preference-exempted', label: '不排早八', because: 'REQUIRED_COURSE_PRIORITY' }],
    });

    assert.equal(reason.constraintTradeoffs[0].label, '不排早八');
  });
});
