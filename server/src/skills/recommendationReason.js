// Roadmap #26：每門推薦課的證據導向理由。
//
// **這個模組只解釋既有決策，不參與決策。** 排課結果不得因為理由的計算而改變——
// 理由是排完之後對同一份結果的說明。所有輸入都是排課過程中已經算出來的東西，
// 這裡不重新判定任何規則（`isRequiredForStudent()`、`resolveCourseEligibility()`、
// `deriveReviewEvidence()` 的結果一律沿用，不另寫一份）。
//
// **誠實原則沿用既有做法，不是新發明**：`#4` 的「沒有評價不得說涼」、
// `#10` 的 `easinessSource`（`reviews`／`proxy`／`none`）都是同一條線——
// 沒有證據的地方要明講沒有，不能留白讓人以為有。

// 理由結構的版本。改變欄位語意時要升版，讓 `#2` 的互動事件可以回溯
// 「這筆曝光當時的理由是用哪一版算的」。格式比照 `PRIVACY_POLICY_VERSION`。
export const RECOMMENDATION_REASON_VERSION = '2026-09-05.v2';

// 主要原因代號。用代號而非自由文字，理由與 `#24` 的理解回講相同：
// 輸出空間小才穩定、才測得住，中文由呈現層決定。
export const SELECTION_REASONS = Object.freeze({
  REQUIRED_COURSE: 'REQUIRED_COURSE',
  RETAKE_REQUIRED: 'RETAKE_REQUIRED',
  USER_SPECIFIED: 'USER_SPECIFIED',
  COREQUISITE_PAIR: 'COREQUISITE_PAIR',
  PREFERENCE_MATCH: 'PREFERENCE_MATCH',
  CREDIT_FILL: 'CREDIT_FILL',
  WATCHING: 'WATCHING',
});

// 資料來源代號。只列**這門課實際查過**的來源——沒有評價的課不得列
// `COURSE_REVIEWS`，否則「可追溯」就變成裝飾。
export const DATA_SOURCES = Object.freeze({
  COURSE_SECTIONS: 'Course_Sections',
  COURSE_REVIEWS: 'Course_Reviews',
  USER_PROFILE: 'User_Profiles',
  CURRICULUM_TABLE: '必選修科目表',
  GENERAL_EDUCATION_RULES: '通識認列規則',
  COURSE_HISTORY: 'User_Course_History',
});

export const CONFIDENCE = Object.freeze({
  HIGH: 'high',
  MEDIUM: 'medium',
  LOW: 'low',
});

// 「沒有競爭者」與「還沒算」是兩件事，必須分得出來。
//
// 實測 demo 帳號現況就是 0 個落選者（16 門可修課全部不是排入就是被硬性排除，
// 貪婪迴圈是候選用完才停）。若兩者都用空陣列表示，畫面與 Agent 都無從分辨，
// 使用者會以為系統沒算。
export const COMPETITION_STATUS = Object.freeze({
  HAD_COMPETITORS: 'had-competitors',
  NO_COMPETITORS: 'no-competitors',
  NOT_APPLICABLE: 'not-applicable',
});

function resolveSelectionReason({ placementReason, course, requiredSelection, formallyRequired }) {
  if (placementReason === '關注課程') return SELECTION_REASONS.WATCHING;
  if (placementReason === '不及格必修重補修優先') return SELECTION_REASONS.RETAKE_REQUIRED;
  if (course?.corequisiteRole === 'internship') return SELECTION_REASONS.COREQUISITE_PAIR;
  if (formallyRequired) return SELECTION_REASONS.REQUIRED_COURSE;
  if (requiredSelection) return SELECTION_REASONS.USER_SPECIFIED;
  return SELECTION_REASONS.PREFERENCE_MATCH;
}

// 信心度由**證據完整度**決定，規則寫死不憑感覺。
//
// 任一項成立就降級，因為它們都代表「這門課的某個判斷其實沒有可靠依據」：
//   - 資格未確認（#13C 的 B～F 類）：連能不能修都還沒確定，最嚴重 → low
//   - 系所範圍無法解析：必修判定整個懸空 → low
//   - 涼度是推估而非評價（#10 的 proxy／none）：排序用得上，但不是證據 → medium
//   - 沒有任何評價：少一整類證據 → medium
function resolveConfidence(course) {
  if (course?.eligibility === 'unknown') return CONFIDENCE.LOW;
  if (course?.scopeResolved === false) return CONFIDENCE.LOW;
  if (course?.easinessSource && course.easinessSource !== 'reviews') return CONFIDENCE.MEDIUM;
  if (!course?.reviewEvidence) return CONFIDENCE.MEDIUM;
  return CONFIDENCE.HIGH;
}

