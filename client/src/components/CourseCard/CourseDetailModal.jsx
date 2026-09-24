import { formatCourseTime } from '../../utils/courseTime';
import { Heart, Plus, X } from 'lucide-react';
import { formatCourseGradeLevel } from '../../utils/courseGradeLevel';

// 課程詳情彈窗（含推薦理由與互動按鈕）
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
        {reason.reviewEvidence ? `${reason.reviewEvidence.reviewCount} 則評價` : '這門課沒有評價資料'}
        {EASINESS_LABELS[reason.easinessSource] ? `（${EASINESS_LABELS[reason.easinessSource]}）` : ''}
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

export default function CourseDetailModal({ 
  course, 
  onClose, 
  onRemove, 
  showTime = true,
  isWatched = false,
  isAdded = false,
  onToggleWatchlist,
  onToggleCourse,
  validating = false,
  watchlistUpdating = false
}) {
  if (!course) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxHeight: '90vh', overflowY: 'auto' }}>
        <button className="modal-close" onClick={onClose}>✕</button>
        <h2 style={{ fontSize: '1.3rem', marginBottom: '8px' }}>{course.name}</h2>
        <span className="detail-code">{course.code}</span>
        <div className="detail-meta">
          <span>👤 {course.instructor}</span>
          <span>📚 {course.credits} 學分</span>
          <span>🎓 {formatCourseGradeLevel(course.gradeLevel)}</span>
          {showTime && <span>📍 {course.location}</span>}
          {showTime && <span>⏰ {formatCourseTime(course)}</span>}
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

        {/* 修正：彈窗底部的互動按鈕列，保證按鈕比例 1:1 */}
        <div style={{ display: 'flex', gap: '12px', marginTop: '24px', paddingTop: '16px', borderTop: '1px solid var(--border-color, #e5e7eb)' }}>
          {onToggleWatchlist && (
            <button
              type="button"
              className={`course-card-action ${isWatched ? 'active' : ''}`}
              onClick={(e) => onToggleWatchlist(e, course)}
              disabled={watchlistUpdating}
              style={{ flex: 1, padding: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', borderRadius: '6px', cursor: 'pointer', border: '1px solid #d1d5db', backgroundColor: isWatched ? '#fee2e2' : 'transparent', color: isWatched ? '#ef4444' : 'inherit' }}
            >
              <Heart size={16} fill={isWatched ? 'currentColor' : 'none'} />
              {watchlistUpdating ? '更新中…' : (isWatched ? '已關注' : '加入關注')}
            </button>
          )}

          {onToggleCourse && (
            <button
              type="button"
              className={`course-card-action ${isAdded ? 'danger' : 'primary'}`}
              onClick={(e) => onToggleCourse(e, course)}
              disabled={validating && !isAdded}
              style={{ flex: 1, padding: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', borderRadius: '6px', cursor: 'pointer' }}
            >
              {isAdded ? <><X size={16} /> 取消加選</> : <><Plus size={16} /> {validating ? '驗證中…' : '加入課表'}</>}
            </button>
          )}

          {onRemove && !onToggleCourse && (
            <button
              type="button"
              onClick={() => onRemove(course)}
              style={{ flex: 1, padding: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', borderRadius: '6px', cursor: 'pointer', border: '1px solid #ef4444', backgroundColor: 'transparent', color: '#ef4444' }}
            >
              <X size={16} /> 從課表移除
            </button>
          )}
        </div>
      </div>
    </div>
  );
}