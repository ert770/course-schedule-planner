import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createEvidenceLedger,
  recordContextCourseEvidence,
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

// 兩個同名不同班次的課程放進同一份帳本——roadmap #41 第二段要測的就是
// 「驗證粒度只到課名，但證據來源已是 section 級」這件事。兩門課特意教師、
// 時間、學分全部不同，才能檢驗「教師來自 A、時間與學分來自 B」這種拼湊
// 出一門現實不存在班次的句子會不會被擋下。
function twoSectionLedger(overridesA = {}, overridesB = {}) {
  const ledger = createEvidenceLedger();
  recordToolEvidence(ledger, {
    toolName: 'run_csp_scheduler',
    callId: 'call-schedule',
    dataSource: 'mysql',
    result: {
      success: true,
      solver: { status: 'solved' },
      schedule: [
        course({
          sectionId: 201, catalogCourseCode: null, teacher: '王小明', credits: 3, timeStr: '一 03-04', ...overridesA,
        }),
        course({
          sectionId: 202, catalogCourseCode: null, teacher: '李大華', credits: 2, timeStr: '二 05-06', ...overridesB,
        }),
      ],
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

describe('#37b 工具重試的終態語意', () => {
  test('F16 同一操作重試成功後，終態為成功，不得再因為中途失敗要求揭露', () => {
    const ledger = createEvidenceLedger();
    recordToolEvidence(ledger, {
      toolName: 'record_schedule_feedback',
      callId: 'attempt-1',
      operationKey: 'record_schedule_feedback:op-1',
      result: { error: '找不到對應的推薦曝光紀錄，無法記錄回饋。' },
    });
    recordToolEvidence(ledger, {
      toolName: 'record_schedule_feedback',
      callId: 'attempt-2',
      operationKey: 'record_schedule_feedback:op-1',
      result: { success: true },
    });

    assert.equal(ledger.tools.length, 2);
    assert.equal(ledger.operations.length, 1);
    assert.equal(ledger.operations[0].terminalStatus, 'succeeded');
    assert.equal(ledger.operations[0].terminalIncomplete, false);

    const disclosedRetry = validateFaithfulnessReply('第一次失敗，重試後已成功記錄回饋。', ledger);
    assert.equal(disclosedRetry.passed, true, JSON.stringify(disclosedRetry.violations));

    const plainSuccess = validateFaithfulnessReply('已成功記錄回饋。', ledger);
    assert.equal(plainSuccess.passed, true, JSON.stringify(plainSuccess.violations));
  });

  test('F17 同工具不同操作各自獨立終態，其中一個失敗不能被另一個的成功蓋過', () => {
    const ledger = createEvidenceLedger();
    recordToolEvidence(ledger, {
      toolName: 'record_schedule_feedback',
      callId: 'course-a',
      operationKey: 'record_schedule_feedback:course-a',
      result: { error: '班次不在該次推薦實際顯示的課表中，不能記為退選。' },
    });
    recordToolEvidence(ledger, {
      toolName: 'record_schedule_feedback',
      callId: 'course-b',
      operationKey: 'record_schedule_feedback:course-b',
      result: { success: true },
    });

    assert.equal(ledger.operations.length, 2);

    const claimedAllDone = validateFaithfulnessReply('已成功記錄你的退選回饋。', ledger);
    assert.ok(claimedAllDone.violations.some(item => item.code === 'TOOL_FAILURE_PRESENTED_AS_SUCCESS'));

    const hiddenFailure = validateFaithfulnessReply('已經處理好了。', ledger);
    assert.ok(hiddenFailure.violations.some(item => item.code === 'TOOL_FAILURE_NOT_DISCLOSED'));

    const disclosedMixed = validateFaithfulnessReply(
      '其中一門課記錄失敗，另一門已經處理完成，退選也生效了。',
      ledger
    );
    assert.ok(!disclosedMixed.violations.some(item => item.code === 'TOOL_FAILURE_NOT_DISCLOSED'));
  });

  test('F18 排課終態成功但 solver 未 solved 仍視為未完成', () => {
    const ledger = createEvidenceLedger();
    recordToolEvidence(ledger, {
      toolName: 'run_csp_scheduler',
      callId: 'call-1',
      operationKey: 'run_csp_scheduler:op-1',
      result: { success: true, solver: { status: 'infeasible' } },
    });

    assert.equal(ledger.operations[0].terminalIncomplete, true);
    assert.equal(ledger.operations[0].terminalSolverStatus, 'infeasible');

    const claimedDone = validateFaithfulnessReply('已成功排好課表。', ledger);
    assert.ok(claimedDone.violations.some(item => item.code === 'TOOL_FAILURE_PRESENTED_AS_SUCCESS'));

    const honest = validateFaithfulnessReply('目前條件無法排出可行課表，尚未完成。', ledger);
    assert.equal(honest.passed, true, JSON.stringify(honest.violations));
  });
});

describe('#41 課程指涉解析到 section 實體', () => {
  test('F19 同名不同班次時，正確描述其中一個班次不被另一個牽連', () => {
    const ledger = twoSectionLedger();

    const describesA = validateFaithfulnessReply(
      '演算法由王小明老師授課，在星期一第 3-4 節上課，共 3 學分。',
      ledger
    );
    assert.equal(describesA.passed, true, JSON.stringify(describesA.violations));

    const describesB = validateFaithfulnessReply(
      '演算法由李大華老師授課，在星期二第 5-6 節上課，共 2 學分。',
      ledger
    );
    assert.equal(describesB.passed, true, JSON.stringify(describesB.violations));
  });

  test('F19b 教師與時間都無法唯一收斂候選時，仍以完整事實一致性正確歸屬', () => {
    // 兩班同一教師、同一時間，只有學分不同——narrowing 的教師／時間訊號都
    // 收斂不了，必須靠逐 candidate 的完整事實一致性才能正確判斷。
    const ledger = twoSectionLedger(
      { teacher: '王小明', timeStr: '一 03-04', credits: 3 },
      { teacher: '王小明', timeStr: '一 03-04', credits: 2 }
    );

    const matchesFirst = validateFaithfulnessReply('演算法共 3 學分。', ledger);
    assert.equal(matchesFirst.passed, true, JSON.stringify(matchesFirst.violations));

    const matchesNeither = validateFaithfulnessReply('演算法共 99 學分。', ledger);
    assert.ok(matchesNeither.violations.some(item => item.code === 'COURSE_CREDITS_MISMATCH'));
  });

  test('F20 混用不同班次的教師與時間學分，不能拼湊出一門不存在的班次', () => {
    const ledger = twoSectionLedger();

    // 教師是 A 班的（王小明），時間與學分卻是 B 班的（週二 5-6 節、2 學分）——
    // 逐事實 disjunction 會讓這句話「零違規」通過；逐 candidate 一致性必須擋下。
    const frankenstein = validateFaithfulnessReply(
      '演算法由王小明老師授課，在星期二第 5-6 節上課，共 2 學分。',
      ledger
    );
    assert.equal(frankenstein.passed, false);
    const codes = new Set(frankenstein.violations.map(item => item.code));
    assert.ok(codes.has('COURSE_TIME_MISMATCH'));
    assert.ok(codes.has('COURSE_CREDITS_MISMATCH'));
  });

  test('F21 不加引號的散文捏造課程一樣被攔截', () => {
    const ledger = scheduleLedger();

    const unquoted = validateFaithfulnessReply(
      '另外推薦量子魔法課程，由李大華老師授課，共 3 學分。',
      ledger
    );
    assert.ok(unquoted.violations.some(item => item.code === 'UNSUPPORTED_COURSE'));

    const unquotedNoDetail = validateFaithfulnessReply('另外推薦量子魔法課程，共 3 學分。', ledger);
    assert.ok(unquotedNoDetail.violations.some(item => item.code === 'UNSUPPORTED_COURSE'));

    const unquotedReview = validateFaithfulnessReply('量子魔法課程很涼，很好拿分。', ledger);
    assert.ok(unquotedReview.violations.some(item => item.code === 'UNSUPPORTED_COURSE'));
  });

  test('F21b 正常回覆用語不得被誤判為捏造課程', () => {
    const ledger = scheduleLedger();
    const shouldPass = [
      '以下是推薦的課程：',
      '我已依你的偏好排入 3 門必修課程，總共 10 學分。',
      '目前沒有推薦任何課程，因為條件太嚴格。',
      '建議你優先加選必修課程，再考慮選修課程。',
      '這門課的評價偏正面，學生普遍覺得很涼。',
      '這門課排在星期一第 3-4 節，跟你的通識課不衝突。',
      '另外兩門課程也都是必修，已一併排入。',
    ];
    for (const sentence of shouldPass) {
      const audit = validateFaithfulnessReply(sentence, ledger);
      assert.ok(
        !audit.violations.some(item => item.code === 'UNSUPPORTED_COURSE'),
        `不應誤判為捏造課程：${sentence}\n${JSON.stringify(audit.violations)}`
      );
    }
  });

  test('F22 後端自己的安全回答必須永遠通過自己的稽核', async () => {
    const reasonValues = [
      'REQUIRED_COURSE', 'RETAKE_REQUIRED', 'USER_SPECIFIED',
      'COREQUISITE_PAIR', 'WATCHING', 'CREDIT_FILL', 'PREFERENCE_MATCH', undefined,
    ];
    for (const selectedBecause of reasonValues) {
      const ledger = scheduleLedger({
        recommendationReason: reason({ selectedBecause, matchedPreferences: [] }),
      });
      const result = await enforceFaithfulReply({
        reply: '「量子魔法課程」共 3 學分，由不存在的老師授課。',
        ledger,
        userMessage: '為什麼推薦第一門課？',
      });
      assert.equal(result.fallback, true);
      assert.equal(
        result.audit.passed,
        true,
        `selectedBecause=${selectedBecause} 的安全回答未通過自己的稽核：${JSON.stringify(result.audit.violations)}\n${result.reply}`
      );
    }
  });

  test('F22b 缺評價的免責句本身不得觸發評價或捏造違規', () => {
    const ledger = scheduleLedger({ reviewEvidence: null });
    const audit = validateFaithfulnessReply(
      '目前可確認的課程資料如下：\n演算法，王小明老師，3 學分，一 03-04\n其中部分課程沒有評價資料，無法判斷是否涼或好拿分。',
      ledger
    );
    assert.equal(audit.passed, true, JSON.stringify(audit.violations));
  });

  test('F23 evidenceRoles 經過合併不會被覆蓋', () => {
    const ledger = createEvidenceLedger();
    recordToolEvidence(ledger, {
      toolName: 'run_csp_scheduler',
      callId: 'call-schedule',
      result: { success: true, solver: { status: 'solved' }, schedule: [course({ sectionId: 101 })] },
    });
    recordToolEvidence(ledger, {
      toolName: 'query_course_db',
      callId: 'call-query',
      result: [course({ sectionId: 101 })],
    });

    const merged = ledger.courses.find(item => item.sectionId === '101');
    assert.ok(merged.evidenceRoles.includes('recommended'));
    assert.ok(merged.evidenceRoles.includes('candidate'));
  });

  test('F24 被排除或未排入的課不得講成推薦', () => {
    const ledger = createEvidenceLedger();
    recordToolEvidence(ledger, {
      toolName: 'run_csp_scheduler',
      callId: 'call-schedule',
      result: {
        success: true,
        solver: { status: 'solved' },
        schedule: [],
        excludedCoursesSample: [
          { ...course({ sectionId: 301, name: '進階演算法' }), reason: '資格未確認' },
        ],
      },
    });

    const presentedAsRecommended = validateFaithfulnessReply('推薦你加選「進階演算法」。', ledger);
    assert.ok(presentedAsRecommended.violations.some(item => item.code === 'EXCLUDED_COURSE_PRESENTED_AS_RECOMMENDED'));

    const honestlyExcluded = validateFaithfulnessReply('「進階演算法」目前資格未確認，已被排除。', ledger);
    assert.ok(!honestlyExcluded.violations.some(item => item.code === 'EXCLUDED_COURSE_PRESENTED_AS_RECOMMENDED'));
  });

  test('F24b 正常推薦的課不受 evidenceRole 檢查影響', () => {
    const ledger = scheduleLedger();
    const audit = validateFaithfulnessReply('推薦你加選「演算法」。', ledger);
    assert.ok(!audit.violations.some(item => item.code === 'EXCLUDED_COURSE_PRESENTED_AS_RECOMMENDED'));
  });
});


// 忠實度閘門的本意是「沒有依據就不要講」，不是「沒呼叫工具就不要講」。
// 規劃狀態的課程是伺服器自己從 `Courses` 解析出來的，可信度不低於一次工具結果——
// 少了這一段，Agent 被要求「追問使用者為什麼移除某門課」時，一提到課名就被判成
// 幻覺，只能回一句沒有資料的安全答案（實測就是這樣，這個測試把它釘住）。
describe('F25 伺服器補進 prompt 的課程事實也算證據', () => {
  const contextCourses = [
    { sectionId: 1300, name: '程式語言', instructor: '吳育倫' },
    { sectionId: 1299, name: '軟體框架設計', instructor: '薛念林' },
  ];

  test('F25 追問移除原因時可以指名那門課，不算幻覺', () => {
    const ledger = recordContextCourseEvidence(createEvidenceLedger(), contextCourses);
    const audit = validateFaithfulnessReply(
      '你移除「軟體框架設計」的主要原因是什麼？例如內容不感興趣、作業負擔或時段。',
      ledger,
      { userMessage: '幫我重排' }
    );

    assert.equal(audit.passed, true);
    assert.equal(audit.hallucinationCount, 0);
  });

  test('F25b 沒有登記的課仍然算幻覺', () => {
    const ledger = recordContextCourseEvidence(createEvidenceLedger(), contextCourses);
    const audit = validateFaithfulnessReply('推薦你加選「量子計算導論」。', ledger);

    assert.equal(audit.passed, false);
  });

  // 這不是一次工具呼叫，不該出現在「這回合做了哪些操作」的歷史裡，
  // 也不該影響 `buildSafeFaithfulnessFallback()` 對「最近一次未完成操作」的判斷。
  test('F25c 只寫 courses，不碰 tools 與 operations', () => {
    const ledger = recordContextCourseEvidence(createEvidenceLedger(), contextCourses);

    assert.equal(ledger.tools.length, 0);
    assert.equal(ledger.operations.length, 0);
    assert.equal(ledger.courses.length, 2);
  });

  test('F25d 與工具證據合併，不互相覆蓋', () => {
    const ledger = recordContextCourseEvidence(createEvidenceLedger(), contextCourses);
    recordToolEvidence(ledger, {
      toolName: 'query_course_db',
      result: [{ sectionId: 999, name: '演算法', instructor: '某教師' }],
    });

    // `sectionId` 在帳本裡是字串（`normalizeCourse()` 的既有行為）。
    const ids = ledger.courses.map(item => Number(item.sectionId)).sort((a, b) => a - b);
    assert.deepEqual(ids, [999, 1299, 1300]);
  });
});

// 2026-10-15 Persona 實測：多數備援回答其實是忠實度檢查誤判，不是模型捏造。
describe('F30 忠實度檢查的誤判修正（Persona 實測）', () => {
  function queryLedger(courses) {
    const ledger = createEvidenceLedger();
    recordToolEvidence(ledger, {
      toolName: 'query_course_db', callId: 'call-query', dataSource: 'mysql', result: courses,
    });
    return ledger;
  }
  const ledger = () => queryLedger([
    course({ sectionId: 301, name: '社會企業實作專題', teacher: '陳淑慧', credits: 2, timeStr: '三 06-07' }),
    course({ sectionId: 302, name: '人生哲學', teacher: '林大同', credits: 2, timeStr: '四 03-04', eligibility: 'ineligible' }),
  ]);

  test('F30a 轉述使用者條件的引號內容不是課名', () => {
    const userMessage = '我想挑戰難一點的課，有沒有英文授課的資安或演算法選修？';
    const cases = [
      '目前沒有找到同時符合「英文授課＋資安或演算法」的可選課程。',
      '最符合「課堂討論多」的通識課，我會優先推薦下面幾門。',
      '如果你想要更貼近你提到的「社會議題、哲學」方向，可以再告訴我。',
      '我這次是依「挑戰難度、英文授課、資安／演算法興趣」搜尋。',
      '你說的「英文授課」課程目前資料很少。',
      '目前偏好中的「挑戰難課」與「全英授課」我有記下，但不代表一定有符合的課程。',
      '- 不限課程類別，包含系外選修',
      '以上課程目前都沒有評價資料。',
      '這些班次對你的資格不符，因此不列為可直接推薦的選項。',
      '- 改查相關關鍵字，例如「網路安全」「密碼學」「機器學習」或「計算理論」',
      '- 擴大到「系外選修」',
      '- 將關鍵字改為「安全程式設計」「系統安全」或「資訊安全管理」',
      '目前不能僅依課名確認，仍需以課程描述中的評量方式為準。',
      '資料庫目前只有 114 學年度必選修規則，因此畢業認列僅供參考。',
      '其他選修避開',
      '目前結果顯示午休偏好沒有被一般選修違反；',
      '目前沒有足夠資料判定哪些課程特別難，不能直接替你保證課程難度。',
      '若要增加找到課程的機會，可以放寬條件。',
    ];
    for (const sentence of cases) {
      const audit = validateFaithfulnessReply(sentence, ledger(), { userMessage });
      assert.ok(!audit.violations.some(item => item.code === 'UNSUPPORTED_COURSE'), `${sentence}\n${JSON.stringify(audit.violations)}`);
    }
  });

  test('F30b 引號裡的捏造課名仍然會被攔下', () => {
    for (const sentence of ['另外推薦「量子魔法課程」。', '我推薦「量子魔法」這門課。', '另外推薦量子魔法課程。']) {
      const audit = validateFaithfulnessReply(sentence, ledger(), { userMessage: '有推薦的通識嗎？' });
      assert.ok(audit.violations.some(item => item.code === 'UNSUPPORTED_COURSE'), sentence);
    }
  });

  test('F30c Markdown 粗體與「X等課程」不影響課名比對', () => {
    const audit = validateFaithfulnessReply(
      '4. **社會企業實作專題**｜陳淑慧。另外搜尋到的 **人生哲學**等課程也很適合討論。', ledger()
    );
    assert.ok(!audit.violations.some(item => item.code === 'UNSUPPORTED_COURSE'), JSON.stringify(audit.violations));
  });

  test('F30d 說明「資格不符、所以不推薦」不是誇大資格；真的說可以修仍會被攔', () => {
    const negated = validateFaithfulnessReply('人生哲學目前標示為資格不符，所以不把它列為可修的推薦。', ledger());
    assert.ok(!negated.violations.some(item => item.code === 'ELIGIBILITY_OVERCLAIM'), JSON.stringify(negated.violations));
    const overclaim = validateFaithfulnessReply('人生哲學你可以直接修。', ledger());
    assert.ok(overclaim.violations.some(item => item.code === 'ELIGIBILITY_OVERCLAIM'));
  });

  test('F30e 備援回答只列原回答提到的課；沒問評價不提「涼」', async () => {
    const result = await enforceFaithfulReply({
      reply: '推薦社會企業實作專題，另外推薦「量子魔法課程」。',
      ledger: ledger(),
      userMessage: '有討論多的通識嗎？',
    });
    assert.equal(result.fallback, true);
    assert.match(result.reply, /社會企業實作專題/);
    assert.doesNotMatch(result.reply, /人生哲學/);
    assert.doesNotMatch(result.reply, /涼/);
    assert.equal(result.audit.passed, true);
  });

  test('F30f 表格沒有教師欄時不把學分或時間當成教師；有教師欄且不符仍會被攔', () => {
    const noTeacher = validateFaithfulnessReply('| 演算法 | 3 | 一03-04 |', scheduleLedger());
    assert.ok(!noTeacher.violations.some(item => item.code === 'COURSE_TEACHER_MISMATCH'), JSON.stringify(noTeacher.violations));
    const wrongTeacher = validateFaithfulnessReply('| 演算法 | 李大華 | 3 | 一03-04 |', scheduleLedger());
    assert.ok(wrongTeacher.violations.some(item => item.code === 'COURSE_TEACHER_MISMATCH'));
  });

  test('F30g 括號序號的課名被切在「實習」時仍對得上', () => {
    const ledger = queryLedger([course({ sectionId: 401, name: '校外專業實習(三)', teacher: '陳錫民', credits: 3, timeStr: '一 05' })]);
    const audit = validateFaithfulnessReply('- 校外專業實習(三)｜陳錫民｜3 學分', ledger);
    assert.ok(!audit.violations.some(item => item.code === 'UNSUPPORTED_COURSE'), JSON.stringify(audit.violations));
  });

  test('F30h 說明課程沒排入、方案學分事實、推薦方向不是違規；真的推薦被排除的課仍會被攔', () => {
    const ledger = scheduleLedger({}, {
      excludedCoursesSample: [course({ sectionId: 501, name: '人工智慧概論', teacher: '張三', credits: 3, timeStr: '五 03-04' })],
    });
    const fine = [
      '人工智慧概論目前也未列入，因資料判定大一概論性課程不認列為系外選修。',
      '目前產生的方案共 24 學分，其中體育 1 學分不計入畢業學分，實際計入 23 學分。',
      '這次我把「機器學習、Python」當作推薦方向。',
    ];
    for (const sentence of fine) {
      const audit = validateFaithfulnessReply(sentence, ledger);
      assert.equal(audit.passed, true, `${sentence}
${JSON.stringify(audit.violations)}`);
    }
    const recommended = validateFaithfulnessReply('我推薦你加選人工智慧概論。', ledger);
    assert.ok(recommended.violations.some(item => item.code === 'EXCLUDED_COURSE_PRESENTED_AS_RECOMMENDED'));
    const rule = validateFaithfulnessReply('修滿 128 學分才能畢業。', createEvidenceLedger());
    assert.ok(rule.violations.some(item => item.code === 'GRADUATION_RULE_WITHOUT_EVIDENCE'));
  });

  test('F30i 「還不能產生課表、需要確認」算揭露未完成；排課條件的引號不是課名', () => {
    const ledger = createEvidenceLedger();
    recordToolEvidence(ledger, {
      toolName: 'run_csp_scheduler', callId: 'call-s', dataSource: 'mysql',
      result: { success: false, solver: { status: 'data-insufficient' }, clarification: { required: true } },
    });
    const audit = validateFaithfulnessReply(
      '目前還不能產生課表，系統需要確認一項矛盾：你是否要將「午休不排課」視為絕對不可退讓的限制？', ledger
    );
    assert.equal(audit.passed, true, JSON.stringify(audit.violations));
    const quiet = validateFaithfulnessReply('好的，課表排好了。', ledger);
    assert.ok(quiet.violations.some(item => item.code === 'TOOL_FAILURE_NOT_DISCLOSED' || item.code === 'TOOL_FAILURE_PRESENTED_AS_SUCCESS'));
    const prefs = validateFaithfulnessReply('「重視平時成績」的關鍵字訊號很弱。', scheduleLedger());
    assert.ok(!prefs.violations.some(item => item.code === 'UNSUPPORTED_COURSE'), JSON.stringify(prefs.violations));
  });
});

