// 測試用的課程建構器。
//
// 測試刻意不連資料庫：排課邏輯是純函式，用合成資料才能穩定重現各種邊界情境，
// 也讓測試在沒有 .env 與 MySQL 連線的環境（例如 CI）仍可執行。

export function makeCourse(id, overrides = {}) {
  return {
    id,
    name: `課程${id}`,
    code: `C${id}`,
    instructor: '教師',
    department: '資訊三甲',
    credits: 3,
    dayOfWeek: 1,
    startPeriod: 3,
    endPeriod: 4,
    category: '選修',
    description: '',
    ...overrides,
  };
}

// 多時段課程，例如 `(四)01-04 (四)06-09 (五)01-04`
export function makeMultiBlockCourse(id, blocks, overrides = {}) {
  return makeCourse(id, {
    timeBlocks: blocks,
    dayOfWeek: blocks[0].dayOfWeek,
    startPeriod: blocks[0].startPeriod,
    endPeriod: blocks[0].endPeriod,
    ...overrides,
  });
}

// 尚未排定上課時間的課程，對應 `time_str` 節次為 `00`
export function makeUnscheduledCourse(id, overrides = {}) {
  return makeCourse(id, {
    credits: 0,
    dayOfWeek: null,
    startPeriod: null,
    endPeriod: null,
    timeBlocks: [],
    ...overrides,
  });
}

export function makeReview(overrides = {}) {
  return {
    id: 1,
    courseId: 1,
    sentiment: 'positive',
    summary: '評價內容',
    keywords: [],
    sweetness: 4,
    coolness: 4,
    workload: 3,
    value: 4,
    overall: 4,
    reviewCount: 1,
    difficultyRating: 3,
    recommendScore: 4,
    ...overrides,
  };
}

// 典型「涼課」評價：四個涼度維度取值域高分端。
export function makeEasyReview(courseId, overrides = {}) {
  return makeReview({
    courseId, sweetness: 5, coolness: 5, workload: 1, overall: 5, reviewCount: 5, ...overrides,
  });
}

// 典型「硬課」評價：四個涼度維度取值域低分端。
export function makeToughReview(courseId, overrides = {}) {
  return makeReview({
    courseId, sweetness: 1, coolness: 1, workload: 5, overall: 1, reviewCount: 5, ...overrides,
  });
}
