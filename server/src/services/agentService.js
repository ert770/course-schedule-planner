// AI Agent 的對話迴圈。
//
// **用 Responses API 而不是 Chat Completions**：`gpt-5.6-luna` 是推理模型，
// 在 /v1/chat/completions 上掛 function tools 會被直接擋下——
//   「Function tools with reasoning_effort are not supported for gpt-5.6-luna
//     in /v1/chat/completions. To use function tools, use /v1/responses or
//     set reasoning_effort to 'none'.」
// 兩條路都能走通，選 /v1/responses 是因為另一條要把推理關掉，而這個 Agent
// 要做的正是多步驟推理（判斷缺什麼資料 → 查課 → 排課 → 依結果追問）。
//
// 也因為是推理模型，這裡不送 `temperature`：推理模型不吃這個參數。

import OpenAI from 'openai';
import { buildSystemPrompt, getAgentTools } from './promptService.js';
import { getUserPreferences, updateUserPreferences } from './memoryService.js';
import { getChatHistory, saveChatExchange } from './privacyService.js';
import { searchCoursesForAgent } from '../skills/courseQuery.js';
import { getEasyCourses, getSentimentSummary } from '../skills/reviewSearch.js';
import { generateForUser } from './scheduleService.js';
import { recordScheduleFeedback } from './scheduleFeedbackService.js';
import { findLatestExposureRequestId } from './interactionEventService.js';
import { getAll } from '../db/database.js';
import { logger } from '../utils/logger.js';
import { buildStudentScope } from '../skills/courseScope.js';

let ai = null;

function getAIClient() {
  if (!ai && process.env.OPENAI_API_KEY) {
    ai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return ai;
}

// model id 一律由環境變數決定，不寫死在程式裡——換模型是部署設定，不是改程式。
// fallback 值刻意與 `.env.example` 一致：若哪天 `.env` 少了這一行，系統會用
// 同一個模型而不是靜默改用另一個，否則你不會知道跑的不是指定的模型。
function getModel() {
  return process.env.OPENAI_MODEL || 'gpt-5.6-luna';
}

const DEFAULT_MAX_STEPS = 12;
// 每一步都是一次模型往返，而且 `input` 會持續累積（推理項目 + 工具結果）。
// 不設天花板的話，一個卡住的模型會把延遲與費用拉到無界，也會重新逼近剛修好的
// context window 問題——設定值寫錯（AGENT_MAX_STEPS=1000）不該變成一次失控的請求。
const MAX_STEPS_CEILING = 20;

export function resolveMaxSteps(raw = process.env.AGENT_MAX_STEPS) {
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed < 1) return DEFAULT_MAX_STEPS;
  return Math.min(parsed, MAX_STEPS_CEILING);
}

// 哪些工具的結果要一併回傳給前端渲染。`record_schedule_feedback` 與
// `update_preferences` 只是確認訊息，讓它們覆蓋 `data` 會把畫面上已經顯示的
// 課表洗掉。
const RENDERABLE_TOOLS = new Set([
  'query_course_db', 'search_dcard_reviews', 'run_csp_scheduler', 'get_easy_courses',
]);

/**
 * 一次工具呼叫的結果，對回應信封（`intent` / `data`）代表什麼。
 *
 * **工具回 `{ error }` 代表那件事沒有發生**，`intent` 與 `data` 都不該宣稱它發生了。
 * 先前這兩個欄位是在工具執行**之前**就無條件設定的：`record_schedule_feedback`
 * 被驗證擋下時，回應照樣帶 `intent: "record_schedule_feedback"`，但資料庫裡一筆
 * 回饋都沒有；`data` 更直接被塞進一個錯誤物件。
 *
 * 目前兩個消費端（`ChatPanel.jsx`、`DashboardPage.jsx`）都額外檢查
 * `data?.success` 才躲過這件事，但那是呼叫端在替上游遮錯——一旦有人照字面相信
 * `intent`（例如顯示「已記錄你的回饋」），就會對使用者說謊。
 *
 * 抽成純函式是為了測得到：`handleChat` 需要真的資料庫與真的模型呼叫，整條迴圈
 * 無法在單元測試裡跑，但這個判斷本身完全不需要 I/O。
 */
