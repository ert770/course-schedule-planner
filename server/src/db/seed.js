import { clearCollection, insert } from './database.js';

function seed() {
  // Clear existing data
  clearCollection('courses');
  clearCollection('reviews');
  clearCollection('user_preferences');
  clearCollection('chat_history');
  clearCollection('saved_schedules');

  // ============================================================
  // 課程種子資料 — 模擬某大學 55 門課程
  // ============================================================
  const courses = [
    // === 資工系必修 ===
    { name: '程式設計(一)', code: 'CS101', instructor: '王大明', department: '資訊工程學系', credits: 3, dayOfWeek: 1, startPeriod: 2, endPeriod: 4, location: '資工館 101', capacity: 60, category: '必修', description: '學習 Python/C 基礎程式設計，涵蓋變數、迴圈、函數、物件導向等概念。' },
    { name: '資料結構', code: 'CS201', instructor: '林志偉', department: '資訊工程學系', credits: 3, dayOfWeek: 2, startPeriod: 3, endPeriod: 5, location: '資工館 201', capacity: 55, category: '必修', description: '陣列、鏈結串列、堆疊、佇列、樹、圖等資料結構之設計與實作。' },
    { name: '演算法設計與分析', code: 'CS301', instructor: '陳建宏', department: '資訊工程學系', credits: 3, dayOfWeek: 3, startPeriod: 2, endPeriod: 4, location: '資工館 301', capacity: 50, category: '必修', description: '排序、搜尋、動態規劃、貪心演算法、圖論演算法等。' },
    { name: '計算機組織', code: 'CS202', instructor: '張文雯', department: '資訊工程學系', credits: 3, dayOfWeek: 4, startPeriod: 3, endPeriod: 5, location: '資工館 102', capacity: 55, category: '必修', description: '計算機硬體架構、指令集、管線化、記憶體階層。' },
    { name: '作業系統', code: 'CS302', instructor: '李秀芳', department: '資訊工程學系', credits: 3, dayOfWeek: 5, startPeriod: 2, endPeriod: 4, location: '資工館 202', capacity: 50, category: '必修', description: '行程管理、記憶體管理、檔案系統、排程演算法。' },
    { name: '離散數學', code: 'CS102', instructor: '黃國華', department: '資訊工程學系', credits: 3, dayOfWeek: 1, startPeriod: 6, endPeriod: 8, location: '資工館 103', capacity: 60, category: '必修', description: '集合論、圖論、組合學、數論基礎。' },
    { name: '線性代數', code: 'MATH201', instructor: '周美玲', department: '數學系', credits: 3, dayOfWeek: 2, startPeriod: 6, endPeriod: 8, location: '理學院 201', capacity: 65, category: '必修', description: '向量空間、矩陣運算、線性變換、特徵值與特徵向量。' },
    { name: '機率與統計', code: 'MATH301', instructor: '吳宗翰', department: '數學系', credits: 3, dayOfWeek: 3, startPeriod: 6, endPeriod: 8, location: '理學院 301', capacity: 60, category: '必修', description: '機率論、隨機變數、統計推論、假設檢定。' },

    // === 資工系選修 ===
    { name: '人工智慧導論', code: 'CS401', instructor: '陳建宏', department: '資訊工程學系', credits: 3, dayOfWeek: 1, startPeriod: 3, endPeriod: 5, location: '資工館 302', capacity: 45, category: '選修', description: '搜尋演算法、知識表示、機器學習基礎、神經網路入門。' },
    { name: '機器學習', code: 'CS402', instructor: '劉志明', department: '資訊工程學系', credits: 3, dayOfWeek: 2, startPeriod: 2, endPeriod: 4, location: '資工館 303', capacity: 40, category: '選修', description: '監督式學習、非監督式學習、深度學習、模型評估。' },
    { name: '深度學習', code: 'CS501', instructor: '劉志明', department: '資訊工程學系', credits: 3, dayOfWeek: 4, startPeriod: 6, endPeriod: 8, location: '資工館 303', capacity: 35, category: '選修', description: 'CNN、RNN、Transformer、生成模型。' },
    { name: '自然語言處理', code: 'CS502', instructor: '黃國華', department: '資訊工程學系', credits: 3, dayOfWeek: 5, startPeriod: 6, endPeriod: 8, location: '資工館 304', capacity: 35, category: '選修', description: '文字處理、語言模型、情感分析、機器翻譯。' },
    { name: '網頁程式設計', code: 'CS403', instructor: '王大明', department: '資訊工程學系', credits: 3, dayOfWeek: 3, startPeriod: 3, endPeriod: 5, location: '資工館 104', capacity: 50, category: '選修', description: 'HTML/CSS/JavaScript、React、Node.js、RESTful API。' },
    { name: '資料庫系統', code: 'CS303', instructor: '林志偉', department: '資訊工程學系', credits: 3, dayOfWeek: 4, startPeriod: 2, endPeriod: 4, location: '資工館 201', capacity: 50, category: '選修', description: 'SQL、正規化、交易處理、索引與查詢最佳化。' },
    { name: '計算機網路', code: 'CS304', instructor: '張文雯', department: '資訊工程學系', credits: 3, dayOfWeek: 1, startPeriod: 9, endPeriod: 11, location: '資工館 102', capacity: 50, category: '選修', description: 'TCP/IP 協定、路由、網路安全、應用層協定。' },
    { name: '軟體工程', code: 'CS404', instructor: '李秀芳', department: '資訊工程學系', credits: 3, dayOfWeek: 2, startPeriod: 9, endPeriod: 11, location: '資工館 202', capacity: 45, category: '選修', description: '軟體開發流程、需求分析、測試、版本控制。' },
    { name: '資訊安全', code: 'CS405', instructor: '張文雯', department: '資訊工程學系', credits: 3, dayOfWeek: 5, startPeriod: 3, endPeriod: 5, location: '資工館 105', capacity: 40, category: '選修', description: '密碼學、網路安全、惡意程式分析、滲透測試。' },
    { name: '雲端運算', code: 'CS503', instructor: '陳建宏', department: '資訊工程學系', credits: 3, dayOfWeek: 3, startPeriod: 9, endPeriod: 11, location: '資工館 305', capacity: 40, category: '選修', description: '虛擬化技術、容器、微服務架構、雲端部署。' },
    { name: '物聯網應用', code: 'CS504', instructor: '王大明', department: '資訊工程學系', credits: 3, dayOfWeek: 4, startPeriod: 9, endPeriod: 11, location: '資工館 106', capacity: 35, category: '選修', description: '感測器、嵌入式系統、MQTT、IoT 平台。' },
    { name: '影像處理與電腦視覺', code: 'CS505', instructor: '劉志明', department: '資訊工程學系', credits: 3, dayOfWeek: 5, startPeriod: 9, endPeriod: 11, location: '資工館 303', capacity: 35, category: '選修', description: '影像濾波、邊緣偵測、物件偵測、影像分割。' },

    // === 電機系 ===
    { name: '電路學', code: 'EE101', instructor: '徐國強', department: '電機工程學系', credits: 3, dayOfWeek: 1, startPeriod: 2, endPeriod: 4, location: '電機館 101', capacity: 70, category: '必修', description: '基本電路元件、克希荷夫定律、戴維寧定理。' },
    { name: '電子學(一)', code: 'EE201', instructor: '何美君', department: '電機工程學系', credits: 3, dayOfWeek: 2, startPeriod: 2, endPeriod: 4, location: '電機館 201', capacity: 65, category: '必修', description: '二極體、電晶體、放大器電路設計。' },
    { name: '訊號與系統', code: 'EE301', instructor: '徐國強', department: '電機工程學系', credits: 3, dayOfWeek: 3, startPeriod: 2, endPeriod: 4, location: '電機館 301', capacity: 55, category: '必修', description: '連續與離散時間訊號、傅立葉轉換、拉普拉斯轉換。' },
    { name: '數位邏輯設計', code: 'EE102', instructor: '何美君', department: '電機工程學系', credits: 3, dayOfWeek: 4, startPeriod: 2, endPeriod: 4, location: '電機館 102', capacity: 65, category: '必修', description: '布林代數、組合邏輯、序向邏輯、FPGA 實作。' },
    { name: '嵌入式系統', code: 'EE401', instructor: '徐國強', department: '電機工程學系', credits: 3, dayOfWeek: 5, startPeriod: 2, endPeriod: 4, location: '電機館 401', capacity: 40, category: '選修', description: 'ARM 處理器、RTOS、硬體驅動程式。' },

    // === 企管系 ===
    { name: '管理學', code: 'BA101', instructor: '蔡明翰', department: '企業管理學系', credits: 3, dayOfWeek: 1, startPeriod: 3, endPeriod: 5, location: '管理學院 101', capacity: 80, category: '必修', description: '管理理論、組織行為、策略管理。' },
    { name: '經濟學原理', code: 'BA102', instructor: '林怡君', department: '企業管理學系', credits: 3, dayOfWeek: 2, startPeriod: 3, endPeriod: 5, location: '管理學院 102', capacity: 80, category: '必修', description: '供需理論、市場結構、總體經濟指標。' },
    { name: '行銷管理', code: 'BA201', instructor: '蔡明翰', department: '企業管理學系', credits: 3, dayOfWeek: 3, startPeriod: 3, endPeriod: 5, location: '管理學院 201', capacity: 70, category: '選修', description: '4P 策略、消費者行為、品牌管理。' },
    { name: '財務管理', code: 'BA202', instructor: '林怡君', department: '企業管理學系', credits: 3, dayOfWeek: 4, startPeriod: 3, endPeriod: 5, location: '管理學院 202', capacity: 65, category: '選修', description: '資本預算、風險管理、財務報表分析。' },
    { name: '人力資源管理', code: 'BA301', instructor: '蔡明翰', department: '企業管理學系', credits: 3, dayOfWeek: 5, startPeriod: 3, endPeriod: 5, location: '管理學院 301', capacity: 60, category: '選修', description: '招募、訓練、績效評估、薪酬管理。' },

    // === 通識課程 ===
    { name: '大學國文', code: 'GE101', instructor: '鄭淑媛', department: '通識教育中心', credits: 2, dayOfWeek: 1, startPeriod: 6, endPeriod: 7, location: '共同大樓 101', capacity: 50, category: '通識', description: '現代散文選讀、寫作技巧、文學鑑賞。' },
    { name: '大學英文(一)', code: 'GE102', instructor: 'John Smith', department: '通識教育中心', credits: 2, dayOfWeek: 2, startPeriod: 6, endPeriod: 7, location: '共同大樓 102', capacity: 40, category: '通識', description: '英文聽說讀寫綜合訓練、日常會話。' },
    { name: '哲學概論', code: 'GE201', instructor: '陳哲學', department: '通識教育中心', credits: 2, dayOfWeek: 3, startPeriod: 6, endPeriod: 7, location: '共同大樓 201', capacity: 50, category: '通識', description: '西方哲學導論、倫理學、知識論。' },
    { name: '藝術鑑賞', code: 'GE202', instructor: '許雅文', department: '通識教育中心', credits: 2, dayOfWeek: 4, startPeriod: 6, endPeriod: 7, location: '共同大樓 202', capacity: 55, category: '通識', description: '繪畫、雕塑、建築與現代藝術鑑賞。' },
    { name: '音樂欣賞', code: 'GE203', instructor: '楊琴韻', department: '通識教育中心', credits: 2, dayOfWeek: 5, startPeriod: 6, endPeriod: 7, location: '共同大樓 203', capacity: 55, category: '通識', description: '古典音樂、流行音樂、世界音樂欣賞。' },
    { name: '心理學概論', code: 'GE301', instructor: '趙心怡', department: '通識教育中心', credits: 2, dayOfWeek: 1, startPeriod: 8, endPeriod: 9, location: '共同大樓 301', capacity: 60, category: '通識', description: '認知心理、發展心理、社會心理、異常心理。' },
    { name: '社會學概論', code: 'GE302', instructor: '孫文德', department: '通識教育中心', credits: 2, dayOfWeek: 2, startPeriod: 8, endPeriod: 9, location: '共同大樓 302', capacity: 55, category: '通識', description: '社會結構、社會變遷、文化與社會化。' },
    { name: '法學緒論', code: 'GE303', instructor: '許正義', department: '通識教育中心', credits: 2, dayOfWeek: 3, startPeriod: 8, endPeriod: 9, location: '共同大樓 303', capacity: 50, category: '通識', description: '法律體系、民法、刑法、憲法基礎概念。' },
    { name: '體育(一)', code: 'GE401', instructor: '陳運動', department: '通識教育中心', credits: 1, dayOfWeek: 4, startPeriod: 8, endPeriod: 9, location: '體育館', capacity: 40, category: '通識', description: '體適能、球類運動、游泳。' },
    { name: '服務學習', code: 'GE402', instructor: '劉愛心', department: '通識教育中心', credits: 1, dayOfWeek: 5, startPeriod: 8, endPeriod: 9, location: '共同大樓 401', capacity: 45, category: '通識', description: '社區服務、志工實踐、反思報告。' },
    { name: '環境與永續發展', code: 'GE501', instructor: '林綠洲', department: '通識教育中心', credits: 2, dayOfWeek: 1, startPeriod: 10, endPeriod: 11, location: '共同大樓 501', capacity: 50, category: '通識', description: '環境議題、氣候變遷、永續發展目標。' },
    { name: '科技與社會', code: 'GE502', instructor: '孫文德', department: '通識教育中心', credits: 2, dayOfWeek: 2, startPeriod: 10, endPeriod: 11, location: '共同大樓 502', capacity: 50, category: '通識', description: 'AI 倫理、隱私權、科技對社會的影響。' },
    { name: '創意思考與設計', code: 'GE503', instructor: '許雅文', department: '通識教育中心', credits: 2, dayOfWeek: 3, startPeriod: 10, endPeriod: 11, location: '共同大樓 503', capacity: 45, category: '通識', description: '設計思維、創意方法論、專題實作。' },
    { name: '簡報與口語表達', code: 'GE504', instructor: '鄭淑媛', department: '通識教育中心', credits: 2, dayOfWeek: 4, startPeriod: 10, endPeriod: 11, location: '共同大樓 504', capacity: 40, category: '通識', description: '公眾演說技巧、簡報設計、溝通藝術。' },
    { name: '日語(一)', code: 'GE601', instructor: '田中花子', department: '通識教育中心', credits: 2, dayOfWeek: 5, startPeriod: 10, endPeriod: 11, location: '共同大樓 601', capacity: 35, category: '通識', description: '日語五十音、基礎語法、日常會話。' },

    // === 更多資工選修 ===
    { name: '程式設計(二)', code: 'CS103', instructor: '王大明', department: '資訊工程學系', credits: 3, dayOfWeek: 2, startPeriod: 2, endPeriod: 4, location: '資工館 101', capacity: 55, category: '必修', description: 'C++ 進階程式設計，泛型程式設計、STL、檔案處理。' },
    { name: '編譯器設計', code: 'CS506', instructor: '黃國華', department: '資訊工程學系', credits: 3, dayOfWeek: 1, startPeriod: 2, endPeriod: 4, location: '資工館 306', capacity: 35, category: '選修', description: '詞法分析、語法分析、語意分析、程式碼生成。' },
    { name: '平行計算', code: 'CS507', instructor: '李秀芳', department: '資訊工程學系', credits: 3, dayOfWeek: 3, startPeriod: 9, endPeriod: 11, location: '資工館 307', capacity: 30, category: '選修', description: '多執行緒、GPU 運算、分散式計算、MapReduce。' },
    { name: '區塊鏈技術', code: 'CS508', instructor: '陳建宏', department: '資訊工程學系', credits: 3, dayOfWeek: 2, startPeriod: 9, endPeriod: 11, location: '資工館 308', capacity: 35, category: '選修', description: '分散式帳本、智能合約、DApp 開發、共識機制。' },
    { name: '遊戲程式設計', code: 'CS509', instructor: '王大明', department: '資訊工程學系', credits: 3, dayOfWeek: 4, startPeriod: 6, endPeriod: 8, location: '資工館 104', capacity: 40, category: '選修', description: '遊戲引擎、物理模擬、2D/3D 渲染、遊戲 AI。' },
    { name: '行動應用開發', code: 'CS510', instructor: '林志偉', department: '資訊工程學系', credits: 3, dayOfWeek: 5, startPeriod: 6, endPeriod: 8, location: '資工館 201', capacity: 40, category: '選修', description: 'React Native / Flutter、行動 UI、推播通知。' },
    { name: '大數據分析', code: 'CS511', instructor: '劉志明', department: '資訊工程學系', credits: 3, dayOfWeek: 1, startPeriod: 9, endPeriod: 11, location: '資工館 309', capacity: 40, category: '選修', description: 'Hadoop、Spark、資料倉儲、資料視覺化。' },
    { name: '人機互動', code: 'CS512', instructor: '張文雯', department: '資訊工程學系', credits: 3, dayOfWeek: 2, startPeriod: 6, endPeriod: 8, location: '資工館 310', capacity: 40, category: '選修', description: '使用者經驗設計、可用性測試、介面原型設計。' },
    { name: '數位影像處理', code: 'CS513', instructor: '劉志明', department: '資訊工程學系', credits: 3, dayOfWeek: 3, startPeriod: 6, endPeriod: 8, location: '資工館 311', capacity: 35, category: '選修', description: '影像增強、頻域分析、影像壓縮、形態學運算。' },
    { name: '密碼學', code: 'CS514', instructor: '張文雯', department: '資訊工程學系', credits: 3, dayOfWeek: 4, startPeriod: 9, endPeriod: 11, location: '資工館 105', capacity: 35, category: '選修', description: '對稱加密、非對稱加密、數位簽章、零知識證明。' },
  ];

  for (const course of courses) {
    insert('courses', course);
  }
  console.log(`✅ 已插入 ${courses.length} 門課程`);

  // ============================================================
  // 評價種子資料
  // ============================================================
  const reviewTemplates = {
    positive: [
      { summary: '老師教學認真，講解清楚，作業份量適中，考試不會太難。', keywords: ['教學認真', '講解清楚', '作業適中'], difficulty: 2.5, recommend: 4.5 },
      { summary: '課程內容豐富，老師很有耐心，會給很多實作機會，非常推薦！', keywords: ['內容豐富', '有耐心', '實作機會'], difficulty: 3.0, recommend: 4.8 },
      { summary: '涼課！老師人很好，只要有來上課基本都會過，期末報告輕鬆。', keywords: ['涼課', '好過', '輕鬆'], difficulty: 1.5, recommend: 4.2 },
      { summary: '學到很多東西，雖然有點挑戰但很值得，助教也很用心。', keywords: ['學到很多', '值得', '助教用心'], difficulty: 3.5, recommend: 4.3 },
      { summary: '上課氣氛很好，老師會分享業界經驗，對未來就業很有幫助。', keywords: ['氣氛好', '業界經驗', '就業有幫助'], difficulty: 2.8, recommend: 4.6 },
      { summary: '教材編排得很好，循序漸進，適合零基礎的同學。', keywords: ['教材好', '循序漸進', '適合初學'], difficulty: 2.0, recommend: 4.4 },
    ],
    negative: [
      { summary: '老師上課念投影片，考試範圍不明確，作業太多太難。', keywords: ['念投影片', '考試不明確', '作業太多'], difficulty: 4.5, recommend: 1.8 },
      { summary: '內容太艱深，跟不上進度，老師不太回覆問題。', keywords: ['太艱深', '跟不上', '不回覆'], difficulty: 4.8, recommend: 1.5 },
      { summary: '評分標準不透明，期末考占比太高，壓力很大。', keywords: ['評分不透明', '壓力大', '期末占比高'], difficulty: 4.0, recommend: 2.0 },
    ],
    neutral: [
      { summary: '一般的課程，不好不壞，中規中矩。', keywords: ['一般', '中規中矩'], difficulty: 3.0, recommend: 3.0 },
      { summary: '內容還可以，但老師講課有點無聊，需要自己多看書。', keywords: ['還可以', '有點無聊', '自學'], difficulty: 3.2, recommend: 2.8 },
      { summary: '課程本身不錯，但時間安排不太好，早八很累。', keywords: ['不錯', '早八', '累'], difficulty: 3.0, recommend: 3.2 },
    ]
  };

  const sources = ['Dcard', 'PTT', '系上學長姐分享', '課程回饋問卷'];
  let reviewCount = 0;

  for (let courseId = 1; courseId <= courses.length; courseId++) {
    const numReviews = 2 + Math.floor(Math.random() * 3);
    for (let r = 0; r < numReviews; r++) {
      const roll = Math.random();
      let sentiment, pool;
      if (roll < 0.5) { sentiment = 'positive'; pool = reviewTemplates.positive; }
      else if (roll < 0.75) { sentiment = 'negative'; pool = reviewTemplates.negative; }
      else { sentiment = 'neutral'; pool = reviewTemplates.neutral; }

      const tpl = pool[Math.floor(Math.random() * pool.length)];
      insert('reviews', {
        courseId,
        sentiment,
        summary: tpl.summary,
        keywords: tpl.keywords,
        difficultyRating: Math.round((tpl.difficulty + (Math.random() * 0.4 - 0.2)) * 10) / 10,
        recommendScore: Math.round(Math.min(5, Math.max(1, tpl.recommend + (Math.random() * 0.6 - 0.3))) * 10) / 10,
        source: sources[Math.floor(Math.random() * sources.length)],
        createdAt: new Date().toISOString()
      });
      reviewCount++;
    }
  }
  console.log(`✅ 已插入 ${reviewCount} 則課程評價`);

  // 建立預設使用者偏好
  insert('user_preferences', {
    userId: 'default',
    displayName: '同學',
    completedCredits: 45,
    targetCreditsMin: 15,
    targetCreditsMax: 22,
    blockedPeriods: [],
    preferredCategories: [],
    mustTakeCourses: [],
    avoidInstructors: [],
    preferCompact: false,
    noMorningClasses: false,
    noEveningClasses: false,
    preferencesJson: {},
    updatedAt: new Date().toISOString()
  });
  console.log('✅ 已建立預設使用者偏好');
  console.log('\n🎉 種子資料建立完成！');
}

try {
  seed();
} catch (err) {
  console.error('❌ 種子資料建立失敗:', err.message);
  console.error(err.stack);
}
