// 課程主題問答 v1 的預設題庫文案（ADR-027）。
//
// 來源是《課程主題問答 v1：題目與 LLM 規格》第 2、3 節（Codex 設計、使用者 2026-11-22 確認）。
// 選項由後端從這位學生的候選池選好；這裡只決定**怎麼說**。有預設文案的方向不呼叫語言模型，
// 沒有的才交給語言模型改寫，失敗時退回目錄名稱（見 `interestQuestionnaireService.js`）。
//
// 方向以**目錄名稱**對應（子類別、大類別，或策畫選項 `curated_ai` 的名稱「人工智慧」）。併過的本系選項
// 用內容命名，對應時也比對它的成員目錄名稱（`catalogNames`）。

/** 各組的題幹。stage=group 一律用這裡的題幹，不讓語言模型改寫。 */
export const GROUP_QUESTIONS = Object.freeze({
  department: '如果下學期多修一門本系選修，你想深入哪些方向？',
  generalEducation: '你想用通識課多了解哪些事情？',
  outside: '如果選一門非理工學院的課，你想接觸哪些方向？',
});

/**
 * 預設方向文案，依規格表的欄位順序排列。排在越前面，首批出題越優先：
 * 候選池裡有的方向先出，沒有的就由同組其他有課的方向補上。
 */
export const DEFAULT_DIRECTION_COPY = Object.freeze({
  department: Object.freeze([
    { name: '人工智慧', title: '讓電腦從資料中學習', description: '了解模型怎麼辨識圖像、理解文字或做預測。' },
    { name: '程式、系統與資料', title: '做出能實際使用的軟體', description: '了解怎麼把需求變成程式、應用或系統。' },
    { name: '資訊安全與隱私', title: '找出系統弱點、保護資料', description: '了解攻擊怎麼發生，以及如何防護。' },
  ]),
  generalEducation: Object.freeze([
    { name: '社會科學與公共事務', title: '科技如何改變社會', description: '討論科技對生活、制度與公共議題的影響。' },
    { name: '人文、歷史與哲學', title: '用歷史和思想理解現在', description: '比較不同時代、文化與價值觀。' },
    { name: '環境與永續', title: '從生活理解環境議題', description: '了解消費、能源或氣候與日常生活的關係。' },
  ]),
  outside: Object.freeze([
    { name: '語言、文學與溝通', title: '學外語或了解不同文化', description: '接觸新的語言，或了解不同文化的溝通方式。' },
    { name: '商業與管理', title: '了解品牌與消費者', description: '看看市場怎麼運作，以及人們為什麼選擇某個產品。' },
    { name: '藝術、設計與媒體', title: '用影像或設計表達想法', description: '了解視覺、影像或媒體如何傳達訊息。' },
  ]),
});

/**
 * 細項頁的題幹（每組一頁，涵蓋這組所有已選方向）。
 *
 * 2026-11-22 起細項頁一次列出這組所有方向（三層沙漏的中、小層），不再針對單一方向出題，所以改成一句共用題幹。
 * 規格第 3 節原本依方向給的題幹（「如果先從一種 AI 應用開始…」「你想先了解哪些資安主題？」）不再使用；
 * 「語言、文學與溝通」的「你想先接觸哪些語言？」更早已因選項不是語種而拿掉。
 */
export const DETAIL_QUESTION = '你想先接觸哪些主題？點有興趣的群展開，可複選，也可以略過。';

export default { GROUP_QUESTIONS, DEFAULT_DIRECTION_COPY, DETAIL_QUESTION };
