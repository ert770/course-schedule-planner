import { X, BookOpen, Clock, User, AlertCircle, Trash2 } from 'lucide-react';
import { formatCourseTime } from '../../utils/courseTime';

// 嚴格對應五種課程類別，並給予各具特色的精緻色彩標記
const getCourseTypeBadge = (type) => {
  const normalizedType = (type || '').trim();
  
  switch (normalizedType) {
    case '必修':
      return { bg: '#fee2e2', color: '#dc2626', border: '#fecaca', label: '必修' };
    case '核心選修':
      return { bg: '#dbeafe', color: '#1d4ed8', border: '#bfdbfe', label: '核心選修' };
    case '一般選修':
      return { bg: '#e0e7ff', color: '#4338ca', border: '#c7d2fe', label: '一般選修' };
    case '系外選修':
      return { bg: '#f3e8ff', color: '#7e22ce', border: '#e9d5ff', label: '系外選修' };
    case '通識課程':
    case '通識':
      return { bg: '#d1fae5', color: '#047857', border: '#a7f3d0', label: '通識課程' };
    default:
      // 如果欄位剛好是英文或相近字串的相容處理
      if (normalizedType.includes('req') || normalizedType.includes('必修')) {
        return { bg: '#fee2e2', color: '#dc2626', border: '#fecaca', label: '必修' };
      }
      if (normalizedType.includes('核心')) {
        return { bg: '#dbeafe', color: '#1d4ed8', border: '#bfdbfe', label: '核心選修' };
      }
      if (normalizedType.includes('系外')) {
        return { bg: '#f3e8ff', color: '#7e22ce', border: '#e9d5ff', label: '系外選修' };
      }
      if (normalizedType.includes('通識')) {
        return { bg: '#d1fae5', color: '#047857', border: '#a7f3d0', label: '通識課程' };
      }
      return { bg: '#f1f5f9', color: '#475569', border: '#e2e8f0', label: normalizedType || '一般選修' };
  }
};

export default function CourseDetailModal({ course, onClose, onRemove, showTime = false }) {
  if (!course) return null;

  // 抓取課程類別（支援 requiredType 或 type 欄位）
  const badgeInfo = getCourseTypeBadge(course.requiredType || course.type || '一般選修');

  return (
    <div className="modal-backdrop animate-fadeIn" style={{
      position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh',
      backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000
    }}>
      <div className="modal-card animate-fadeInUp" style={{
        backgroundColor: 'var(--card-bg, #ffffff)', width: '650px', maxWidth: '90vw',
        borderRadius: '16px', boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1)', overflow: 'hidden', display: 'flex', flexDirection: 'column', maxHeight: '85vh'
      }}>
        {/* 頂部標題與關閉按鈕 */}
        <div style={{ padding: '20px 24px', borderBottom: '1px solid var(--border-color, #e5e7eb)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <span style={{ fontSize: '0.85rem', color: '#6b7280', fontWeight: '500' }}>{course.code}</span>
            
            {/* 課程名稱後方直接接上分類彩色標籤 */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginTop: '4px', flexWrap: 'wrap' }}>
              <h2 style={{ fontSize: '1.25rem', fontWeight: '700', margin: 0, color: 'var(--text-primary)' }}>{course.name}</h2>
              <span style={{
                backgroundColor: badgeInfo.bg,
                color: badgeInfo.color,
                border: `1px solid ${badgeInfo.border}`,
                padding: '2px 10px',
                borderRadius: '999px',
                fontSize: '0.75rem',
                fontWeight: '600',
                display: 'inline-flex',
                alignItems: 'center'
              }}>
                {badgeInfo.label}
              </span>
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#6b7280' }}>
            <X size={20} />
          </button>
        </div>

        {/* 內容區塊 */}
        <div style={{ padding: '24px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '16px' }}>
          
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '16px', fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}><User size={16}/> {course.instructor || '授課教師未定'}</span>
            <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}><BookOpen size={16}/> {course.credits || 3} 學分</span>
            {showTime && <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}><Clock size={16}/> {formatCourseTime(course)}</span>}
          </div>

          <div style={{ backgroundColor: 'var(--bg-secondary, #f9fafb)', padding: '16px', borderRadius: '10px', border: '1px solid var(--border-color, #e5e7eb)' }}>
            <h4 style={{ fontSize: '0.9rem', fontWeight: '600', margin: '0 0 6px 0', color: '#3b82f6', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <AlertCircle size={16} /> 為什麼推薦這門課？
            </h4>
            <p style={{ fontSize: '0.85rem', margin: 0, color: 'var(--text-primary)', lineHeight: '1.5' }}>
              {course.recommendReason || '它符合你的偏好，且能有效填補你的學分與專業技能需求。'}
            </p>
          </div>

          <div>
            <h4 style={{ fontSize: '0.95rem', fontWeight: '600', marginBottom: '8px' }}>課程說明</h4>
            <p style={{ fontSize: '0.9rem', color: '#4b5563', lineHeight: '1.6', margin: 0 }}>
              {course.description || '本課程著重於實務應用與核心理論，引導學生深入探索該領域之專業知識與專案實作能力。'}
            </p>
          </div>
        </div>

        {/* 底部動作列 */}
        <div style={{ padding: '16px 24px', borderTop: '1px solid var(--border-color, #e5e7eb)', display: 'flex', justifyContent: 'flex-end', backgroundColor: 'var(--bg-secondary, #f9fafb)' }}>
          <button
            onClick={() => onRemove(course)}
            style={{
              backgroundColor: '#fee2e2',
              color: '#dc2626',
              border: '1px solid #fecaca',
              padding: '10px 18px',
              borderRadius: '10px',
              fontWeight: '600',
              fontSize: '0.9rem',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              boxShadow: '0 2px 6px rgba(220, 38, 38, 0.1)',
              transition: 'all 0.2s ease'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = '#fecaca';
              e.currentTarget.style.transform = 'translateY(-1px)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = '#fee2e2';
              e.currentTarget.style.transform = 'translateY(0)';
            }}
          >
            <Trash2 size={16} /> 從課表移除
          </button>
        </div>
      </div>
    </div>
  );
}