import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createEvidenceLedger,
  recordToolEvidence,
  validateFaithfulnessReply,
  enforceFaithfulReply,
} from '../src/services/explanationFaithfulness.js';

function reason(overrides = {}) {
  return {
    selectedBecause: 'PREFERENCE_MATCH',
    matchedPreferences: [{ label: '實作評量' }],
    easinessSource: 'reviews',
    confidence: 'high',
    dataSources: ['Course_Sections', 'Course_Reviews'],
    constraintTradeoffs: [],
    alternativesRejected: { status: 'no-competitors', candidates: [] },
    ...overrides,
  };
}

function course(overrides = {}) {
  return {
    sectionId: 101,
    catalogCourseCode: 'IECS3001',
    name: '演算法',
    teacher: '王小明',
    credits: 3,
    timeStr: '一 03-04',
    eligibility: 'eligible',
    countsTowardGraduation: true,
    reviewEvidence: { reviewCount: 8, avgRecommend: 4.2 },
    recommendationReason: reason(),
    ...overrides,
  };
}

function scheduleLedger(courseOverrides = {}, resultOverrides = {}) {
  const ledger = createEvidenceLedger();
  recordToolEvidence(ledger, {
    toolName: 'run_csp_scheduler',
    callId: 'call-schedule',
    dataSource: 'mysql',
    result: {
      success: true,
      solver: { status: 'solved' },
      schedule: [course(courseOverrides)],
      ...resultOverrides,
    },
  });
  return ledger;
}

describe('#37 evidence ledger', () => {
  test('F1 保存工具狀態與課程證據，重複課程合併成同一筆', () => {
    const ledger = scheduleLedger();
    recordToolEvidence(ledger, {
      toolName: 'query_course_db',
      callId: 'call-query',
      result: [{ id: 101, name: '演算法', credits: 3 }],
    });

    assert.equal(ledger.tools.length, 2);
    assert.equal(ledger.tools[0].status, 'succeeded');
    assert.equal(ledger.courses.length, 1);
    assert.equal(ledger.courses[0].teacher, '王小明');
  });

  test('F2 評價工具只有 count > 0 才建立 Course_Reviews 證據', () => {
    const withReviews = createEvidenceLedger();
    recordToolEvidence(withReviews, {
      toolName: 'search_dcard_reviews',
      result: { courseId: 101, courseName: '演算法', count: 4, summary: '整體偏正面' },
    });
    assert.ok(withReviews.courses[0].dataSources.includes('Course_Reviews'));
    assert.equal(withReviews.courses[0].reviewEvidence.count, 4);

    const withoutReviews = createEvidenceLedger();
    recordToolEvidence(withoutReviews, {
      toolName: 'search_dcard_reviews',
      result: { courseId: 101, courseName: '演算法', count: 0, summary: '目前沒有課程評價' },
    });
    assert.ok(!withoutReviews.courses[0].dataSources.includes('Course_Reviews'));
    assert.equal(withoutReviews.courses[0].reviewEvidence, null);
  });
});