export function applyToolOutcome(envelope, toolName, result) {
  if (result && typeof result === 'object' && result.error) return envelope;
  return {
    intent: toolName || envelope.intent,
    data: RENDERABLE_TOOLS.has(toolName) ? result : envelope.data,
  };
}

// 模型送來的參數字串不保證是合法 JSON。壞掉時回 null，讓呼叫端把錯誤當成
// tool result 餵回去讓模型自己修，而不是讓整個請求爆掉。
function parseToolArguments(raw) {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

// 排課結果整包序列化是 **838 KB**（`excludedCourses` 一項就有 200+ 門完整課程
// 物件，`plans` 每個方案又各自帶一份完整課表）。原封不動餵回模型，第二次排課
// 就會撞上 `400 Your input exceeds the context window of this model`——瀏覽器
// 驗收時就是這樣壞的。
//
// 這裡投影出模型真正會用到的欄位（system prompt 明文提到的那些：solver、
// clarification、preferenceScore、reviewCoverage、reviewEvidence、warnings…），
// 課程物件只留可辨識與可解釋的欄位。**完整結果仍原封不動回傳給前端**渲染，
// 被裁掉的只有送進模型的那一份。
function compactCourse(course) {
  if (!course || typeof course !== 'object') return course;
  return {
    sectionId: course.sectionId ?? course.id,
    catalogCourseCode: course.catalogCourseCode,
    name: course.name,
    teacher: course.teacher ?? course.instructor,
    credits: course.credits,
    timeStr: course.timeStr,
    category: course.category,
    eligibility: course.eligibility,
    eligibilityReason: course.eligibilityReason,
    countsTowardGraduation: course.countsTowardGraduation,
    reviewEvidence: course.reviewEvidence ?? null,
  };
}

const EXCLUDED_SAMPLE_SIZE = 15;

export function summarizeScheduleForModel(result) {
  if (!result || typeof result !== 'object') return result;
  const excluded = Array.isArray(result.excludedCourses) ? result.excludedCourses : [];
  return {
    success: result.success,
    requestId: result.requestId,
    message: result.message,
    totalCredits: result.totalCredits,
    graduationCredits: result.graduationCredits,
    nonGraduationCredits: result.nonGraduationCredits,
    courseCount: result.courseCount,
    hasExpressedPreference: result.hasExpressedPreference,
    reviewDataLoaded: result.reviewDataLoaded,
    isDraft: result.isDraft,
    schedule: (result.schedule || []).map(compactCourse),
    draftSchedule: (result.draftSchedule || []).map(compactCourse),
    unscheduledCourses: (result.unscheduledCourses || []).map(compactCourse),
    watchedCourses: (result.watchedCourses || []).map(compactCourse),
    // 方案只保留可比較的中繼資料；每個方案自己那份完整課表不再重複送。
    plans: (result.plans || []).map(plan => ({
      planId: plan.planId,
      variantId: plan.variantId,
      title: plan.title,
      description: plan.description,
      success: plan.success,
      totalCredits: plan.totalCredits,
      courseCount: plan.courseCount,
      preferenceScore: plan.preferenceScore,
      preferenceBreakdown: plan.preferenceBreakdown,
      reviewCoverage: plan.reviewCoverage,
      warnings: plan.warnings,
    })),
    // 被排除的課動輒 200+ 門，全送沒有意義；給總數與少量樣本讓模型能說明原因。
    excludedCourseCount: excluded.length,
    excludedCoursesSample: excluded.slice(0, EXCLUDED_SAMPLE_SIZE).map(item => ({
      ...compactCourse(item.course),
      reason: item.reason,
      constraintId: item.constraintId,
    })),
    unmetRequirements: result.unmetRequirements,
    clarification: result.clarification,
    solver: result.solver,
    warnings: result.warnings,
    preferenceProfile: result.preferenceProfile,
  };
}

/**
 * 執行一個工具呼叫，回傳要餵回模型的 Observation 物件。
 *
 * 抽成獨立函式而不是留在對話迴圈裡，是為了讓工具派送**可以被單元測試**——
 * 它決定了模型能對這位使用者的資料做什麼，卻因為卡在需要網路的迴圈中間，
 * 先前完全沒有測試覆蓋。
 *
 * 任何工具丟出的例外都會被包成 `{ error }` 回傳，不往外拋：一個工具失敗
 * 應該讓模型知道並改用別的方法，不是讓整段對話中止。
 *
 * @param name 工具名稱。
 * @param args 已解析的參數物件。
 * @param ctx  `{ identity, prefs, studentScope }`。
 * @param deps 可注入的下游實作；與 I/O 分離才測得到（比照
 *             `scheduleService.loadCourseReviewsSafely()` 與
 *             `scheduleFeedbackService` 的 `loadExposure`）。
 */
export async function executeAgentTool(name, args = {}, ctx = {}, deps = {}) {
  const { identity, prefs, studentScope } = ctx;
  const {
    searchCourses = searchCoursesForAgent,
    sentimentSummary = getSentimentSummary,
    generateSchedule = generateForUser,
    recordFeedback = recordScheduleFeedback,
    easyCourses = getEasyCourses,
    updatePreferences = updateUserPreferences,
  } = deps;

  try {
    switch (name) {
      case 'query_course_db': {
        const courses = await searchCourses(args, studentScope);
        return courses.length > 10 ? courses.slice(0, 10) : courses;
      }

      case 'search_dcard_reviews': {
        const courses = await searchCourses({ keyword: args.keyword }, studentScope);
        if (courses.length === 0) return { error: '找不到該課程的評價' };
        return { ...(await sentimentSummary(courses[0].id)), courseName: courses[0].name };
      }

      case 'run_csp_scheduler': {
        // 與 `POST /api/schedule/generate` **走同一條路徑**。
        // Chat 只是讓使用者用自然語言表達需求與條件的介面，不是另一套排課實作；
        // 先前這裡自己組一份，只要 REST 那條加了前置條件就會靜默落後。
        //
        // `surface`／`trigger` 在這裡固定寫死，不讓模型決定——這次推薦
        // 曝光在哪個畫面、被什麼觸發是系統事實（Chat 介面本身），不是
        // 模型需要理解或可能講錯的東西。
        return await generateSchedule(
          identity, { constraints: args, surface: 'chat', trigger: 'chat_tool' }, { prefs }
        );
      }

      case 'record_schedule_feedback':
        // roadmap #2：排課後的確認就是「使用者最終選擇」。模型只轉述
        // 使用者說了什麼，欄位長相與合法性由 service 決定。
        return await recordFeedback(identity, args);

      case 'get_easy_courses':
        return await easyCourses(args.limit || 10);

      case 'update_preferences':
        await updatePreferences(identity, args);
        // 同一次對話後續的排課要看得到剛更新的偏好，否則模型會以為存了卻沒生效。
        if (prefs) Object.assign(prefs, args);
        return { success: true, updatedFields: args };

      default:
        return { error: `不明的函數呼叫: ${name}` };
    }
  } catch (err) {
    return { error: `執行工具發生錯誤: ${err.message}` };
  }
}

// 把最近一次 chat 推薦補成「模型用得上」的形狀：requestId、planId，以及那份
// 課表每一門課的 sectionId 與課名。
//
// 曝光紀錄只存 sectionId 與課號（course name 不進 interaction event），但模型
// 需要的是「使用者說的『程式語言』是哪一個 sectionId」，因此課名在這裡才從課程
// 資料補上——`getAll('courses')` 有 TTL 快取，不會每回合都下全表查詢。
async function resolveLatestRecommendation(identity) {
  const latest = await findLatestExposureRequestId(identity);
  if (!latest?.requestId) return null;
  if (!latest.displayedSet?.length) return latest;

  const wanted = new Map(latest.displayedSet.map(course => [String(course.sectionId), course]));
  let courses = [];
  try {
    courses = await getAll('courses');
  } catch (err) {
    // 補課名失敗不該讓整段對話失敗；沒有課名時模型至少還有課號可用。
    logger.warn(`補齊推薦課程名稱失敗：${err.message}`, { label: 'AgentCore' });
  }
  for (const course of courses) {
    const entry = wanted.get(String(course.id));
    if (entry) entry.name = course.name;
  }
  return { ...latest, displayedSet: [...wanted.values()] };
}

// `identity` 為 `resolveIdentity()` 的結果，不是原始 userId。
// 聊天記憶與偏好更新都以 canonical ID（學號）為鍵，避免同一位學生的對話
// 依前端送的是學號還是 numeric id 而分裂成兩份。
export async function handleChat(identity, message) {
  logger.info('收到已驗證的聊天請求', { label: 'AgentCore', messageLength: message.length });

  const client = getAIClient();
  if (!client) {
    const errorMsg = '系統發生錯誤：伺服器未設定 OPENAI_API_KEY。';
    logger.error('遺失 OPENAI_API_KEY', { label: 'AgentCore' });
    return { reply: errorMsg, intent: 'error', data: null };
  }

  const prefs = await getUserPreferences(identity);
  const studentScope = buildStudentScope(prefs);
  logger.debug('已載入使用者限制條件（內容不記錄）', { label: 'Memory' });

  // 上一輪排課的 requestId 只存在於那一輪的 tool 結果裡，而
  // `saveChatExchange()` 只保存使用者訊息與最終文字回覆——下一輪重建對話時
  // 它已經不存在了。少了它，模型手上沒有任何合法的 requestId，
  // `record_schedule_feedback` 實際上永遠呼叫不成功：Agent 問了「這份課表符合
  // 需求嗎」，使用者答了，訊號卻無處可記（瀏覽器驗收時模型自己講了這件事）。
  //
  // 因此由伺服器把「最近一次推薦是哪一次」直接補進 prompt，而不是要求模型
  // 自己記住或自行編造。來源驗證不受影響：`scheduleFeedbackService` 仍會
  // 對照曝光紀錄，這裡只是把資料庫裡本來就有的事實放回模型的視野。
  let latestExposure = null;
  try {
    latestExposure = await resolveLatestRecommendation(identity);
  } catch (err) {
    logger.warn(`查詢最近一次推薦失敗，本回合不提供 requestId：${err.message}`, { label: 'AgentCore' });
  }

  const systemInstruction = buildSystemPrompt(prefs, { latestExposure });
  logger.info(`組合 Prompt 中。System prompt 長度：${systemInstruction.length} 字元。`, { label: 'Context' });

  // `getChatHistory()` 已經是時序排好的 user／assistant 交替陣列，可以直接
  // 當成 Responses API 的 input items。先前這裡有一個 `contents.pop()`，等於
  // 每次都丟掉最近一則助理回覆——那是 Gemini `chats.create` 的 history 形狀
  // 限制留下的痕跡，在這裡只會弄壞對話連續性，因此不保留。
  const history = await getChatHistory(identity, 20);
  const input = [
    ...history.map(m => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: m.content || '',
    })),
    { role: 'user', content: message },
  ];

  const ctx = { identity, prefs, studentScope };
  let responseData = null;
  let detectedIntent = 'general_chat';
  let finalReply = '';

  // 耗盡步數時，模型沿途寫出來的內容不該被丟掉換成罐頭訊息。
  let lastAssistantText = '';

  try {
    const maxSteps = resolveMaxSteps();
    for (let step = 0; step < maxSteps; step++) {
      logger.trace(`傳送訊息至模型，步驟：${step}`, { label: 'LLM_Stream' });

      const response = await client.responses.create({
        model: getModel(),
        instructions: systemInstruction,
        input,
        tools: getAgentTools(),
        tool_choice: 'auto',
      });

      const output = response.output || [];
      // 推理項目也要放回 input。少了它，下一輪的模型看不到自己上一輪的推理，
      // 多步驟排課（查課 → 排課 → 記錄回饋）會退化成互不相干的單步呼叫。
      input.push(...output);

      const toolCalls = output.filter(item => item.type === 'function_call');
      const text = (response.output_text || '').trim();
      if (text) lastAssistantText = text;

      // 原生 tool calling 的自然終止：這一輪沒有工具呼叫，就是最後的回答。
      if (toolCalls.length === 0) {
        finalReply = text;
        break;
      }

      for (const call of toolCalls) {
        logger.info(`LLM 請求呼叫工具：\`${call.name}\``, { label: 'ToolCall' });

        const args = parseToolArguments(call.arguments);
        let result;
        if (args === null) {
          logger.error('工具參數不是合法 JSON', { label: 'AgentCore' });
          result = { error: '工具參數不是合法的 JSON 物件，請重新產生。' };
        } else {
          logger.debug('工具參數已解析（內容不記錄）', { label: 'ToolCall' });
          result = await executeAgentTool(call.name, args, ctx);
        }

        // `intent` 與 `data` 只反映**真正成功**的工具（見 `applyToolOutcome()`）。
        ({ intent: detectedIntent, data: responseData } =
          applyToolOutcome({ intent: detectedIntent, data: responseData }, call.name, result));

        // 前端拿完整結果渲染課表；模型只拿投影後的版本（見
        // `summarizeScheduleForModel()`：完整結果有 800KB+，會撐爆 context）。
        const modelResult = call.name === 'run_csp_scheduler' ? summarizeScheduleForModel(result) : result;
        const outputStr = JSON.stringify(modelResult);
        logger.info('工具執行完成', { label: 'ToolCall_Result', outputLength: outputStr.length });

        // 工具「被呼叫了」不等於「成功了」——驗證失敗時只是回一個 { error } 給模型，
        // 模型往往會自己換個說法圓過去，畫面上完全看不出來。這裡把錯誤留在伺服器
        // log（訊息是伺服器自己產生的固定文案，不含使用者輸入或工具結果內容），
        // 否則像 record_schedule_feedback 被拒這種事只會靜默地讓訊號消失。
        if (result && typeof result === 'object' && result.error) {
          logger.warn(`工具 ${call.name} 回報錯誤：${result.error}`, { label: 'ToolCall_Result' });
        }

        input.push({ type: 'function_call_output', call_id: call.call_id, output: outputStr });
      }
    }

    if (!finalReply) {
      // 走到這裡代表迴圈跑滿了步數卻沒有收到「沒有工具呼叫」的那一則訊息。
      // 這件事先前在伺服器端完全沒有痕跡，跟工具靜默失敗是同一類問題。
      logger.warn(`已達最大思考步數（${resolveMaxSteps()}），回覆可能不完整`, { label: 'AgentCore' });
      finalReply = lastAssistantText
        || '任務過於複雜，已達最大思考步數。請嘗試簡化您的需求。';
    }

    // 只有整次處理成功才原子保存 user/assistant 一對加密訊息。
    await saveChatExchange(identity, message, finalReply);

    return { reply: finalReply, intent: detectedIntent, data: responseData };
  } catch (error) {
    logger.error(`Agent 聊天發生錯誤：${error.message}`, { label: 'AgentCore' });
    const errReply = '很抱歉，處理您的請求時發生錯誤。請確認後端金鑰是否設定正確，或稍後再試。';
    return { reply: errReply, intent: 'error', data: null };
  }
}

export default { handleChat, executeAgentTool };
