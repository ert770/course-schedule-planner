// 資訊工程學系課程分類（114 學年度入學學生適用）。
//
// **來源**（兩份官方文件，均已人工核對）：
//   1. 逢甲大學資訊工程學系學士班必選修科目表（114 學年度入學學生適用）
//      —— 提供「核心選修 12 學分」與「選修 16 學分」兩份清單及學分數。
//   2. 資訊工程學系課程地圖（113 學年度）
//      —— 提供每門核心選修／選修所屬的修課路徑。
//
// ## `c.` 與 `d.` 前綴的意義（已確認）
//
// 必選修科目表 PDF 的選修科目有 `c.` 與 `d.` 兩種前綴，先前查不到定義。
// 以科目表本身的區塊逐門比對後確認：
//
// | 前綴 | 對應區塊 | 門數 |
// | --- | --- | ---: |
// | `c.` | 核心選修（12 學分） | 15 |
// | `d.` | 選修（16 學分） | 53 |
//
// `c.` 的 15 門與 `docs/COURSE_SELECTION_RULES.md` 第六節記錄的清單**逐門完全一致**，
// 因此對應關係確定。`d.` 先前記為 54 門，本檔依科目表可逐列驗證的內容建為 53 門，
// 1 門的差距見 `docs/COURSE_SELECTION_RULES.md` 第六節。
//
// ## 修課路徑名稱（已確認）
//
// 課程地圖標示的三條路徑為 **嵌入式系統類／技術應用類／網路與安全類**，
// 而非系網課程規劃頁的「電腦系統／軟體工程／網路與資安」。以課程地圖為準。
//
// 三條路徑的核心選修學分數可交叉驗證此處的歸類：
// 嵌入式系統類 11 學分（缺 1）、網路與安全類 9 學分（缺 3）、技術應用類 15 學分（超過 3）。
// 缺 1 與缺 3 與既有規格記載的差額一致。
//
// ## 比對方式
//
// 課名比對**必須**同時要求課號（`Courses.subid3`）以 `IECS` 開頭。資料庫中：
//   - 「網路程式設計」只有通訊工程學系的 `COME3016`
//   - 「電子學」只有機電系的 `MCAE3103`
// 只用課名會把他系課程誤判成資工系核心選修。

export const TRACK_EMBEDDED = '嵌入式系統類';
export const TRACK_APPLICATION = '技術應用類';
export const TRACK_NETWORK_SECURITY = '網路與安全類';

export const CS_TRACKS = [TRACK_EMBEDDED, TRACK_APPLICATION, TRACK_NETWORK_SECURITY];

export const CATEGORY_CORE_ELECTIVE = '核心選修';
export const CATEGORY_ELECTIVE = '選修';

// 資工系課號前綴。`Courses.subid3` 的值例如 `IECS3002`。
const CS_COURSE_CODE_PREFIX = 'IECS';

// 系必修 63 學分。**不參與課程分類**，僅作為「內容與本系重複」判定與文件用的參考資料。
//
// 分類函式刻意不回傳「必修」：資料庫的 `type` 已經標好必修，而課號相同的 section
// 可能開在別的班級（例如 `機率與統計 IECS2025` 也開在人工智慧探索應用學分學程），
// 若在此處改寫成必修，會被必修範圍判定當成「別人的必修」而整批排除。
export const REQUIRED_COURSES = [
  { name: '程式設計(I)', credits: 2 },
  { name: '程式設計(II)', credits: 2 },
  { name: '程式設計(III)', credits: 2 },
  { name: '程式設計(IV)', credits: 2 },
  { name: '計算機概論', credits: 2 },
  { name: '微積分(一)', credits: 3 },
  { name: '微積分(二)', credits: 3 },
  { name: '普通物理-電、磁、光', credits: 3 },
  { name: '普通物理-電、磁、光實驗', credits: 1 },
  { name: '線性代數', credits: 3 },
  { name: '邏輯設計', credits: 3 },
  { name: '邏輯設計實習', credits: 1 },
  { name: '資料結構', credits: 3 },
  { name: '資料結構實習', credits: 1 },
  { name: '離散數學', credits: 3 },
  { name: '通訊與網路概論', credits: 3 },
  { name: '系統程式', credits: 3 },
  { name: '機率與統計', credits: 3 },
  { name: '資料庫系統', credits: 3 },
  { name: '作業系統(一)', credits: 3 },
  { name: '微處理機系統', credits: 3 },
  { name: '微處理機系統實習', credits: 1 },
  { name: '計算機結構學', credits: 3 },
  { name: '計算機演算法', credits: 3 },
  { name: '專題研究(一)', credits: 2 },
  { name: '專題研究(二)', credits: 2 },
];

