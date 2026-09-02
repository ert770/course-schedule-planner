// Prompt builder + tool schema for the course recommendation AI Agent。
//
// **為什麼工具定義在這裡而不是 agentService**：`agentService` 負責「怎麼跟模型
// 對話、怎麼派工具」，這裡負責「模型看得到什麼」。兩者分開，contract 測試
// （`server/test/prompt.test.js`）才可以完全不碰網路就驗證模型被告知了哪些
// 參數——那正是這份測試存在的原因（曾經新增排課參數卻忘了同步 prompt，
// 個人化在 `/api/chat` 這條路徑上整個沒生效）。
//
// **格式歷史**：先前用的是文字 ReAct 協定——要求模型輸出 `[LLM_Thought]:` 與
// `[ToolCall]: {json}`，再用 regex 撈出來。那等於把「參數合法性」完全交給模型
// 的自律：它可以把 reason 填成 `太難`、把 requestId 亂編、把 JSON 寫壞。
// 現在改用 OpenAI 原生 tool calling，參數由下面的 JSON Schema 約束，
// enum 與必填欄位在 API 層就被擋下，不再是 prompt 裡的一句叮嚀。

// 把已儲存的興趣偏好攤平成一行，讓模型知道有哪些值可以帶進 run_csp_scheduler。
function formatList(...sources) {
  const values = sources
    .filter(Array.isArray)
    .flat()
    .filter(Boolean);

  return values.length > 0 ? [...new Set(values)].join('、') : '未設定';
}

const COURSE_CATEGORIES = ['必修', '核心選修', '一般選修', '通識', '系外選修'];

// #29 的七個回饋原因。**這是 enum 不是自由文字**：`time`（衝堂）、`full`
// （額滿）、`eligibility`（不符資格）對「課程內容偏好」是中性訊號，只有
// `content`／`workload`／`instructor` 才是真正的負回饋。混成一團的話，
// #30 會把「排不進去」學成「不喜歡」。
const FEEDBACK_REASONS = ['time', 'content', 'instructor', 'workload', 'full', 'eligibility', 'other'];

// `constraintSchema.js` 中僅有的三個 `relaxable: true` 項目。寫成常數是為了讓
// prompt 契約測試可以直接比對，避免這裡與 constraint schema 日後漂移。
const RELAXABLE_PREFERENCE_IDS = ['NO_MORNING_CLASSES', 'LUNCH_BREAK_FREE', 'NO_EVENING_CLASSES'];

const COURSE_ID_ARRAY = {
  type: 'array',
  items: { type: 'integer' },
};

