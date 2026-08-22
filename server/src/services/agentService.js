import { GoogleGenAI } from '@google/genai';
import { buildSystemPrompt } from './promptService.js';
import { getUserPreferences, updateUserPreferences } from './memoryService.js';
import { getChatHistory, saveChatExchange } from './privacyService.js';
import { searchCoursesForAgent, getCourseDetail } from '../skills/courseQuery.js';
import { getEasyCourses, getSentimentSummary, searchReviews } from '../skills/reviewSearch.js';
import { generateForUser } from './scheduleService.js';
import { logger } from '../utils/logger.js';
import { buildStudentScope } from '../skills/courseScope.js';

let ai = null;

function getAIClient() {
  if (!ai && process.env.GEMINI_API_KEY) {
    ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  }
  return ai;
}

// `identity` 為 `resolveIdentity()` 的結果，不是原始 userId。
// 聊天記憶與偏好更新都以 canonical ID（學號）為鍵，避免同一位學生的對話
// 依前端送的是學號還是 numeric id 而分裂成兩份。
export async function handleChat(identity, message) {
  logger.info('收到已驗證的聊天請求', { label: 'AgentCore', messageLength: message.length });

  // 2. 初始化 API
  const client = getAIClient();
  if (!client) {
    const errorMsg = '系統發生錯誤：伺服器未設定 GEMINI_API_KEY。';
    logger.error('遺失 GEMINI_API_KEY', { label: 'AgentCore' });
    return { reply: errorMsg, intent: 'error', data: null };
  }

  // 3. 取得偏好與歷史紀錄
  const prefs = await getUserPreferences(identity);
  const studentScope = buildStudentScope(prefs);
  logger.debug('已載入使用者限制條件（內容不記錄）', { label: 'Memory' });
  
  const systemInstruction = buildSystemPrompt(prefs);
  logger.info(`組合 Prompt 中。System prompt 長度：${systemInstruction.length} 字元。`, { label: 'Context' });

  // 整理 Gemini 需要的歷史紀錄格式
  const rawHistory = await getChatHistory(identity, 20);
  const contents = rawHistory.map(m => ({
    role: m.role === 'assistant' ? 'model' : m.role,
    parts: [{ text: m.content || '' }]
  }));
  contents.pop(); 
  
  let responseData = null;
  let detectedIntent = 'general_chat';

  try {
    // 建立對話 Session
    let chat = client.chats.create({
      model: 'gemini-2.5-pro',
      config: {
        systemInstruction,
        temperature: 0.1,
      },
      history: contents
    });

    let currentMessage = message;
    let finalReply = '';

    // Agent ReAct Loop
    const MAX_STEPS = 8;
    for (let step = 0; step < MAX_STEPS; step++) {
      logger.trace(`傳送訊息至模型，步驟：${step}`, { label: 'LLM_Stream' });
      const response = await chat.sendMessage({ message: currentMessage });
      const responseText = response.text || '';
      
      // Parse [LLM_Thought] and [ToolCall]
      const thoughtMatch = responseText.match(/\[LLM_Thought\]:\s*([\s\S]*?)(?:\[ToolCall\]|$)/);
      const toolCallMatch = responseText.match(/\[ToolCall\]:\s*(\{[\s\S]*\})/);

      if (thoughtMatch) {
        logger.trace('模型回傳內部推理區塊（內容不記錄）', { label: 'LLM_Stream' });
      }

      if (toolCallMatch) {
        try {
          const callData = JSON.parse(toolCallMatch[1]);
          const fnName = callData.tool;
          const args = callData.parameters || {};
          detectedIntent = fnName;
          
          logger.info(`LLM 請求呼叫工具：\`${fnName}\``, { label: 'ToolCall' });
          logger.debug('工具參數已解析（內容不記錄）', { label: 'ToolCall' });

          if (fnName === 'final_answer') {
             finalReply = args.reply_text || "排課任務已完成。";
             break;
          }

          let result;
          logger.warn(`正在查詢工具 ${fnName}...`, { label: 'Skill_Execution' });
          
          try {
            switch (fnName) {
              case 'query_course_db':
                result = await searchCoursesForAgent(args, studentScope);
                if (result.length > 10) result = result.slice(0, 10);
                responseData = result;
                break;
                
              case 'search_dcard_reviews': {
                const courses = await searchCoursesForAgent({ keyword: args.keyword }, studentScope);
                if (courses.length > 0) {
                  result = { ...(await getSentimentSummary(courses[0].id)), courseName: courses[0].name };
                } else {
                  result = { error: '找不到該課程的評價' };
                }
                responseData = result;
                break;
              }

              case 'run_csp_scheduler': {
                // 與 `POST /api/schedule/generate` **走同一條路徑**。
                // Chat 只是讓使用者用自然語言表達需求與條件的介面，不是另一套排課實作；
                // 先前這裡自己組一份，只要 REST 那條加了前置條件就會靜默落後。
                result = await generateForUser(identity, { constraints: args }, { prefs });
                responseData = result;
                break;
              }

              case 'get_easy_courses':
                result = await getEasyCourses(args.limit || 10);
                responseData = result;
                break;

              case 'update_preferences':
                await updateUserPreferences(identity, args);
                result = { success: true, updatedFields: args };
                Object.assign(prefs, args);
                break;

              default:
                result = { error: `不明的函數呼叫: ${fnName}` };
            }
          } catch (e) {
             result = { error: `執行工具發生錯誤: ${e.message}` };
          }
          
          const outputStr = JSON.stringify(result);
          logger.info('工具執行完成', { label: 'ToolCall_Result', outputLength: outputStr.length });

          // Format next message as Observation
          currentMessage = `[Observation]:\n${outputStr}`;
          
        } catch (parseError) {
          logger.error(`無法解析 ToolCall JSON：${parseError.message}`, { label: 'AgentCore' });
          currentMessage = `[Observation]:\n{"error": "JSON parse error, make sure ToolCall is valid JSON."}`;
        }
      } else {
        // If there is no [ToolCall] but there's a response, treat it as final reply
        finalReply = responseText.replace(/\[LLM_Thought\]:[\s\S]*$/, '').trim() || responseText;
        break;
      }
    }

    if (!finalReply) {
      finalReply = "任務過於複雜，已達最大思考步數。請嘗試簡化您的需求。";
    }

    // 只有整次處理成功才原子保存 user/assistant 一對加密訊息。
    await saveChatExchange(identity, message, finalReply);

    return {
      reply: finalReply,
      intent: detectedIntent,
      data: responseData
    };

  } catch (error) {
    logger.error(`Agent 聊天發生錯誤：${error.message}`, { label: 'AgentCore' });
    const errReply = '很抱歉，處理您的請求時發生錯誤。請確認後端金鑰是否設定正確，或稍後再試。';
    return {
      reply: errReply,
      intent: 'error',
      data: null
    };
  }
}

export default { handleChat };
