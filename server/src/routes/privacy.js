import { Router } from 'express';
import { requireIdentity } from '../middleware/requireIdentity.js';
import {
  PrivacyError, clearChatHistory, consumeDeletionIntent, createDeletionIntent,
  deriveSubjectId, getConsentStatus, getPrivacyPolicy, markServiceWithdrawn, recordConsentChoices, writeAudit,
} from '../services/privacyService.js';
import { PRIVACY_PURPOSES, PRIVACY_POLICY_VERSION } from '../data/privacyPolicy.js';
import { deleteUserServiceData, getSavedSchedules, getUserPreferences } from '../services/memoryService.js';
import { deleteInteractionEvents, getInteractionEventsForExport } from '../services/interactionEventService.js';
import {
  deleteLearnedWeights, getStoredLearnedWeights, resetPersonalization, getPersonalizationSource,
} from '../services/preferenceLearningService.js';
import { buildClearSessionCookie } from '../services/sessionService.js';

const router = Router();
const requestId = req => String(req.get('x-request-id') || '').slice(0, 128) || null;

function sendPrivacyError(res, err) {
  if (err instanceof PrivacyError) return res.status(err.status).json({ error: err.message, code: err.code });
  if (err?.code === 'COURSE_HISTORY_UNAVAILABLE') {
    return res.status(err.status || 503).json({ error: err.message, code: err.code });
  }
  console.error('Privacy route error:', err.message);
  return res.status(500).json({ error: '隱私服務暫時無法使用', code: 'PRIVACY_STORE_UNAVAILABLE' });
}

router.get('/policy', (req, res) => res.json(getPrivacyPolicy()));

router.get('/consents', requireIdentity, async (req, res) => {
  try { res.json(await getConsentStatus(req.identity)); } catch (err) { sendPrivacyError(res, err); }
});

router.put('/consents', requireIdentity, async (req, res) => {
  try {
    // 撤回必須先落地、再刪除——與下面 `DELETE /data` 的順序同一個理由（見該
    // 路由註解）：先寫入撤回，並行中的 `POST /api/interactions` 就只剩「搶在
    // 撤回前落地並被下面刪掉」或「看到已撤回而被拒絕」兩種結局，不會在刪除
    // 跑完之後補寫。
    const status = await recordConsentChoices(req.identity, req.body?.consents, { requestId: requestId(req) });

    // roadmap #31：撤回「從互動持續改善個人化」等於硬性暫停——連同已學到的
    // 權重與作為輸入的互動事件一起刪除，不是留著不用。判定用**寫入後的權威
    // 狀態**，不是 `req.body`；`policyVersion` 也必須對到現行版本，與
    // `hasPersonalizationConsent()` 用的是同一個標準（舊版政策下同意過不算
    // 現在仍然同意）。
    const learning = status.consents?.[PRIVACY_PURPOSES.PERSONALIZATION_LEARNING];
    const stillGranted = Boolean(learning?.granted && learning.policyVersion === PRIVACY_POLICY_VERSION);
    if (!stillGranted) {
      await resetPersonalization(req.identity, { requestId: requestId(req) });
    }

    res.json(status);
  } catch (err) { sendPrivacyError(res, err); }
});

// roadmap #31：目前個人化用的是顯式設定、學到的權重、還是資料不足／未同意。
// 只掛 `requireIdentity`，不掛 consent 中介層——沒同意的人正是要看到
// `no-consent` 這個狀態，擋在 consent 檢查後面反而讓這個狀態永遠讀不到。
//
// 這支 GET 在結果過期時會順手重算並寫回一列（見
// `preferenceLearningService.js` 的 `getPersonalizationSource()`）——它是
// 冪等的快取填充，不是新的寫入語意，但呼叫端不該假設 `GET /privacy/*`
// 一律唯讀。
router.get('/personalization', requireIdentity, async (req, res) => {
  try { res.json(await getPersonalizationSource(req.identity)); }
  catch (err) { sendPrivacyError(res, err); }
});

// roadmap #31：只清學習結果與其輸入的互動事件，顯式 Profile（偏好標籤、
// 避開時段、學分上限）完全不受影響——與 `DELETE /data`（清整個帳號）是
// 不同量級的操作，因此不套用它的確認詞儀式；前端用 `window.confirm` 把
// 「會刪除什麼、不會刪除什麼」講清楚後才送出這個請求。
router.delete('/personalization', requireIdentity, async (req, res) => {
  try { res.json({ success: true, ...(await resetPersonalization(req.identity, { requestId: requestId(req) })) }); }
  catch (err) { sendPrivacyError(res, err); }
});

