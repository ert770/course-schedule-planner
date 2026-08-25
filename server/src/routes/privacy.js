import { Router } from 'express';
import { requireIdentity } from '../middleware/requireIdentity.js';
import {
  PrivacyError, clearChatHistory, consumeDeletionIntent, createDeletionIntent,
  deriveSubjectId, getConsentStatus, getPrivacyPolicy, markServiceWithdrawn, recordConsentChoices, writeAudit,
} from '../services/privacyService.js';
import { deleteUserServiceData, getSavedSchedules, getUserPreferences } from '../services/memoryService.js';
import { deleteInteractionEvents, getInteractionEventsForExport } from '../services/interactionEventService.js';
import { buildClearSessionCookie } from '../services/sessionService.js';

const router = Router();
const requestId = req => String(req.get('x-request-id') || '').slice(0, 128) || null;

function sendPrivacyError(res, err) {
  if (err instanceof PrivacyError) return res.status(err.status).json({ error: err.message, code: err.code });
  console.error('Privacy route error:', err.message);
  return res.status(500).json({ error: '隱私服務暫時無法使用', code: 'PRIVACY_STORE_UNAVAILABLE' });
}

router.get('/policy', (req, res) => res.json(getPrivacyPolicy()));

router.get('/consents', requireIdentity, async (req, res) => {
  try { res.json(await getConsentStatus(req.identity)); } catch (err) { sendPrivacyError(res, err); }
});

router.put('/consents', requireIdentity, async (req, res) => {
  try {
    res.json(await recordConsentChoices(req.identity, req.body?.consents, { requestId: requestId(req) }));
  } catch (err) { sendPrivacyError(res, err); }
});

router.get('/export', requireIdentity, async (req, res) => {
  try {
    const [profile, schedules, privacy, interactionEvents] = await Promise.all([
      getUserPreferences(req.identity), getSavedSchedules(req.identity.canonicalId), getConsentStatus(req.identity),
      getInteractionEventsForExport(req.identity),
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
    const deleted = { ...(await deleteUserServiceData(req.identity)), ...interactionsDeleted };
    await writeAudit(subjectId, 'delete', 'service_data', 'success', deleted, requestId(req));
    res.setHeader('Clear-Site-Data', '"cache", "storage"');
    res.setHeader('Set-Cookie', buildClearSessionCookie());
    res.json({
      success: true,
      status: 'deleted',
      message: '服務帳號、Profile、修課歷史、已存課表、互動事件與 Raw Chat 已刪除；最小同意／稽核記錄依政策保留。',
      deleted,
    });
  } catch (err) { sendPrivacyError(res, err); }
});

export default router;