// `c.` —— 核心選修 12 學分，共 15 門。
export const CORE_ELECTIVES = [
  { name: '電子學', credits: 3, track: TRACK_EMBEDDED },
  { name: '電子學實驗', credits: 1, track: TRACK_EMBEDDED },
  { name: '數位系統設計', credits: 3, track: TRACK_EMBEDDED },
  { name: '數位系統設計實驗', credits: 1, track: TRACK_EMBEDDED },
  { name: '編譯器', credits: 3, track: TRACK_EMBEDDED },

  { name: '物件導向設計', credits: 2, track: TRACK_APPLICATION },
  { name: '物件導向設計實習', credits: 1, track: TRACK_APPLICATION },
  { name: '系統分析與設計', credits: 3, track: TRACK_APPLICATION },
  { name: '軟體工程開發實務', credits: 3, track: TRACK_APPLICATION },
  { name: '程式語言', credits: 3, track: TRACK_APPLICATION },
  { name: '人工智慧導論', credits: 3, track: TRACK_APPLICATION },

  { name: '密碼學', credits: 3, track: TRACK_NETWORK_SECURITY },
  { name: '網路程式設計', credits: 2, track: TRACK_NETWORK_SECURITY },
  { name: '網路程式設計實習', credits: 1, track: TRACK_NETWORK_SECURITY },
  { name: '資訊與網路安全', credits: 3, track: TRACK_NETWORK_SECURITY },
];

// `d.` —— 選修 16 學分，共 53 門。
//
// `track: null` 為 114 科目表有、113 課程地圖尚未歸類的課程（多為 114 新增科目
// 與實習類課程）。這類課程仍是合法選修，只是無法依修課路徑推薦。
export const ELECTIVES = [
  { name: '工程數學', credits: 3, track: TRACK_EMBEDDED },
  { name: '數位信號處理導論', credits: 3, track: TRACK_EMBEDDED },
  { name: 'UNIX應用與實務', credits: 2, track: TRACK_EMBEDDED },
  { name: '數位影像處理', credits: 3, track: TRACK_EMBEDDED },
  { name: '作業系統(二)', credits: 3, track: TRACK_EMBEDDED },
  { name: '嵌入式系統', credits: 3, track: TRACK_EMBEDDED },
  { name: '超大型積體電路設計導論', credits: 3, track: TRACK_EMBEDDED },

  { name: '使用者經驗設計', credits: 3, track: TRACK_APPLICATION },
  { name: '組合數學', credits: 3, track: TRACK_APPLICATION },
  { name: '多媒體系統', credits: 3, track: TRACK_APPLICATION },
  { name: 'Web程式設計', credits: 3, track: TRACK_APPLICATION },
  { name: '資料科學實務', credits: 3, track: TRACK_APPLICATION },
  { name: '軟體測試', credits: 3, track: TRACK_APPLICATION },
  { name: '資料探勘導論', credits: 3, track: TRACK_APPLICATION },
  { name: '行動應用程式開發', credits: 3, track: TRACK_APPLICATION },
  { name: '地理資訊系統', credits: 3, track: TRACK_APPLICATION },
  { name: '雲端應用系統開發', credits: 3, track: TRACK_APPLICATION },
  { name: '軟體框架設計', credits: 3, track: TRACK_APPLICATION },
  { name: '資訊實務案例探討', credits: 2, track: TRACK_APPLICATION },
  { name: '人工智慧自然語言導論', credits: 3, track: TRACK_APPLICATION },
  { name: '電腦視覺與擴增實境', credits: 3, track: TRACK_APPLICATION },
  { name: '管理資訊系統', credits: 3, track: TRACK_APPLICATION },
  { name: '自然語言處理實務', credits: 3, track: TRACK_APPLICATION },
  { name: '生物資訊概論', credits: 3, track: TRACK_APPLICATION },
  { name: '深度學習', credits: 3, track: TRACK_APPLICATION },
  { name: '人工智慧的產業應用', credits: 2, track: TRACK_APPLICATION },
  { name: '智慧物聯網實務應用', credits: 3, track: TRACK_APPLICATION },
  { name: '程式設計與問題解決', credits: 2, track: TRACK_APPLICATION },

  { name: '電子商務安全', credits: 3, track: TRACK_NETWORK_SECURITY },
  { name: '互連網路', credits: 3, track: TRACK_NETWORK_SECURITY },
  { name: '寬頻網路', credits: 3, track: TRACK_NETWORK_SECURITY },
  { name: '資訊安全管理', credits: 3, track: TRACK_NETWORK_SECURITY },
  { name: '安全程式設計', credits: 3, track: TRACK_NETWORK_SECURITY },
  { name: '系統安全', credits: 3, track: TRACK_NETWORK_SECURITY },
  { name: '無線網路系統', credits: 3, track: TRACK_NETWORK_SECURITY },
  { name: '資安韌性與社會實踐', credits: 3, track: TRACK_NETWORK_SECURITY },

  { name: 'Python程式設計', credits: 2, track: null },
  { name: '系統思維與機率應用', credits: 3, track: null },
  { name: '系統思維與統計應用', credits: 3, track: null },
  { name: '產業實習導論', credits: 1, track: null },
  { name: '專題產業實習(一)', credits: 3, track: null },
  { name: '專題產業實習(二)', credits: 3, track: null },
  { name: '專題產業實習(三)', credits: 3, track: null },
  { name: '專題產業實習(四)', credits: 2, track: null },
  { name: '校外專業實習(寒)', credits: 1, track: null },
  { name: '校外專業實習(一)', credits: 3, track: null },
  { name: '校外專業實習(二)', credits: 3, track: null },
  { name: '校外專業實習(三)', credits: 3, track: null },
  { name: '校外專業實習(四)', credits: 2, track: null },
  { name: '校外專業實習(暑一)', credits: 1, track: null },
  { name: '校外專業實習(暑二)', credits: 1, track: null },
  { name: '校外專業實習(暑三)', credits: 1, track: null },
  { name: '校外專業實習(暑四)', credits: 1, track: null },
];

