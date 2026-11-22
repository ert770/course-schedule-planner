import { Router } from 'express';
import { getUserPreferences, updateUserPreferences } from '../services/memoryService.js';
import { validateProfileUpdate } from '../data/profileUpdateValidation.js';
import { buildCourseSearchScope } from '../skills/courseScope.js';
import { PREFERENCE_TAG_GROUPS } from '../data/preferenceTags.js';
import { requireIdentity } from '../middleware/requireIdentity.js';
import { requireServiceConsent } from '../middleware/requireConsent.js';
import { FOLLOWUP_REQUESTS_PER_MINUTE, QUESTIONNAIRE_REQUESTS_PER_MINUTE } from '../data/interestMenuConfig.js';
import { getInterestFollowups, validateFollowupRequest } from '../services/interestFollowupService.js';
import { getInterestQuestion, validateQuestionRequest } from '../services/interestQuestionnaireService.js';
import { sanitizeInterestSelectionsForSave } from '../services/interestSelectionService.js';
import { checkRateLimit } from '../utils/rateLimiter.js';

const router = Router();

// 偏好標籤的定義清單。
//
// **為什麼要開一支 API**：這份清單原本在前端寫死兩份（`SetupPage.jsx` 與
// `DashboardPage.jsx`），加上後端一份共三份各自維護。實測時 Dashboard 那份
// 已經漏掉 `#不點名`，而且用的是舊的布林 key 而非標籤——人工對照多份清單
// 必然漂移，只是遲早的問題。
//
// 這裡不需要身分驗證：回傳的是標籤目錄本身，不是任何使用者的資料。
router.get('/preference-tags', (req, res) => {
  res.json({ groups: PREFERENCE_TAG_GROUPS });
});

router.get('/', requireIdentity, requireServiceConsent, async (req, res) => {
  try {
    const prefs = await getUserPreferences(req.identity);
    res.json({
      ...prefs,
      courseSearchScope: buildCourseSearchScope(prefs),
    });
  } catch (err) {
    res.status(err.status || 500).json({
      error: err.message,
      ...(err.code ? { code: err.code } : {}),
    });
  }
});

// 設定頁「想接觸的課程主題」的追問題目：每個勾選的類別問一題，選項是這位學生的候選池裡該類別的可選標籤。
// 見 `services/interestFollowupService.js`。失敗（含 OpenAI 逾時）一律回固定問句，不回錯誤。
/**
 * `POST /interest-followups` 的處理邏輯（身分與同意已由 middleware 檢查）。抽出來讓測試可以注入假的
 * 限流、偏好與追問服務，不必連資料庫或 OpenAI。
 * @returns `{ status, body }`
 */
export async function handleInterestFollowupsRequest({ identity, body }, {
  checkLimit = checkRateLimit,
  loadPrefs = getUserPreferences,
  getFollowups = getInterestFollowups,
} = {}) {
  // 限流的 key 只存在記憶體，不寫入任何資料表。
  if (!checkLimit(`interest-followups:${identity.canonicalId}`, FOLLOWUP_REQUESTS_PER_MINUTE)) {
    return { status: 429, body: { error: '操作太頻繁，請稍後再試。', code: 'RATE_LIMITED' } };
  }
  const parsed = validateFollowupRequest(body);
  if (parsed.error) return { status: 400, body: { error: parsed.error } };

  const current = await loadPrefs(identity);
  return {
    status: 200,
    body: await getFollowups({ ...parsed.value, previousSelections: current.interestSelections }),
  };
}

// 課程主題問答 v1（ADR-027）：逐題出題。選項由後端從候選池選好，語言模型只改寫文案；失敗一律退回固定文案，
// 不回錯誤。見 `services/interestQuestionnaireService.js`。
/**
 * `POST /interest-questions` 的處理邏輯（身分與同意已由 middleware 檢查）。
 * 不讀這位使用者的 Profile：出題只依候選池與這次請求帶的方向，已存的答案由前端帶來（stage=summary）。
 * @returns `{ status, body }`
 */
