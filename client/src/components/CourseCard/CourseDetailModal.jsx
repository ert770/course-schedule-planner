import { formatCourseTime } from '../../utils/courseTime';

// 課程詳情彈窗（含 roadmap #26 的推薦理由）。
//
// **抽成共用元件的理由**：`SchedulePage.jsx` 與 `DashboardPage.jsx` 原本各有一份
// 幾乎相同的彈窗，兩邊已經開始漂移（Dashboard 少了地點與時間）。推薦理由是一段
// 有實質規則的 UI（什麼時候能講涼度、什麼時候要說沒有依據），複製兩份必然走樣。

const SELECTION_LABELS = {
  REQUIRED_COURSE: '這是你的必修課',
  RETAKE_REQUIRED: '這是需要重補修的必修',
  USER_SPECIFIED: '你指定要修這門課',
  COREQUISITE_PAIR: '它與同名正課必須一起修',
  PREFERENCE_MATCH: '它符合你的偏好',
  CREDIT_FILL: '用來補足學分',
  WATCHING: '你把它加入關注',
};

const CONFIDENCE_LABELS = {
  high: { text: '證據充分', className: 'reason-confidence-high' },
  medium: { text: '部分依據不足', className: 'reason-confidence-medium' },
  low: { text: '依據不足，請自行確認', className: 'reason-confidence-low' },
};

// 涼度來源決定措辭。這條規則與後端 `resolveEasiness()`／`PROMPT_DESIGN.md`
// 是同一條：只有 `reviews` 是證據，`proxy` 是推估，`none` 不得提涼度。
const EASINESS_LABELS = {
  reviews: null, // 有評價時改為顯示實際評價筆數，不用這裡的文字
  proxy: '涼度為依課程屬性推估，不是實際評價',
  none: '沒有涼度依據',
};

function ReasonSection({ reason }) {
  if (!reason) return null;

  const confidence = CONFIDENCE_LABELS[reason.confidence] || CONFIDENCE_LABELS.medium;
  const alternatives = reason.alternativesRejected;

  return (
    <div className="detail-reason">
      <div className="detail-desc-label">為什麼推薦這門課</div>

      <p className="reason-headline">
        {SELECTION_LABELS[reason.selectedBecause] || '依排課結果選入'}
        <span className={`reason-confidence ${confidence.className}`}>{confidence.text}</span>
      </p>

      {reason.matchedPreferences?.length > 0 ? (
        <p className="reason-line">
          <strong>命中你的偏好：</strong>
          {reason.matchedPreferences.map(item => item.label).join('、')}
        </p>
      ) : (
        // 沒命中就照實說，不要硬掰一個理由——這是 #26 的核心要求。
        <p className="reason-line reason-muted">它沒有命中你設定的任何偏好。</p>
      )}

      <p className="reason-line">
        <strong>評價證據：</strong>
        {reason.reviewEvidence
          ? `${reason.reviewEvidence.reviewCount} 則評價`
          : '這門課沒有評價資料'}
        {EASINESS_LABELS[reason.easinessSource]
          ? `（${EASINESS_LABELS[reason.easinessSource]}）`
          : ''}
      </p>

      {reason.constraintTradeoffs?.length > 0 && (
        <p className="reason-line reason-tradeoff">
          <strong>代價：</strong>
          {reason.constraintTradeoffs.map(item => `不符合「${item.label}」偏好，但必修優先`).join('；')}
        </p>
      )}

      {/* 「沒有競爭者」與「還沒算」必須分得出來，不能都顯示成空白。 */}
      {alternatives?.status === 'no-competitors' && (
        <p className="reason-line reason-muted">同一個時段沒有其他課與它競爭。</p>
      )}
      {alternatives?.status === 'had-competitors' && alternatives.candidates.length > 0 && (
        <div className="reason-line">
          <strong>它勝過：</strong>
          <ul className="reason-alternatives">
            {alternatives.candidates.map(item => (
              <li key={item.name}>
                {item.name}（差 {item.scoreDelta} 分）
                {item.notScheduledBecause ? `；${item.notScheduledBecause}` : ''}
              </li>
            ))}
          </ul>
        </div>
      )}

      {reason.dataSources?.length > 0 && (
        <p className="reason-sources">依據來源：{reason.dataSources.join('、')}</p>
      )}
    </div>
  );
}

export default function CourseDetailModal({ course, onClose, onRemove, showTime = true }) {
  if (!course) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose}>✕</button>
        <h2 style={{ fontSize: '1.3rem', marginBottom: '8px' }}>{course.name}</h2>
        <span className="detail-code">{course.code}</span>
        <div className="detail-meta">
          <span>👤 {course.instructor}</span>
          <span>📚 {course.credits} 學分</span>
          {showTime && <span>📍 {course.location}</span>}
          {showTime && <span>⏰ {formatCourseTime(course)}</span>}
        </div>

        <ReasonSection reason={course.recommendationReason} />

        {course.description && (
          <div className="detail-desc">
            <div className="detail-desc-label">課程說明</div>
            <p>{course.description}</p>
          </div>
        )}

        {onRemove && (
          <button
            className="action-btn secondary modal-remove-course"
            onClick={() => onRemove(course)}
          >
            從課表移除
          </button>
        )}
      </div>
    </div>
  );
}