// `run_csp_scheduler` 的參數表。
//
// 這裡**沒有**修課歷史、已修課號、重補修課號或課程評價，而且不是漏寫：
// 那些是伺服器自己從 profile 與資料庫推導的事實，不是模型可以提供的輸入。
// 開放給模型填，等於開一個讓它塞造假修課紀錄的入口（見 `constraintService.js`
// 對 `courseHistory` 與 `courseReviews` 直通不合併的說明）。
const SCHEDULER_PARAMETERS = {
  minCredits: { type: 'integer', description: '學分下限。校規下限 12（四年級 9）。' },
  maxCredits: { type: 'integer', description: '學分上限。校規上限 25，超修申請後 30。' },
  allowCreditOverload: { type: 'boolean', description: '使用者已申請超修時為 true。' },
  department: { type: 'string', description: '系所名稱。用於收斂必修範圍，未提及就不要填。' },
  gradeLevel: { type: 'integer', description: '年級。用於收斂必修範圍，未提及就不要填。' },

  blockedPeriods: {
    type: 'array',
    description: '不能上課的時段。',
    items: {
      type: 'object',
      properties: {
        day: { type: 'integer', description: '星期幾，1=週一 … 5=週五。' },
        period: { type: 'integer', description: '第幾節。' },
      },
      required: ['day', 'period'],
    },
  },
  mondayFree: { type: 'boolean', description: '週一整天不排課。' },
  noMorningClasses: { type: 'boolean', description: '不排早八。' },
  noEveningClasses: { type: 'boolean', description: '不排晚間時段。' },
  lunchBreakFree: { type: 'boolean', description: '午休時段不排課。' },

  mustTakeCourseIds: { ...COURSE_ID_ARRAY, description: '使用者指名一定要修的課程 id。' },
  selectedCourseIds: { ...COURSE_ID_ARRAY, description: '使用者目前「已選」的課程 id，會佔用時段並計入學分。' },
  watchingCourseIds: {
    ...COURSE_ID_ARRAY,
    description: '使用者「關注」的課程 id。只用於追蹤與比較，不計入學分，也不代表已排入課表。',
  },
  courseStates: {
    type: 'object',
    description: '課程 id 對應的當下選課狀態，僅在使用者明確說明時填寫。',
    additionalProperties: { type: 'string' },
  },

  preferCompact: { type: 'boolean', description: '偏好把課集中在少數幾天。' },
  maxCoursesPerDay: { type: 'integer', description: '每天最多幾門課。沒有校方依據，使用者沒說就不要填。' },

  noMidterm: { type: 'boolean', description: '偏好沒有期中考的課。' },
  noGroupReport: { type: 'boolean', description: '偏好沒有分組報告的課。' },
  discussion: { type: 'boolean', description: '偏好有討論的課。' },
  learnMore: { type: 'boolean', description: '偏好能學到較多東西的課。' },
  weightDaily: { type: 'boolean', description: '偏好平時成績占比高的課。' },
  practicalExam: { type: 'boolean', description: '偏好有實作考試的課。' },
  finalReport: { type: 'boolean', description: '偏好以期末報告評分的課。' },
  englishTaught: { type: 'boolean', description: '偏好英語授課。' },

  preferredTrack: { type: 'string', description: '修課路徑，例如「網路安全類」。' },
  preferredKeywords: {
    type: 'array',
    items: { type: 'string' },
    description: '使用者的興趣關鍵字，例如 ["網路","資安"]。',
  },
  interests: {
    type: 'array',
    items: { type: 'string' },
    description: '使用者的興趣領域，用途同 preferredKeywords。',
  },
  preferEasyCourses: { type: 'boolean', description: '使用者想要涼課或好拿高分的課時設為 true。' },
  digitalCreditsNeeded: { type: 'boolean', description: '使用者還需要數位學分時為 true。' },

  // Roadmap #24：把既有的放寬階梯接通。
  //
  // `allowRelaxation` 與 `tryRelaxationLadder()` 在 `constraintService.js` 與
  // `scheduler.js` 早就完整接好，但一直沒有出現在這份 schema 裡；而 schema 是
  // `additionalProperties: false`，模型送不進來的參數等於不存在——換句話說
  // **chat 這條路的放寬階梯是結構性死碼**。這也是 roadmap #24 點名的
  // 「絕對不上早八 vs 必要時可早八」至今無從實作的真正原因。
  allowRelaxation: {
    type: 'boolean',
    description: '排課排不出來時，是否允許引擎自動放寬早八／午休／晚課這類舒適偏好。'
      + '只有使用者表達了彈性（「盡量」「可以的話」「必要時可以」）才設為 true；'
      + '使用者說「絕對不」「無論如何都不要」時不要設或設為 false。',
  },
  nonNegotiablePreferenceIds: {
    type: 'array',
    items: { type: 'string', enum: RELAXABLE_PREFERENCE_IDS },
    description: '即使 allowRelaxation 為 true，這次也絕對不可被自動放寬的偏好。'
      + '用來表達使用者語氣特別強硬的那一項，例如「絕對不排早八，但午休可以彈性」'
      + '就填 ["NO_MORNING_CLASSES"]。只作用於這一次請求，不會變成永久設定。',
  },
};

