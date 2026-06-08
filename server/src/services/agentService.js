import { GoogleGenAI } from '@google/genai';
import { buildSystemPrompt } from './promptService.js';
import { getChatHistory, addChatMessage, getUserPreferences, updateUserPreferences } from './memoryService.js';
import { searchCourses, getCourseDetail } from '../skills/courseQuery.js';
import { getEasyCourses, getSentimentSummary, searchReviews } from '../skills/reviewSearch.js';
import { generateSchedule } from '../skills/scheduler.js';
import { getAll } from '../db/database.js';
import { logger } from '../utils/logger.js';

let ai = null;

function getAIClient() {
  if (!ai && process.env.GEMINI_API_KEY) {
    ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  }
  return ai;
}

export async function handleChat(userId, message) {
  logger.info(`收到使用者輸入："${message}"`, { label: 'AgentCore' });
  
  // 1. 記錄使用者訊息
  addChatMessage(userId, 'user', message);

  // 2. 初始化 API
  const client = getAIClient();
  if (!client) {
    const errorMsg = '系統發生錯誤：伺服器未設定 GEMINI_API_KEY。';
    logger.error('遺失 GEMINI_API_KEY', { label: 'AgentCore' });
    addChatMessage(userId, 'assistant', errorMsg);
    return { reply: errorMsg, intent: 'error', data: null };
  }

  // 3. 取得偏好與歷史紀錄
  const prefs = getUserPreferences(userId);
  logger.debug(`已載入使用者限制條件：${JSON.stringify(prefs)}`, { label: 'Memory' });
  
  const systemInstruction = buildSystemPrompt(prefs);
  logger.info(`組合 Prompt 中。System prompt 長度：${systemInstruction.length} 字元。`, { label: 'Context' });

  // 整理 Gemini 需要的歷史紀錄格式
  const rawHistory = getChatHistory(userId, 20);
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
        logger.trace(`\n[LLM_Thought]:\n${thoughtMatch[1].trim()}`, { label: 'LLM_Stream' });
      }

      if (toolCallMatch) {
        try {
          const callData = JSON.parse(toolCallMatch[1]);
          const fnName = callData.tool;
          const args = callData.parameters || {};
          detectedIntent = fnName;
          
          logger.info(`LLM 請求呼叫工具：\`${fnName}\``, { label: 'ToolCall' });
          logger.debug(`參數：${JSON.stringify(args)}`, { label: 'ToolCall' });

          if (fnName === 'final_answer') {
             finalReply = args.reply_text || "排課任務已完成。";
             break;
          }

          let result;
          logger.warn(`正在查詢工具 ${fnName}...`, { label: 'Skill_Execution' });
          
          try {
            switch (fnName) {
              case 'query_course_db':
                result = searchCourses(args);
                if (result.length > 10) result = result.slice(0, 10);
                responseData = result;
                break;
                
              case 'search_dcard_reviews': {
                const courses = searchCourses({ keyword: args.keyword });
                if (courses.length > 0) {
                  result = { ...getSentimentSummary(courses[0].id), courseName: courses[0].name };
                } else {
                  result = { error: '找不到該課程的評價' };
                }
                responseData = result;
                break;
              }

              case 'run_csp_scheduler': {
                const constraints = {
                  maxCredits: args.maxCredits || prefs.targetCreditsMax || 22,
                  minCredits: args.minCredits || prefs.targetCreditsMin || 15,
                  blockedPeriods: prefs.blockedPeriods || [],
                  noMorningClasses: args.noMorningClasses !== undefined ? args.noMorningClasses : prefs.noMorningClasses,
                  noEveningClasses: args.noEveningClasses !== undefined ? args.noEveningClasses : prefs.noEveningClasses,
                  mustTakeCourseIds: prefs.mustTakeCourses || [],
                  preferCompact: args.preferCompact !== undefined ? args.preferCompact : prefs.preferCompact,
                };
                let candidates = getAll('courses');
                result = generateSchedule(candidates, constraints);
                responseData = result;
                break;
              }

              case 'get_easy_courses':
                result = getEasyCourses(args.limit || 10);
                responseData = result;
                break;

              case 'update_preferences':
                updateUserPreferences(userId, args);
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
          logger.info(`執行結束代碼：0。\n輸出結果：${outputStr.substring(0, 100)}${outputStr.length > 100 ? '...' : ''}`, { label: 'ToolCall_Result' });

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

    addChatMessage(userId, 'assistant', finalReply);

    return {
      reply: finalReply,
      intent: detectedIntent,
      data: responseData
    };

  } catch (error) {
    logger.error(`Agent 聊天發生錯誤：${error.message}`, { label: 'AgentCore' });
    const errReply = '很抱歉，處理您的請求時發生錯誤。請確認後端金鑰是否設定正確，或稍後再試。';
    addChatMessage(userId, 'assistant', errReply);
    return {
      reply: errReply,
      intent: 'error',
      data: null
    };
  }
}

export default { handleChat };
