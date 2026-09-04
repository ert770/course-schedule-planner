import { Router } from 'express';
import { validateSchedule } from '../skills/scheduler.js';
import { validateScheduleAgainstConstraints } from '../skills/scheduleValidator.js';
import { saveSchedule, getSavedSchedules } from '../services/memoryService.js';
import { generateForUser, counterfactualForUser } from '../services/scheduleService.js';
import { requireIdentity } from '../middleware/requireIdentity.js';
import { requireServiceConsent } from '../middleware/requireConsent.js';

const router = Router();

router.post('/generate', requireIdentity, requireServiceConsent, async (req, res) => {
  try {
    const { userId, courseIds = [], filters = {}, constraints = {}, surface, trigger } = req.body;

    // 排課流程只有一份實作，與 AI Agent 的 `run_csp_scheduler` 共用
    // （見 `services/scheduleService.js`），避免兩條路徑各自漂移。
    // `surface`／`trigger` 是哪個畫面、哪個動作觸發了這次排課——只用來標記
    // 曝光事件（roadmap #2），不影響候選池或排課結果。
    const result = await generateForUser(req.identity, { courseIds, filters, constraints, surface, trigger });
    res.json(result);
  } catch (err) {
    if (!err.status) console.error('Schedule error:', err);
    res.status(err.status || 500).json({ error: err.message, ...(err.code ? { code: err.code } : {}) });
  }
});

// Roadmap #27：counterfactual——「取消某項偏好，課表會怎麼變」。
//
// 只在使用者展開比較面板時才呼叫，不併進 `/generate`（見
// `scheduleService.counterfactualForUser()` 的效能說明）。這條路徑不會寫
// 任何互動事件、不記曝光——使用者只是在問假設性問題。
router.post('/counterfactual', requireIdentity, requireServiceConsent, async (req, res) => {
  try {
    const { courseIds = [], filters = {}, constraints = {} } = req.body;
    const result = await counterfactualForUser(req.identity, { courseIds, filters, constraints });
    res.json(result);
  } catch (err) {
    if (!err.status) console.error('Counterfactual error:', err);
    res.status(err.status || 500).json({ error: err.message, ...(err.code ? { code: err.code } : {}) });
  }
});

router.post('/validate', (req, res) => {
  try {
    const { courses, constraints = {} } = req.body;
    const result = validateSchedule(courses);

    // roadmap #21 + Codex adversarial review 修正（2026-08-20）：原本只在
    // 請求帶有非空 constraints 時才額外跑完整硬性限制檢查，導致目前唯一
    // 的實際呼叫模式（`client/src` 尚未呼叫這支端點，但外部呼叫端可能
    // 只送 `{courses}`）完全繞過了不需要 constraints 就能檢查的規則
    // （例如 roadmap #15 的共同必修配對完整性）——把生成好的一組配對課表
    // 拿掉其中一半再送回來驗證，回應仍會是 `valid`。現在一律執行，
    // 附加於既有欄位之外，不取代它們；沒有 constraints 時傳空物件即可，
    // `validateScheduleAgainstConstraints()` 已對每一項規則各自處理
    // constraints 資料不足的情況（回報進 `unchecked`，不是假裝通過）。
    const extended = validateScheduleAgainstConstraints(courses, constraints);
    result.violations = extended.violations;
    result.unchecked = extended.unchecked;
    result.hardConstraintsValid = extended.valid;

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/save', requireIdentity, requireServiceConsent, async (req, res) => {
  try {
    const { userId, name = '我的課表', schedule, totalCredits } = req.body;
    const saved = await saveSchedule(req.identity.canonicalId, name, schedule, totalCredits);
    res.json({ success: true, schedule: saved });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/saved', requireIdentity, requireServiceConsent, async (req, res) => {
  try {
    const schedules = await getSavedSchedules(req.identity.canonicalId);
    res.json({ schedules });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