// Roadmap #24 的「結構化需求模型」。
//
// 原生 tool calling 已經保證**參數格式**正確，但保證不了**理解正確**——模型把
// 「盡量不要早八」聽成「絕對不要」，參數一樣合法，使用者卻拿到不對的課表。
//
// **為什麼用代號而不是自由文字**：實測同一句話跑三次，模型對語意的判斷完全一致
// （`nonNegotiable` 三次都是同一個意思），但自由文字的寫法每次不同——
// 「午休時段可以彈性安排」／「可以彈性安排」／「可以彈性調整」。變異全部來自
// 「同一個意思有很多種寫法」，不是來自理解不穩。
//
// 把欄位改成固定代號，等於把輸出空間縮到每個意思只有一種寫法，同句重跑就能
// 得到逐位元相同的結構化結果。中文說明由伺服器依代號生成（`describeInterpretation()`），
// 使用者看到的仍然是人話。
//
// **不記錄、不持久化**：`sourcePhrases` 含使用者原話，#33 明訂 log 只記 metadata
// 不記內容。這個物件只出現在這一次請求的回應裡。
export const INTERPRETATION_TOPICS = Object.freeze({
  NO_MORNING_CLASSES: { label: '不排早八', flag: 'noMorningClasses' },
  NO_EVENING_CLASSES: { label: '不排晚間課', flag: 'noEveningClasses' },
  LUNCH_BREAK_FREE: { label: '午休不排課', flag: 'lunchBreakFree' },
  MONDAY_FREE: { label: '週一整天空堂', flag: 'mondayFree' },
  BLOCKED_PERIODS: { label: '指定的不能上課時段', flag: null },
  CREDIT_RANGE: { label: '學分範圍', flag: null },
  DAILY_COURSE_CAP: { label: '每天課程數上限', flag: null },
  MUST_TAKE_COURSES: { label: '指定一定要修的課', flag: null },
  PREFER_COMPACT: { label: '集中排課', flag: 'preferCompact' },
  PREFER_EASY: { label: '偏好涼課', flag: 'preferEasyCourses' },
  INTERESTS: { label: '興趣領域', flag: null },
  ENGLISH_TAUGHT: { label: '全英授課', flag: 'englishTaught' },
  NO_MIDTERM: { label: '沒有期中考', flag: 'noMidterm' },
  NO_GROUP_REPORT: { label: '沒有分組報告', flag: 'noGroupReport' },
  PRACTICAL_EXAM: { label: '上機實作考試', flag: 'practicalExam' },
  FINAL_REPORT: { label: '期末報告為主', flag: 'finalReport' },
  WEIGHT_DAILY: { label: '平時成績佔比高', flag: 'weightDaily' },
  DISCUSSION: { label: '課堂討論多', flag: 'discussion' },
  LEARN_MORE: { label: '學到較多知識', flag: 'learnMore' },
});

const INTERPRETATION_TOPIC_IDS = Object.keys(INTERPRETATION_TOPICS);

const TOPIC_ARRAY = {
  type: 'array',
  items: { type: 'string', enum: INTERPRETATION_TOPIC_IDS },
};

const INTERPRETATION_SCHEMA = {
  type: 'object',
  description: '你對使用者這次需求的理解。會顯示給使用者確認，也會被伺服器對照實際參數檢查。'
    + '**一律使用代號，不要自由發揮文字**——中文說明由系統依代號生成。',
  properties: {
    nonNegotiable: {
      ...TOPIC_ARRAY,
      description: '使用者語氣強硬、絕對不能違反的項目代號。'
        + '例如他說「絕對不要早八」就填 ["NO_MORNING_CLASSES"]。',
    },
    flexible: {
      ...TOPIC_ARRAY,
      description: '使用者表達過彈性、必要時可以退讓的項目代號。'
        + '例如「午休可以彈性」就填 ["LUNCH_BREAK_FREE"]。',
    },
    creditGoal: {
      type: 'object',
      description: '你對學分需求的理解。使用者沒有明講數字時兩個欄位都填 null，'
        + '**不要把偏好摘要裡的預設值抄進來**。',
      properties: {
        min: { type: ['integer', 'null'] },
        max: { type: ['integer', 'null'] },
      },
      required: ['min', 'max'],
      additionalProperties: false,
    },
    notMentioned: {
      ...TOPIC_ARRAY,
      description: '排課會用到、但使用者這次完全沒提到的項目代號。'
        + '**不要在這裡自行假設答案**，只是列出你沒有資訊的部分。',
    },
    sourcePhrases: {
      type: 'object',
      description: '項目代號對應到使用者的原話，例如 {"NO_MORNING_CLASSES":"絕對不要早八"}。'
        + '使用者沒有直接講到的項目就不要列。',
      additionalProperties: { type: 'string' },
    },
  },
  required: ['nonNegotiable', 'flexible', 'creditGoal', 'notMentioned'],
  additionalProperties: false,
};

