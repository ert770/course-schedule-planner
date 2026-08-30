// Roadmap #2：把「使用者對已產生課表的最終評價」轉成 interaction events。
//
// 排課只是推薦。**使用者是否覺得這份課表符合需求，才是「最終選擇」**，而系統
// 原本完全沒有取得這個訊號——排完課就結束了。Agent 現在會在排課後主動詢問，
// 使用者的回答經 `record_schedule_feedback` 工具進到這裡。
//
// 這一層負責 Agent 不該負責的事，其中最重要的是**來源驗證**：
//
//   模型是會編造的。只檢查「requestId 像不像 UUID」「planId 前綴對不對」
//   「這個 sectionId 在全校課程表裡找得到嗎」，等於完全沒有驗證——模型可以
//   捏出一組格式合法、但這位使用者從來沒看過的推薦，寫進一批假的 accepted／
//   withdrawn 標籤。#30 之後學到的東西就建立在這批假資料上。
//
//   因此這裡改成對照**曝光事件**：`recommendation_exposed` 記錄了這個 subject、
//   這個 requestId、主推方案的 planId，以及畫面上真正顯示過的課程清單。
//   使用者只可能接受自己看過的方案、只可能退掉自己看過的課。
import crypto from 'node:crypto';
import {
  INTERACTION_EVENT_TYPES,
  INTERACTION_FEEDBACK_REASONS,
  INTERACTION_SOURCES,
} from '../data/interactionEventSchema.js';
import { findExposure, recordInteractionEvents } from './interactionEventService.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const FEEDBACK_REASONS = new Set(Object.values(INTERACTION_FEEDBACK_REASONS));

// 同一份課表被確認兩次不應該產生兩筆事件。actionId 因此由
// `(requestId, planId)` 決定而不是每次隨機——重送同一個回答會撞到同一個
// idempotency key，被判為 duplicate 而不是新的一次接受。
function deterministicActionId(seed) {
  const hex = crypto.createHash('sha256').update(`schedule-feedback:${seed}`).digest('hex');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    `4${hex.slice(13, 16)}`,
    `8${hex.slice(17, 20)}`,
    hex.slice(20, 32),
  ].join('-');
}

/**
 * 記錄一次排課後的確認。
 *
 * @param identity `resolveIdentity()` 的結果。
 * @param args     `{ requestId, planId, accepted, rejectedCourses: [{ sectionId, reason }] }`
 * @param options  `{ loadExposure }` 可注入曝光來源；與 I/O 分離才測得到
 *                 （比照 `scheduleService.loadCourseReviewsSafely()` 的作法）。
 * @returns 給模型看的 Observation 物件；失敗時帶 `error` 讓模型知道該補什麼。
 */
export async function recordScheduleFeedback(identity, args = {}, options = {}) {
  const requestId = String(args.requestId ?? '').trim();
  if (!UUID_PATTERN.test(requestId)) {
    return { error: 'requestId 必須是上一次 run_csp_scheduler 回傳的值，不可自行編造。' };
  }

  const accepted = args.accepted === true;
  const rejected = Array.isArray(args.rejectedCourses) ? args.rejectedCourses : [];
  if (!accepted && rejected.length === 0) {
    // 這段文字是要給模型看的**修正指示**，不是給人看的錯誤說明。
    // 原本只寫「暫時不要呼叫這個工具」，在使用者其實已經指出某門課不適合時
    // 等於叫模型放棄——瀏覽器驗收時模型就是照做，回饋因此整個沒被記錄。
    return {
      error: 'rejectedCourses 是空的，accepted 也不是 true，因此沒有任何可記錄的回饋。'
        + '使用者若指出某一門課不適合，請帶上該課的 sectionId 與 reason 重新呼叫一次'
        + '（sectionId 只能取自 system prompt「最近一次推薦」列出的那份課表）；'
        + '使用者若是接受這份課表，請改送 accepted: true。兩者都不成立時才不要呼叫。',
    };
  }

  // 來源驗證：這個 requestId 必須真的是這位使用者看過的一次推薦。
  const loadExposure = options.loadExposure || (id => findExposure(identity, id));
  const exposure = await loadExposure(requestId);
  if (!exposure) {
    return {
      error: `找不到 requestId ${requestId} 對應的推薦曝光紀錄，無法記錄回饋。`
        + '請直接使用最近一次 run_csp_scheduler 回傳的 requestId，不要自行組合。',
    };
  }

  const drafts = [];
  // profileSchemaVersion 與 modelVersion 由 interactionEventService 以 server
  // 當下的版本填入；這裡只宣告 #26 尚未完成、理由版本確實不存在。
  const versionSnapshot = { recommendationReasonVersion: null };

  if (accepted) {
    // planId 必須與曝光紀錄一致。使用者只可能接受自己看過的那一份方案，
    // 不會接受一個從來沒有顯示過的 variant。
    const planId = String(args.planId ?? '').trim();
    if (!exposure.planId) {
      return { error: '該次推薦沒有可接受的方案，無法記錄接受。' };
    }
    if (planId && planId !== exposure.planId) {
      return {
        error: `planId ${planId} 不是該次推薦實際顯示的方案（應為 ${exposure.planId}）。`,
      };
    }

    drafts.push({
      eventType: INTERACTION_EVENT_TYPES.RECOMMENDATION_ACCEPTED,
      requestId,
      actionId: deterministicActionId(`${requestId}|${exposure.planId}|accepted`),
      term: exposure.term,
      plan: { planId: exposure.planId, variantId: exposure.variantId },
      position: { planRank: 1, courseRank: null },
      source: INTERACTION_SOURCES.SYSTEM_RECOMMENDATION,
      versionSnapshot,
    });
  }

  for (const entry of rejected) {
    const sectionId = Number(entry?.sectionId);
    // 「這門課存在嗎」不是重點，「它有出現在你說的那份推薦課表裡嗎」才是。
    // 只比對 displayedSet：沒被顯示過的課，使用者不可能退掉它。
    if (!exposure.displayedSectionIds.has(sectionId)) {
      return {
        error: `班次 ${entry?.sectionId} 不在該次推薦實際顯示的課表中，不能記為退選。`
          + '請只使用該次排課結果中的課程。',
      };
    }
    const reason = String(entry?.reason ?? '').trim();
    if (!FEEDBACK_REASONS.has(reason)) {
      return {
        error: `reason「${entry?.reason}」不在允許清單，只能是 ${[...FEEDBACK_REASONS].join('、')}。`,
      };
    }

    drafts.push({
      eventType: INTERACTION_EVENT_TYPES.COURSE_WITHDRAWN,
      requestId,
      actionId: deterministicActionId(`${requestId}|${sectionId}|withdrawn`),
      // 課號取自曝光紀錄本身，不另外查課程表——那份紀錄就是當時顯示的內容。
      course: {
        catalogCourseCode: exposure.displayedCourses.get(sectionId),
        sectionId,
      },
      term: exposure.term,
      // 這門課是**系統推薦進課表**的，使用者才有東西可以退。這裡不依
      // `Courses.type` 判成 `required`：那個欄位是「某個系所的必修」而不是
      // 「這位學生的必修」（#13A），用它標 source 會標錯一部分課。
      source: INTERACTION_SOURCES.SYSTEM_RECOMMENDATION,
      feedbackReason: reason,
      versionSnapshot,
    });
  }

  const result = await recordInteractionEvents(identity, drafts);
  return {
    success: true,
    accepted,
    rejectedCount: rejected.length,
    ...result,
  };
}

export default { recordScheduleFeedback };