export async function handleInterestQuestionRequest({ identity, body }, {
  checkLimit = checkRateLimit,
  getQuestion = getInterestQuestion,
} = {}) {
  // 限流的 key 只存在記憶體，不寫入任何資料表。
  if (!checkLimit(`interest-questions:${identity.canonicalId}`, QUESTIONNAIRE_REQUESTS_PER_MINUTE)) {
    return { status: 429, body: { error: '操作太頻繁，請稍後再試。', code: 'RATE_LIMITED' } };
  }
  const parsed = validateQuestionRequest(body);
  if (parsed.error) return { status: 400, body: { error: parsed.error } };
  return { status: 200, body: await getQuestion(parsed.value) };
}

/**
 * 保存偏好前處理課程主題選擇：對照候選池驗證，把 `updates.interestSelections` 換成驗證後的結果。
 * 沒送 `interestSelections` 時回 null（回應不帶狀態欄位）。學生範圍以這次送的欄位優先，沒送才用已保存的。
 * @returns `{ status, warnings, selections } | null`
 */
export async function applyInterestSelectionValidation(updates, identity, {
  loadPrefs = getUserPreferences,
  sanitize = sanitizeInterestSelectionsForSave,
} = {}) {
  if (updates.interestSelections === undefined) return null;
  const current = await loadPrefs(identity);
  const result = await sanitize({
    selections: updates.interestSelections,
    previousSelections: current.interestSelections,
    filters: {
      department: updates.department ?? current.department,
      gradeLevel: updates.gradeLevel ?? current.gradeLevel,
      className: updates.className ?? current.className,
    },
  });
  updates.interestSelections = result.selections;
  return result;
}

/** `POST /api/profile` 的成功回應：有處理課程主題選擇時才附上狀態與警告。 */
export function buildProfileSaveResponse(updated, selectionResult) {
  return {
    success: true,
    preferences: updated,
    ...(selectionResult ? {
      interestSelectionsStatus: selectionResult.status,
      interestSelectionWarnings: selectionResult.warnings,
    } : {}),
  };
}

router.post('/interest-followups', requireIdentity, requireServiceConsent, async (req, res) => {
  try {
    const { status, body } = await handleInterestFollowupsRequest({ identity: req.identity, body: req.body });
    res.status(status).json(body);
  } catch (err) {
    if (!err.status) console.error('Interest followups error:', err);
    res.status(err.status || 500).json({
      error: err.message,
      ...(err.code ? { code: err.code } : {}),
    });
  }
});

router.post('/interest-questions', requireIdentity, requireServiceConsent, async (req, res) => {
  try {
    const { status, body } = await handleInterestQuestionRequest({ identity: req.identity, body: req.body });
    res.status(status).json(body);
  } catch (err) {
    if (!err.status) console.error('Interest questions error:', err);
    res.status(err.status || 500).json({
      error: err.message,
      ...(err.code ? { code: err.code } : {}),
    });
  }
});

router.post('/', requireIdentity, requireServiceConsent, async (req, res) => {
  try {
    const { userId, ...updates } = req.body;

    // 輸入驗證抽在 `data/profileUpdateValidation.js`，可以不起 HTTP server 就測（見該檔說明）。
    const validationError = validateProfileUpdate(updates);
    if (validationError) return res.status(400).json({ error: validationError });

    // 避開時段接受第 1～14 節。先前這裡會在含第 1 節時回 400，要求改用
    // 「#不排早八」標籤（舊決策 C）——但那兩者不是同一件事：標籤是「每天的
    // 第一節都不要」，避開時段是「這個星期幾的這一節不要」。擋掉第 1 節等於
    // 讓使用者無法只避開某一天的早八。兩者可重疊，排課時取聯集。
    // 課程主題的選擇結果：保存前對照這位學生的候選池（見 `services/interestSelectionService.js`）。
    // 驗證不過的標籤丟掉並回報；候選池載入失敗時不接受新的標籤，但**不擋住其他欄位保存**。
    const selectionResult = await applyInterestSelectionValidation(updates, req.identity);

    const updated = await updateUserPreferences(req.identity, updates);
    res.json(buildProfileSaveResponse(updated, selectionResult));
  } catch (err) {
    res.status(err.status || 500).json({
      error: err.message,
      ...(err.code ? { code: err.code } : {}),
    });
  }
});

export default router;