/**
 * 把代號形式的理解回講轉成給人看的中文。
 *
 * 模型輸出穩定的代號、使用者看到人話——兩邊都要，所以轉換放伺服器端而不是
 * 讓模型自己寫中文。
 */
export function describeInterpretation(interpretation) {
  if (!interpretation || typeof interpretation !== 'object') return null;

  const toLabels = ids => (Array.isArray(ids) ? ids : [])
    .map(id => INTERPRETATION_TOPICS[id]?.label ?? id);

  const { min = null, max = null } = interpretation.creditGoal ?? {};
  const creditGoal = min == null && max == null
    ? '未指定（將沿用你已儲存的偏好）'
    : `${min ?? '不限'} ~ ${max ?? '不限'} 學分`;

  return {
    nonNegotiable: toLabels(interpretation.nonNegotiable),
    flexible: toLabels(interpretation.flexible),
    creditGoal,
    notMentioned: toLabels(interpretation.notMentioned),
  };
}

/**
 * OpenAI Responses API 的工具定義。
 *
 * **形狀**：Responses API 的工具是扁平的 `{ type, name, description, parameters }`，
 * 不像 Chat Completions 再包一層 `function`。這裡直接以最終形狀撰寫，不做轉接層。
 *
 * **沒有 final_answer**：原生 tool calling 的自然終止就是「模型回一則沒有
 * function_call 的訊息」。留一個 final_answer 工具是在跟 API 對打，
 * 而且會讓模型多繞一步、多一次出錯機會。
 */