describe('#37 course facts and recommendation claims', () => {
  test('F3 正確的課名、教師、學分、資格、畢業認列與偏好理由通過', () => {
    const audit = validateFaithfulnessReply(
      '「演算法」由王小明老師授課，共 3 學分，可以修，也可計入畢業學分。'
        + '「演算法」符合你的實作評量偏好。',
      scheduleLedger()
    );

    assert.equal(audit.passed, true);
    assert.equal(audit.hallucinationCount, 0);
    assert.ok(audit.claims.some(item => item.type === 'course_credits' && item.supported));
  });

  test('F4 錯誤教師與學分都會被攔截', () => {
    const audit = validateFaithfulnessReply(
      '「演算法」由李大華老師授課，共 2 學分。',
      scheduleLedger()
    );

    assert.deepEqual(
      new Set(audit.violations.map(item => item.code)),
      new Set(['COURSE_CREDITS_MISMATCH', 'COURSE_TEACHER_MISMATCH'])
    );
  });

  test('F4b 錯誤上課時間會被攔截，正確星期與節次可通過', () => {
    const wrong = validateFaithfulnessReply('「演算法」在週二第 3-4 節上課。', scheduleLedger());
    assert.ok(wrong.violations.some(item => item.code === 'COURSE_TIME_MISMATCH'));

    const correct = validateFaithfulnessReply('「演算法」在週一第 3-4 節上課。', scheduleLedger());
    assert.equal(correct.passed, true);
    assert.ok(correct.claims.some(item => item.type === 'course_time' && item.supported));
  });

  test('F4c Markdown 表格中的教師、學分與常見時間格式同樣會核對', () => {
    const wrong = validateFaithfulnessReply(
      '| 課程 | 教師 | 學分 | 時間 |\n| 演算法 | 李大華 | 2 | 二03–04 |',
      scheduleLedger()
    );
    const codes = new Set(wrong.violations.map(item => item.code));
    assert.ok(codes.has('COURSE_TEACHER_MISMATCH'));
    assert.ok(codes.has('COURSE_CREDITS_MISMATCH'));
    assert.ok(codes.has('COURSE_TIME_MISMATCH'));

    const correct = validateFaithfulnessReply(
      '| 演算法 | 王小明 | 3 | (一)03-04 |',
      scheduleLedger()
    );
    assert.equal(correct.passed, true);
  });

  test('F5 工具結果沒有出現的課程會被攔截', () => {
    const audit = validateFaithfulnessReply('另外推薦「量子魔法課程」，共 3 學分。', scheduleLedger());

    assert.ok(audit.violations.some(item => item.code === 'UNSUPPORTED_COURSE'));
  });

  test('F6 matchedPreferences 為空時不得聲稱符合偏好', () => {
    const ledger = scheduleLedger({
      recommendationReason: reason({ matchedPreferences: [] }),
    });
    const audit = validateFaithfulnessReply('「演算法」符合你的實作偏好。', ledger);

    assert.ok(audit.violations.some(item => item.code === 'PREFERENCE_OVERCLAIM'));
  });

  test('F6b 主要推薦原因反向或完全遺漏時會被攔截', () => {
    const ledger = scheduleLedger({
      recommendationReason: reason({ selectedBecause: 'REQUIRED_COURSE', matchedPreferences: [] }),
    });
    const reversed = validateFaithfulnessReply(
      '推薦「演算法」的主要原因是符合你的偏好。',
      ledger,
      { userMessage: '為什麼推薦演算法？' }
    );
    assert.ok(reversed.violations.some(item => item.code === 'RECOMMENDATION_REASON_REVERSED'));

    const omitted = validateFaithfulnessReply(
      '「演算法」是 3 學分。',
      ledger,
      { userMessage: '為什麼推薦演算法？' }
    );
    assert.ok(omitted.violations.some(item => item.code === 'MISSING_RECOMMENDATION_REASON'));

    const genericOmitted = validateFaithfulnessReply(
      '「演算法」由王小明老師授課，共 3 學分。',
      ledger,
      { userMessage: '請排課並說明第一門課的主要推薦原因。' }
    );
    assert.ok(genericOmitted.violations.some(item => item.code === 'MISSING_RECOMMENDATION_REASON'));
  });
});

describe('#37 review, eligibility and graduation boundaries', () => {
  test('F7 沒有評價時不得說涼或好拿分', () => {
    const ledger = scheduleLedger({
      reviewEvidence: null,
      recommendationReason: reason({ easinessSource: 'none', dataSources: ['Course_Sections'] }),
    });
    const audit = validateFaithfulnessReply('「演算法」很涼而且好拿分。', ledger);

    assert.ok(audit.violations.some(item => item.code === 'REVIEW_WITHOUT_EVIDENCE'));
  });

  test('F8 proxy 不得被說成學生評價', () => {
    const ledger = scheduleLedger({
      reviewEvidence: { reviewCount: 3 },
      recommendationReason: reason({ easinessSource: 'proxy', dataSources: ['Course_Sections'] }),
    });
    const audit = validateFaithfulnessReply('學生評價認為「演算法」很涼。', ledger);

    assert.ok(audit.violations.some(item => item.code === 'PROXY_PRESENTED_AS_REVIEW'));
  });

  test('F9 使用者詢問評價但查無資料時必須明確說不知道', () => {
    const ledger = createEvidenceLedger();
    recordToolEvidence(ledger, {
      toolName: 'search_dcard_reviews',
      result: { courseId: 101, courseName: '演算法', count: 0, summary: '目前沒有課程評價' },
    });

    const missing = validateFaithfulnessReply('我無法提供更多資訊。', ledger, { userMessage: '演算法評價如何？' });
    assert.ok(missing.violations.some(item => item.code === 'MISSING_REVIEW_UNCERTAINTY'));

    const honest = validateFaithfulnessReply('「演算法」目前沒有評價資料，無法判斷是否涼。', ledger, {
      userMessage: '演算法評價如何？',
    });
    assert.equal(honest.passed, true);
  });

  test('F10 資格未知與畢業認列未知時不得給肯定結論', () => {
    const ledger = scheduleLedger({ eligibility: 'unknown', countsTowardGraduation: null });
    const audit = validateFaithfulnessReply(
      '「演算法」一定可以修，也可以計入畢業學分。',
      ledger
    );

    const codes = new Set(audit.violations.map(item => item.code));
    assert.ok(codes.has('ELIGIBILITY_OVERCLAIM'));
    assert.ok(codes.has('GRADUATION_OVERCLAIM'));
  });

  test('F10b 沒有畢業規則工具證據時不得自行提出畢業門檻', () => {
    const audit = validateFaithfulnessReply('本系畢業門檻是 128 學分。', createEvidenceLedger());

    assert.ok(audit.violations.some(item => item.code === 'GRADUATION_RULE_WITHOUT_EVIDENCE'));
  });
});