router.get('/export', requireIdentity, async (req, res) => {
  try {
    const [profile, schedules, privacy, interactionEvents, learnedPreferenceWeights] = await Promise.all([
      getUserPreferences(req.identity), getSavedSchedules(req.identity.canonicalId), getConsentStatus(req.identity),
      getInteractionEventsForExport(req.identity),
      // roadmap #30：匯出目前**已存**的權重，不在匯出當下重算——匯出應該反映
      // 「系統實際在用什麼」，不是「現在重跑一次會得到什麼」。從未算過（consent
      // 從未開啟過或還沒觸發過計算）時為 null，如實回報，不假裝有資料。
      getStoredLearnedWeights(req.identity),
    ]);
    const { userId: _userId, studentId: _studentId, displayName: _displayName, ...portableProfile } = profile;
    const payload = {
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      data: {
        profile: portableProfile,
        savedSchedules: schedules.map(({ userId: _scheduleUserId, ...schedule }) => schedule),
        consents: privacy.consents,
        // roadmap #2：本人可取回自己的互動事件。刻意不含 subject ID——
        // 匯出它等於把假名與本人身分綁在同一份檔案裡。
        interactionEvents,
        // roadmap #30：`privacyPolicy.js` 的 `personalization_learning.data`
        // 早就列了 `learned_preference_weights`，這裡是把那個承諾兌現。
        learnedPreferenceWeights,
      },
      excluded: ['password', 'internal subject ID', 'Raw Chat plaintext', 'model thought', 'research event rows'],
    };
    await writeAudit(deriveSubjectId(req.identity.canonicalId), 'export', 'service_data', 'success', {}, requestId(req));
    res.setHeader('Content-Disposition', `attachment; filename="privacy-export-${Date.now()}.json"`);
    res.setHeader('Cache-Control', 'no-store');
    res.json(payload);
  } catch (err) { sendPrivacyError(res, err); }
});

router.delete('/chat', requireIdentity, async (req, res) => {
  try { res.json({ success: true, ...(await clearChatHistory(req.identity)) }); }
  catch (err) { sendPrivacyError(res, err); }
});

router.post('/deletion-intents', requireIdentity, async (req, res) => {
  try { res.status(201).json(await createDeletionIntent(req.identity)); }
  catch (err) { sendPrivacyError(res, err); }
});

// 這會刪除登入列，完成後 session 隨即失效。跨 MySQL／JSON 無法組成單一交易，
// 因此各步驟保持 idempotent；若儲存體失敗，回 500 並由稽核紀錄人工重試。
router.delete('/data', requireIdentity, async (req, res) => {
  try {
    if (req.body?.confirmationPhrase !== '刪除我的資料') {
      throw new PrivacyError('確認詞不正確', { status: 400, code: 'INVALID_CONFIRMATION_PHRASE' });
    }
    await consumeDeletionIntent(req.identity, req.body?.requestId, req.body?.token);
    const subjectId = deriveSubjectId(req.identity.canonicalId);
    await writeAudit(subjectId, 'delete', 'service_data', 'started', {}, requestId(req));
    // **撤回必須在刪除之前。** 這個順序不是風格問題：一個已經通過 consent 檢查、
    // 正在執行中的 `POST /api/interactions` 可以在刪除跑完之後才落地，讓刪除
    // 回報成功卻仍留下個人資料。先標記撤回，並行的寫入就只剩兩種結局——
    // 搶在撤回前落地（隨後被下面的刪除清掉），或看到已撤回而被拒絕。
    await markServiceWithdrawn(req.identity);
    await clearChatHistory(req.identity);
    const interactionsDeleted = await deleteInteractionEvents(subjectId);
    const learnedWeightsDeleted = await deleteLearnedWeights(subjectId);
    const deleted = {
      ...(await deleteUserServiceData(req.identity)),
      ...interactionsDeleted,
      ...learnedWeightsDeleted,
    };
    await writeAudit(subjectId, 'delete', 'service_data', 'success', deleted, requestId(req));
    res.setHeader('Clear-Site-Data', '"cache", "storage"');
    res.setHeader('Set-Cookie', buildClearSessionCookie());
    res.json({
      success: true,
      status: 'deleted',
      message: '服務帳號、Profile、修課歷史、已存課表、互動事件、學習權重與 Raw Chat 已刪除；最小同意／稽核記錄依政策保留。',
      deleted,
    });
  } catch (err) { sendPrivacyError(res, err); }
});

export default router;
