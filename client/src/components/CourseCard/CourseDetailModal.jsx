import { formatCourseTime } from '../../utils/courseTime';
import { formatCourseGradeLevel } from '../../utils/courseGradeLevel';
import { formatCoursePrerequisites } from '../../utils/coursePrerequisites';
import { withoutRepeatedCourseTitle } from '../../utils/courseDescription';

const descriptionSegmenter = typeof Intl.Segmenter === 'function'
  ? new Intl.Segmenter('zh-Hant', { granularity: 'sentence' })
  : null;

function CourseDescription({ description }) {
  const text = typeof description === 'string' ? description.trim() : '';
  if (!text) return null;

  const paragraphs = text.split(/\r\n?|\n/u).flatMap(line => {
    const paragraph = line.trim();
    if (!paragraph) return [];
    if (paragraph.length < 100 || !descriptionSegmenter) return [paragraph];
    return Array.from(descriptionSegmenter.segment(paragraph), ({ segment }) => segment.trim()).filter(Boolean);
  });

  return (
    <div className="detail-desc">
      <div className="detail-desc-label"><strong>課程說明</strong></div>
      <div className="course-description">
        {paragraphs.map((paragraph, index) => <p key={index}>{paragraph}</p>)}
      </div>
    </div>
  );
}

const SELECTION_LABELS = {
  REQUIRED_COURSE: '這是你的必修課',
  RETAKE_REQUIRED: '這是需要重補修的必修',
  USER_SPECIFIED: '你指定要修這門課',
  COREQUISITE_PAIR: '它與同名正課必須一起修',
  PREFERENCE_MATCH: '它符合你的偏好',
  CREDIT_FILL: '用來補足學分',
  WATCHING: '你把它加入關注',
};

// 「為什麼推薦這門課」只列這門課符合的興趣與偏好（2026-11-27 使用者決定：
// 分數、評價筆數與「它勝過」對使用者沒有幫助，拿掉）。
function ReasonSection({ reason }) {
  if (!reason || Object.keys(reason).length === 0 || !reason.selectedBecause) return null;

  const matched = Array.isArray(reason.matchedPreferences) ? reason.matchedPreferences : [];
  const unique = items => [...new Set(items.map(item => item.label).filter(Boolean))];
  const interests = unique(matched.filter(item => item.type === 'interest'));
  const preferences = unique(matched.filter(item => item.type !== 'interest'));
  const showHeadline = reason.selectedBecause !== 'PREFERENCE_MATCH';

  if (!showHeadline && interests.length === 0 && preferences.length === 0) return null;

  return (
    <div className="detail-reason">
      <div className="detail-desc-label">為什麼推薦這門課</div>
      {showHeadline && (
        <p className="reason-headline">{SELECTION_LABELS[reason.selectedBecause] || '依排課結果選入'}</p>
      )}
      {interests.length > 0 && (
        <p className="reason-line"><strong>符合你的興趣：</strong>{interests.join('、')}</p>
      )}
      {preferences.length > 0 && (
        <p className="reason-line"><strong>符合你的偏好：</strong>{preferences.join('、')}</p>
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
          <div className="detail-desc-label"><strong>先修條件</strong></div>
          <p>{formatCoursePrerequisites(course.prerequisites)}</p>
        </div>

        <CourseDescription description={withoutRepeatedCourseTitle(course.description, course.name)} />

        {onRemove && (
          <button
            className="action-btn secondary modal-remove-course"
            onClick={() => {
              onClose(); // 同步關閉詳細資訊視窗，讓退選原因對話框彈出流暢無卡頓
              onRemove(course);
            }}
          >
            從課表移除
          </button>
        )}
      </div>
    </div>
  );
}