describe('#37 tool failure and adversarial replies', () => {
  test('F11 工具失敗或等待確認時不得宣稱操作成功', () => {
    const failed = createEvidenceLedger();
    recordToolEvidence(failed, {
      toolName: 'run_csp_scheduler', callId: 'failed', result: { error: '資料庫連線失敗' },
    });
    const failedAudit = validateFaithfulnessReply('已成功排好課表。', failed);
    assert.ok(failedAudit.violations.some(item => item.code === 'TOOL_FAILURE_PRESENTED_AS_SUCCESS'));

    const hiddenFailure = validateFaithfulnessReply('請換個條件再試一次。', failed);
    assert.ok(hiddenFailure.violations.some(item => item.code === 'TOOL_FAILURE_NOT_DISCLOSED'));

    const pending = createEvidenceLedger();
    recordToolEvidence(pending, {
      toolName: 'update_preferences', callId: 'pending', result: { pendingConfirmation: true },
    });
    const pendingAudit = validateFaithfulnessReply('已更新你的偏好。', pending);
    assert.ok(pendingAudit.violations.some(item => item.code === 'TOOL_FAILURE_PRESENTED_AS_SUCCESS'));

    const timeout = createEvidenceLedger();
    recordToolEvidence(timeout, {
      toolName: 'run_csp_scheduler', result: { error: 'timeout', errorCode: 'TOOL_EXECUTION_FAILED' },
    });
    assert.ok(validateFaithfulnessReply('課表尚未完成，工具逾時。', timeout).passed);

    const malformed = createEvidenceLedger();
    recordToolEvidence(malformed, { toolName: 'run_csp_scheduler', result: null });
    assert.equal(malformed.tools[0].errorCode, 'MALFORMED_TOOL_RESULT');
    assert.ok(validateFaithfulnessReply('課表尚未完成，工具回傳格式錯誤。', malformed).passed);
  });

  test('F12 prompt injection 不能誘使回答洩漏秘密值', () => {
    const audit = validateFaithfulnessReply('OPENAI_API_KEY=__TEST_ONLY_VALUE__', createEvidenceLedger());

    assert.ok(audit.violations.some(item => item.code === 'SENSITIVE_SYSTEM_DISCLOSURE'));
  });
});

describe('#37 repair and safe fallback', () => {
  test('F13 第一次不合格時只修正一次，合格後採用修正版', async () => {
    let calls = 0;
    const result = await enforceFaithfulReply({
      reply: '「演算法」共 2 學分。',
      ledger: scheduleLedger(),
      repair: async () => {
        calls += 1;
        return '「演算法」共 3 學分。';
      },
    });

    assert.equal(calls, 1);
    assert.equal(result.repaired, true);
    assert.equal(result.fallback, false);
    assert.equal(result.audit.passed, true);
  });

  test('F14 修正仍不合格或修正服務失敗時使用後端安全回答', async () => {
    const stillWrong = await enforceFaithfulReply({
      reply: '「演算法」共 2 學分。',
      ledger: scheduleLedger(),
      repair: async () => '「演算法」共 1 學分。',
    });
    assert.equal(stillWrong.fallback, true);
    assert.match(stillWrong.reply, /演算法.*3 學分/u);
    assert.equal(stillWrong.audit.passed, true);

    const repairFailed = await enforceFaithfulReply({
      reply: '「演算法」共 2 學分。',
      ledger: scheduleLedger(),
      repair: async () => { throw new Error('timeout'); },
    });
    assert.equal(repairFailed.fallback, true);
    assert.equal(repairFailed.audit.passed, true);

    const missingReason = await enforceFaithfulReply({
      reply: '「演算法」共 3 學分。',
      ledger: scheduleLedger({
        recommendationReason: reason({ selectedBecause: 'REQUIRED_COURSE', matchedPreferences: [] }),
      }),
      userMessage: '請排課並說明第一門課的主要推薦原因。',
      repair: async () => '「演算法」共 3 學分。',
    });
    assert.equal(missingReason.fallback, true);
    assert.equal(missingReason.audit.passed, true);
    assert.match(missingReason.reply, /主要推薦原因：必修優先/u);
  });

  test('F15 引號內的已命中偏好名稱不會被誤判為不存在課程', () => {
    const ledger = scheduleLedger({
      recommendationReason: {
        matchedPreferences: [{ id: 'assessment', label: '實作評量' }],
        selectedBecause: 'PREFERENCE_MATCH',
        dataSources: ['User_Preferences'],
        alternativesRejected: {
          status: 'had-competitors',
          candidates: [{ name: '資料結構' }],
        },
      },
    });

    const audit = validateFaithfulnessReply(
      '推薦「演算法」，因為這門課符合你的「實作評量」偏好；替代課「資料結構」未排入。',
      ledger
    );

    assert.equal(audit.passed, true);
  });
});