// 課名正規化：科目表與資料庫的空白與全形／半形括號寫法不完全一致。
// 只做「不改變語意」的整理，不做同義詞對應——後者會製造看不見的誤判。
export function normalizeCourseName(name) {
  return String(name || '')
    .replace(/\s+/gu, '')
    .replace(/[（]/gu, '(')
    .replace(/[）]/gu, ')')
    .replace(/[—–－ー]/gu, '-')
    .toUpperCase();
}

function buildIndex() {
  const index = new Map();
  for (const course of CORE_ELECTIVES) {
    index.set(normalizeCourseName(course.name), { ...course, category: CATEGORY_CORE_ELECTIVE });
  }
  for (const course of ELECTIVES) {
    index.set(normalizeCourseName(course.name), { ...course, category: CATEGORY_ELECTIVE });
  }
  return index;
}

const CURRICULUM_BY_NAME = buildIndex();

// 科目表上所有資工系科目的課名（必修 + 核心選修 + 選修），
// 供「系外選修內容不得與本系重複」判定使用。
const CS_COURSE_NAMES = new Set([
  ...REQUIRED_COURSES.map(course => normalizeCourseName(course.name)),
  ...CURRICULUM_BY_NAME.keys(),
]);

// 這門課是否為資工系開設。判定依課號前綴，不看班級名稱——
// 資工系的課也會開在 `資通安全學程` 這類非系所班級底下（例如密碼學 `IECS3052`）。
export function isCsCourse(course) {
  return String(course?.subid3 || '').trim().toUpperCase().startsWith(CS_COURSE_CODE_PREFIX);
}

// 依 114 必選修科目表分類一門資工系課程。
// 回傳 `{ category, track, credits, name }`，不在核心選修／選修清單中則回傳 null。
export function classifyCsCourse(course) {
  if (!isCsCourse(course)) return null;
  return CURRICULUM_BY_NAME.get(normalizeCourseName(course?.name)) || null;
}

// 這個課名是否出現在資工系必選修科目表上。
// 用於系外選修的「課程內容不與本系重複或不相近」條件。
export function isCsCurriculumCourseName(name) {
  return CS_COURSE_NAMES.has(normalizeCourseName(name));
}

export default {
  CS_TRACKS,
  CORE_ELECTIVES,
  ELECTIVES,
  REQUIRED_COURSES,
  isCsCourse,
  classifyCsCourse,
  isCsCurriculumCourseName,
  normalizeCourseName,
};
