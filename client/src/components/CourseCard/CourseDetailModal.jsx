import { formatCourseTime } from '../../utils/courseTime';
import { formatCourseGradeLevel } from '../../utils/courseGradeLevel';

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

const EASINESS_LABELS = {
  reviews: null,
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

// 動態美化課程類別標籤的樣式函數
const getCategoryStyle = (category) => {
  if (!category) return { bg: '#f1f5f9', text: '#475569', icon: '📌' }; // 預設灰
  if (category.includes('必修')) return { bg: '#fee2e2', text: '#b91c1c', icon: '🔥' }; // 必修紅
  if (category.includes('選修')) return { bg: '#e0f2fe', text: '#0369a1', icon: '💡' }; // 選修藍
  if (category.includes('通識')) return { bg: '#dcfce7', text: '#15803d', icon: '🌍' }; // 通識綠
  return { bg: '#f1f5f9', text: '#475569', icon: '📌' }; 
};

export default function CourseDetailModal({ course, onClose, onRemove, showTime = true }) {
  if (!course) return null;

  const catStyle = getCategoryStyle(course.category);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose}>✕</button>
        <h2 style={{ fontSize: '1.3rem', marginBottom: '6px' }}>{course.name}</h2>
        <span className="detail-code">{course.code}</span>
        
        {/* 高質感標籤列與地點 */}
        <div className="detail-meta" style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', margin: '16px 0', alignItems: 'center' }}>
          {/* 美化後的類別標籤 */}
          <span style={{ 
            background: catStyle.bg, color: catStyle.text, 
            padding: '4px 12px', borderRadius: '20px', 
            fontWeight: '600', fontSize: '0.85rem', 
            display: 'flex', alignItems: 'center', gap: '6px',
            border: `1px solid ${catStyle.text}33` // 加入微透明邊框增加質感
          }}>
            {catStyle.icon} {course.category || '一般課程'}
          </span>
          
          {/* 加入明確的地點標籤 */}
          {showTime && (
            <span style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.9rem', color: '#475569', fontWeight: '500' }}>
              📍 {course.location || '地點待排'}
            </span>
          )}

          <span style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.9rem', color: '#475569' }}>👤 {course.instructor}</span>
          <span style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.9rem', color: '#475569' }}>📚 {course.credits} 學分</span>
          <span style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.9rem', color: '#475569' }}>🎓 {formatCourseGradeLevel(course.gradeLevel)}</span>
          {showTime && <span style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.9rem', color: '#475569' }}>⏰ {formatCourseTime(course)}</span>}
        </div>

        <ReasonSection reason={course.recommendationReason} />

        <div className="detail-desc">
          <div className="detail-desc-label">先修條件</div>
          <p>{course.prerequisites === null
            ? '尚未取得官方先修資料'
            : (Array.isArray(course.prerequisites)
              ? course.prerequisites.join('、') || '無'
              : String(course.prerequisites))}</p>
        </div>

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