export function getAgentTools() {
  return [
    {
      type: 'function',
      name: 'query_course_db',
      description:
        '依目前使用者的後端 profile 查詢課程資料。'
        + '通識領域以工具回傳的 generalEducationDomain 為準，不得由課號前綴猜測，也不得自行傳入班級。'
        + '若課程 eligibility 為 unknown，只能說「資格待確認」並附上 eligibilityReason，不得宣稱使用者確定可修。',
      parameters: {
        type: 'object',
        properties: {
          keyword: { type: 'string', description: '課程名稱或關鍵字。' },
          category: { type: 'string', enum: COURSE_CATEGORIES, description: '課程類別。' },
          dayOfWeek: { type: 'integer', description: '星期幾，1=週一 … 5=週五。' },
        },
        additionalProperties: false,
      },
    },
    {
      type: 'function',
      name: 'search_dcard_reviews',
      description: '查詢單一課程的評價摘要。沒有評價資料時會回傳 error，不可自行補一個評價。',
      parameters: {
        type: 'object',
        properties: {
          keyword: { type: 'string', description: '課程名稱或關鍵字。' },
        },
        required: ['keyword'],
        additionalProperties: false,
      },
    },
    {
      type: 'function',
      name: 'get_easy_courses',
      description:
        '查詢涼課或高分課程。排序依據是收縮後的 adjustedEasiness（樣本數少的課會被拉向全體平均），'
        + '不是未收縮的 easiness；向使用者說明時以 adjustedEasiness 為準。',
      parameters: {
        type: 'object',
        properties: {
          limit: { type: 'integer', description: '回傳筆數，預設 10。' },
        },
        additionalProperties: false,
      },
    },
    {
      type: 'function',
      name: 'update_preferences',
      description:
        '更新使用者長期偏好。只在使用者明確表達要「以後都這樣」時呼叫，'
        + '單次排課條件請直接帶進 run_csp_scheduler。'
        + '**兩段式**：不帶 confirmationToken 呼叫時只會提出變更、不會寫入，'
        + '你必須把回傳的 proposedChanges 講給使用者確認；'
        + '取得明確同意後，帶著回傳的 confirmationToken 再呼叫一次才會真的生效。',
      parameters: {
        type: 'object',
        properties: {
          noMorningClasses: { type: 'boolean' },
          noEveningClasses: { type: 'boolean' },
          preferCompact: { type: 'boolean' },
          targetCreditsMin: { type: 'integer' },
          targetCreditsMax: { type: 'integer' },
          blockedPeriods: SCHEDULER_PARAMETERS.blockedPeriods,
          confirmationToken: {
            type: 'string',
            description: '上一次呼叫回傳的 token。使用者確認後才帶，不可自行編造。',
          },
        },
        additionalProperties: false,
      },
    },
    {
      type: 'function',
      name: 'update_student_profile',
      description:
        '更正使用者的系所、年級、班別或入學年度（例如使用者說「我是資工系」「其實我三年級」'
        + '「我是 112 學年度入學的」）。這些欄位決定哪些課算他的必修、哪些課他可以修、'
        + '以及套用哪一版畢業規則，答錯會讓整份推薦失準，'
        + '因此與 update_preferences 一樣是兩段式：先不帶 confirmationToken 提出變更，'
        + '講給使用者確認後，再帶 token 呼叫一次才生效。'
        + '生效後同一次對話後續的課程查詢會立即改用新的範圍。'
        // 每個欄位都是選填。少了這句，實測模型會為了湊滿欄位而先追問入學年度，
        // 使用者明明已經講了系所／年級／班別卻等不到更正（A/B：加上 admissionYear
        // 欄位後 3/3 不呼叫工具，移除後 3/3 正常呼叫）。
        + '**四個欄位都是選填，只填使用者這次真的講到的。'
        + '沒講到的欄位直接省略，不要為了把欄位填滿而追問**——'
        + '尤其入學年度幾乎沒有人會主動提，缺它完全不影響其他欄位的更正。',
      parameters: {
        type: 'object',
        properties: {
          department: { type: 'string', description: '系所全名，例如「資訊工程學系」。' },
          gradeLevel: { type: 'integer', description: '年級，1~7。' },
          className: { type: 'string', description: '班別，例如「資訊三甲」。' },
          admissionYear: {
            type: 'integer',
            description:
              '入學學年度（民國），例如 112。只有使用者明確說出來時才填，'
              + '不要從年級自行推算——推算值與使用者說的值一旦混在一起就分不出可信度。',
          },
          confirmationToken: {
            type: 'string',
            description: '上一次呼叫回傳的 token。使用者確認後才帶，不可自行編造。',
          },
        },
        additionalProperties: false,
      },
    },
    {
      type: 'function',
      name: 'run_csp_scheduler',
      description:
        '產生推薦課表。使用者若表達了興趣、想集中排課或想修涼課，必須把對應參數帶進來，'
        + '否則系統只能改用總學分挑選方案，推薦會失去個人化。'
        + '呼叫時必須一併附上 interpretation，把你對使用者需求的理解攤開來；'
        + '伺服器會檢查它與實際參數是否一致，對不上會被退回。',
      parameters: {
        type: 'object',
        properties: { ...SCHEDULER_PARAMETERS, interpretation: INTERPRETATION_SCHEMA },
        required: ['interpretation'],
        additionalProperties: false,
      },
    },
    {
      type: 'function',
      name: 'record_schedule_feedback',
      description:
        '記錄使用者對已產生課表的最終評價（roadmap #2）。'
        + '只有在使用者**實際回答過**這份課表是否符合需求之後才可呼叫，不得代替使用者回答。'
        + '呼叫時 accepted 必須為 true，或 rejectedCourses 至少有一筆——'
        + '兩者皆空的呼叫沒有記錄到任何東西，會被拒絕。'
        + 'draftSchedule 是供討論的草稿，不可用這個工具把草稿記成已接受的方案。',
      parameters: {
        type: 'object',
        properties: {
          requestId: {
            type: 'string',
            description:
              '上一次 run_csp_scheduler 回傳的 requestId。後端會對照該次推薦實際顯示的紀錄驗證；'
              + '自行編造或使用舊的 requestId 一律被拒絕。',
          },
          accepted: { type: 'boolean', description: '使用者表示這份課表符合需求時為 true。' },
          planId: {
            type: 'string',
            description: '可省略。省略時後端自動使用該次實際顯示的方案；有填就必須與它一致。',
          },
          rejectedCourses: {
            type: 'array',
            description:
              '使用者指出不適合的課。sectionId 必須是該次推薦**實際排進課表**的課，'
              + '不可以是搜尋結果或其他學期的課。',
            items: {
              type: 'object',
              properties: {
                sectionId: { type: 'integer' },
                reason: {
                  type: 'string',
                  enum: FEEDBACK_REASONS,
                  description: '使用者沒有說明原因時填 other，不要自行猜測理由。',
                },
              },
              required: ['sectionId', 'reason'],
            },
          },
        },
        required: ['requestId'],
        additionalProperties: false,
      },
    },
  ];
}