function resolveDataSources(course) {
  // 課程本身一定來自 Course_Sections。
  const sources = [DATA_SOURCES.COURSE_SECTIONS];

  // **只有真的有評價才列評價來源。** proxy 涼度不算查過評價。
  if (course?.reviewEvidence) sources.push(DATA_SOURCES.COURSE_REVIEWS);
  // 類別由必選修科目表解析出來時才列（`classificationSource` 由 #12 提供）。
  if (course?.classificationSource && course.classificationSource !== 'mysql') {
    sources.push(DATA_SOURCES.CURRICULUM_TABLE);
  }
  if (course?.generalEducationRuleVersion) sources.push(DATA_SOURCES.GENERAL_EDUCATION_RULES);
  return sources;
}

/**
 * 組裝一門已排入課程的推薦理由。
 *
 * 全部輸入都是排課過程中已算好的值；本函式不重新判定任何規則。
 *
 * @param course            已排入的課程物件（含 #4 的 reviewEvidence、#10 的 easinessSource）
 * @param placementReason   `addCourseToPlan()` 既有的理由字串
 * @param scoreComponents   `computeScoreComponents()` 的結果
 * @param contentHits       `collectContentPreferenceHits()` 的結果
 * @param interestHits      `collectInterestHits()` 的結果
 * @param alternatives      同一決策點的落選者，`null` 代表這條路徑不適用
 * @param tradeoffs         排入這門課付出的代價（例如必修豁免了時段偏好）
 */
export function buildRecommendationReason({
  course,
  placementReason = null,
  scoreComponents = null,
  scoringPolicy = null,
  contentHits = [],
  interestHits = [],
  alternatives = null,
  tradeoffs = [],
  requiredSelection = false,
  formallyRequired = false,
} = {}) {
  const selectedBecause = resolveSelectionReason({
    placementReason, course, requiredSelection, formallyRequired,
  });

  return {
    reasonVersion: RECOMMENDATION_REASON_VERSION,
    selectedBecause,
    // 原本那句人寫的理由保留，不刪——既有呼叫端與測試都還在讀 `course.reason`。
    placementReason,
    // 分數怎麼來的。只列非 0 的元件，避免一堆 0 稀釋掉真正起作用的項目。
    scoringPolicy,
    scoreBreakdown: scoreComponents
      ? Object.entries(scoreComponents)
        .filter(([, value]) => value !== 0)
        .map(([component, value]) => ({ component, value }))
      : [],
    scoreTotal: scoreComponents
      ? Object.values(scoreComponents).reduce((sum, value) => sum + value, 0)
      : null,
    matchedPreferences: [
      ...contentHits.map(hit => ({
        type: 'content', preferenceId: hit.preferenceId, label: hit.label, score: hit.score,
      })),
      ...interestHits.map(keyword => ({
        type: 'interest', preferenceId: 'interests', label: keyword, score: null,
      })),
    ],
    // 為什麼算必修／算哪一類。沿用既有欄位，不新增判定。
    requiredRules: {
      formallyRequired,
      category: course?.category ?? null,
      sourceCategory: course?.sourceCategory ?? null,
      classificationSource: course?.classificationSource ?? null,
      track: course?.track ?? null,
      countsTowardGraduation: course?.countsTowardGraduation ?? null,
      nonGraduationCategory: course?.nonGraduationCategory ?? null,
    },
    // #4 的評價證據；`null` 代表這門課沒有評價，**不是** 0 分。
    reviewEvidence: course?.reviewEvidence ?? null,
    // #10 的涼度來源：`reviews` 才是證據，`proxy` 只能說「依課程屬性推估」。
    easinessSource: course?.easinessSource ?? null,
    // 排入這門課付出的代價（例如必修無條件豁免了時段偏好）。
    constraintTradeoffs: tradeoffs,
    // 誰輸給了它。`status` 區分「沒有競爭者」與「這條路徑不適用」。
    alternativesRejected: alternatives ?? {
      status: COMPETITION_STATUS.NOT_APPLICABLE, candidates: [],
    },
    confidence: resolveConfidence(course),
    dataSources: resolveDataSources(course),
  };
}

/**
 * 把貪婪迴圈同一個決策點的落選者整理成可呈現的形狀。
 *
 * **只記錄「在這個決策點上被比下去」的課。** 被更早的硬限制擋掉的課不算落選者
 * ——那是 `excludedCourses` 的 `constraintId` 在回答的問題，兩者語意不同。
 */
export function buildAlternatives(chosenScore, runnersUp = []) {
  if (runnersUp.length === 0) {
    return { status: COMPETITION_STATUS.NO_COMPETITORS, candidates: [] };
  }

  return {
    status: COMPETITION_STATUS.HAD_COMPETITORS,
    candidates: runnersUp.map(({ course, score }) => ({
      sectionId: course.id,
      catalogCourseCode: course.catalogCourseCode ?? null,
      name: course.name,
      scoreDelta: Number((chosenScore - score).toFixed(2)),
    })),
  };
}

export default {
  RECOMMENDATION_REASON_VERSION,
  SELECTION_REASONS,
  DATA_SOURCES,
  CONFIDENCE,
  COMPETITION_STATUS,
  buildRecommendationReason,
  buildAlternatives,
};