export function buildSystemPrompt(userPrefs = {}, context = {}) {
  // 最近一次推薦的 requestId 與課程 sectionId 由伺服器提供。
  //
  // 模型看不到上一輪的 tool 結果——`saveChatExchange()` 只保存使用者訊息與最終
  // 文字回覆——所以下一回合它手上既沒有合法的 requestId，也沒有課程 sectionId，
  // 只記得自己寫過的課名。少了這一段，`record_schedule_feedback` 實際上永遠
  // 呼叫不成功：Agent 問了「這份課表符合需求嗎」，使用者答了，訊號卻無處可記。
  // 待確認的變更：與「最近一次推薦」同一個理由——工具結果不跨回合保存，
  // 模型下一回合不會記得自己拿過的 confirmationToken，伺服器必須交還給它。
  const pendingChanges = context.pendingChanges ?? [];
  const pendingBlock = pendingChanges.length > 0
    ? [
      '',
      '待使用者確認的變更（尚未寫入任何東西）：',
      ...pendingChanges.flatMap(item => [
        `- ${item.changeType}：${JSON.stringify(item.changes)}`,
        `  使用者若已在最新一則訊息同意，就帶 confirmationToken「${item.token}」`
          + '再呼叫一次對應的工具完成寫入；他還沒回答或表示不要時，不要帶 token。',
      ]),
    ].join('\n')
    : '';

  const latest = context.latestExposure;
  const displayed = latest?.displayedSet ?? [];
  const latestRecommendation = latest?.requestId
    ? [
      '',
      '最近一次推薦（使用者目前看到的那一份課表）：',
      `- requestId：${latest.requestId}`,
      `- planId：${latest.planId ?? '（未指定，可省略）'}`,
      ...(displayed.length > 0
        ? [
          '- 這份課表包含的課，record_schedule_feedback 的 sectionId 只能從這裡挑：',
          ...displayed.map(course => (
            `  - sectionId ${course.sectionId}：${course.name ?? course.catalogCourseCode}`
          )),
        ]
        : []),
      '- 使用者對這份課表的回饋一律用上面的 requestId 與 sectionId 呼叫'
        + ' record_schedule_feedback，不要自行編造，也不要說找不到識別資料。',
    ].join('\n')
    : '\n最近一次推薦：目前沒有推薦紀錄，尚不可呼叫 record_schedule_feedback。';

  return `你是「課程推薦系統」的 AI Agent，負責協助學生查詢課程、理解偏好，並在資料足夠時呼叫工具產生課表。

工作原則：
1. 不要編造課程、教師、時間、學分、評價或畢業規則。
2. 課程資料不足時，先說明缺少哪些資料，再用工具查詢或請使用者補充。
3. 「關注」課程只用來追蹤，不可計入學分，也不可拿來判斷已排入課表。
4. 「已選」或必修、重補修課程才可以進入正式課表。
5. 遇到衝堂、學分不足、學分超過上限或硬性條件無法滿足時，要明確說明原因。
6. 回答語氣保持清楚、務實、簡短，避免保證一定能畢業或一定搶得到課。

工具使用方式：
- 需要資料或要產生課表時，直接呼叫對應的工具；每個工具的參數說明寫在工具定義裡，以那份定義為準。
- 工具回傳結果之後，若已足以回答，就直接用一般文字回覆使用者，不需要再呼叫任何工具。
- 不要把工具回傳的原始 JSON 貼給使用者，要用中文說明重點。
- 每個工具的結果都包在同一種信封裡：\`{ schemaVersion, dataSource, term, warnings, errorCode, result }\`，
  實際內容一律在 \`result\` 欄位（陣列或物件都一樣，不必先判斷形狀）。\`dataSource\` 為
  \`json-fallback\` 時代表資料庫暫時不可用，回答時要說明這是暫時性限制，不要說成資料真的不存在。
  \`warnings\` 有內容時要在回覆裡提到。\`errorCode\` 不為 \`null\` 時代表這次呼叫沒有成功，
  依 \`result.error\` 的文字向使用者說明，不要宣稱已完成。

排課偏好使用說明：
- preferredKeywords、interests、preferCompact、preferEasyCourses 會決定多個課表方案中要主推哪一個。
- 排課結果的每個方案都有 preferenceScore（0~1 的偏好符合度），可用來向使用者說明為什麼主推該方案。
- 若回傳 hasExpressedPreference 為 false，代表沒有收到任何偏好，應主動詢問使用者的興趣或偏好。

永久變更前必須先取得使用者確認（必做）：
- update_preferences 與 update_student_profile 都是**兩段式**。第一次呼叫（不帶
  confirmationToken）只會提出變更，不會寫入任何東西，回傳裡會有 proposedChanges
  與 confirmationToken。
- 拿到之後，你必須用中文把「要改成什麼」講清楚並詢問使用者，等他明確同意
  （「好」「確認」「對」）之後，才帶著那個 confirmationToken 再呼叫一次。
- 使用者沒有明確同意就不要帶 token 呼叫第二次；也不得自行編造 token。
- 使用者說「這次就這樣」而不是「以後都這樣」時，不要呼叫 update_preferences，
  直接把條件帶進 run_csp_scheduler 就好。

排課前的理解回講（必做）：
- 呼叫 run_csp_scheduler 時必須附上 interpretation，把你的理解攤開來：
  哪些是使用者語氣強硬、絕對不能違反的；哪些是他表達過彈性的；學分怎麼理解；
  以及**他這次完全沒提到的項目**。
- notMentioned 只列「你沒有資訊的部分」，**不要在那裡自行假設答案**。
- interpretation 的三個清單一律填代號，不要自由發揮文字——中文說明由系統生成。
- 使用者沒有明講學分數字時，creditGoal 的 min 與 max 都填 null，
  **也不要把 minCredits／maxCredits 帶進排課參數**——已儲存的偏好由伺服器自己套用，
  你把它抄一遍只會讓同一句話每次產生不同的參數。
- interpretation 必須與實際參數一致。你在 nonNegotiable 說「絕對不排早八」，
  就必須同時把 noMorningClasses 設為 true 並把 NO_MORNING_CLASSES 放進
  nonNegotiablePreferenceIds；對不上會被伺服器退回要求你修正。
- 排課後給使用者的文字回覆裡，要用一小段把這份理解講出來，並明說沒提到的項目
  你沒有替他決定。

偏好強度的判讀：
- 使用者語氣有彈性（「盡量不要」「可以的話」「必要時可以」）時，把
  allowRelaxation 設為 true，排不出來時引擎才可以自動放寬早八／午休／晚課。
- 使用者語氣強硬（「絕對不要」「無論如何都不行」）時，**整個省略 allowRelaxation
  這個參數，不要送 allowRelaxation: false**——false 本來就是預設值，多送一次不會改變
  任何行為，只會讓同一句話每次產生不同的參數（與上面 minCredits／maxCredits 同理）。
  改用 nonNegotiablePreferenceIds 指名該項，確保它不會被自動放寬。
- 兩種語氣混在一句話裡時分開處理，例如「絕對不排早八，但午休可以彈性」應該是
  allowRelaxation: true 加上 nonNegotiablePreferenceIds: ["NO_MORNING_CLASSES"]。
- 不要把使用者沒表達過的彈性自行補上——沒說可以放寬就是不可以。

排課後的確認（必做）：
- run_csp_scheduler 成功後，你給使用者的那則回覆**必須**在說明課表之後，詢問這份課表是否符合需求，
  並告訴使用者若有不適合的課，請說出是哪一門以及原因（時間、內容、教師、負擔、額滿、資格）。
- 排課只是推薦，使用者是否覺得符合需求才是最終選擇。沒有問，系統就無從得知這份推薦到底好不好。
- 使用者一旦說出「這份可以」或「哪一門不適合」，**那一回合的第一個工具呼叫必須是
  record_schedule_feedback**，記錄完成之後才可以重新排課、追問或回覆。這個訊號沒有
  第二次機會，漏記就永久遺失。
- 記錄時 requestId 用下方「最近一次推薦」給的值，rejectedCourses 的 sectionId 只能是
  **那一份課表裡的課**（也就是使用者實際看過的那一份）。不要先重新排課再拿新課表的
  sectionId 去記錄——那些課使用者根本還沒看過，後端會拒絕。
- 使用者說某門課不適合但沒講明原因時，reason 填 other；講了時間衝突就填 time，
  依此類推，不要因為「還要再問細節」而跳過記錄。
- 使用者沒有回答時，不得自行假設他接受了這份課表。

排課修復與澄清（Roadmap #22）：
- 排課結果的 solver.status 只可解讀為 solved、infeasible、timeout、data-insufficient；timeout 不等於無解。
- 若 clarification.required 為 true，必須優先依 clarification.questions 詢問使用者具體條件，包含一定要修的課程或班次、期望學分、不能上課的日期與節次，以及衝突課程要保留哪一門。
- 問題只能轉述 clarification.questions、unmetRequirements 與 conflictSet 中存在的證據，不得自行發明衝突或假設使用者願意放寬限制。
- draftSchedule 是供討論的草稿，不能稱為成功或合法完成的課表，也不能呼叫 record_schedule_feedback 把草稿記成已接受方案。
- 只能詢問或調整 clarification.adjustableConstraintIds 所列的限制；不得建議違反衝堂、重複班次、學分硬上限或 blockedPeriods。
- 使用者回答後，把他明確提供的新條件帶入下一次 run_csp_scheduler；沒有回答的欄位不得代填。

評價證據使用說明：
- 排課結果每門課帶 reviewEvidence（來自 Course_Reviews 的評價統計）；為 null 代表這門課沒有評價。
- reviewEvidence 為 null 時，不得宣稱這門課「涼」「好拿分」「甜」——沒有評價就是沒有依據，只能說「這門課沒有評價資料」。
- 方案的 preferenceBreakdown.easy 可能為 null（代表排入的課全部沒有評價可評分），請改讀該方案的 reviewCoverage（rated/total/ratio）向使用者說明證據有多少，不要把 null 講成 0%。
- 若回傳 reviewDataLoaded 為 false，代表本次排課完全沒有取得評價資料，涼度是以中性值計算，應照實告知使用者，不可宣稱已依評價排序。

內容偏好使用說明：
- noMidterm、noGroupReport、discussion、weightDaily、practicalExam、finalReport、englishTaught、learnMore 是軟性偏好，判定依據是課程描述的關鍵字比對，不保證真的滿足——關鍵字沒出現在描述裡不代表課程真的沒有這個特徵。
- 不得因為使用者設定了 noMidterm 就宣稱「已排除所有有期中考的課」，只能說「已依這個偏好調整排序」。
- 若 warnings 出現「訊號極弱」或「無法有效區分課程」字樣，代表這個偏好在候選課程中的關鍵字命中率過低或過高，必須照實轉達給使用者，不得省略。

課程資格說明：
- 課程的 eligibility 為 unknown 時只能說「資格待確認」並附上 eligibilityReason，不得宣稱使用者確定可修。

目前使用者偏好（不含可直接識別身分的欄位）：
- 目標學分：${userPrefs.targetCreditsMin || 12} ~ ${userPrefs.targetCreditsMax || 25}
- 不排早八：${userPrefs.noMorningClasses ? '是' : '否'}
- 不排晚間：${userPrefs.noEveningClasses ? '是' : '否'}
- 偏好集中排課：${userPrefs.preferCompact ? '是' : '否'}
- 偏好涼課：${(userPrefs.preferEasyCourses ?? userPrefs.preferEasy) ? '是' : '否'}
- 興趣關鍵字：${formatList(userPrefs.preferredKeywords, userPrefs.interests, userPrefs.preferenceTags)}
- 修課路徑：${userPrefs.preferredTrack || '未設定'}${latestRecommendation}${pendingBlock}`;
}
