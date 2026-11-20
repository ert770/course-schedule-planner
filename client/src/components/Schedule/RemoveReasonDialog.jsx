import { useState } from 'react';
import { X, AlertCircle } from 'lucide-react';

// 剛好 8 個符合實際情境的退選原因
const CUSTOM_REMOVAL_REASONS = [
  { value: 'content', label: '課程內容不合興趣或期望' },
  { value: 'workload', label: '作業或學業負擔太重' },
  { value: 'instructor', label: '授課風格或教師因素' },
  { value: 'difficulty', label: '課程難度過高' },
  { value: 'schedule_preference', label: '想更換其他更好的課程（志願變更）' },
  { value: 'location', label: '上課地點或遠距考量不便' },
  { value: 'credits_limit', label: '學分修習上限或畢業學分考量' },
  { value: 'other', label: '其他個人因素' },
];

export default function RemoveReasonDialog({ course, onCancel, onConfirm }) {
  // 支援複選退選原因
  const [selectedReasons, setSelectedReasons] = useState([]);

  if (!course) return null;

  const handleCancel = () => {
    setSelectedReasons([]);
    onCancel();
  };

  const handleToggleOption = (value) => {
    setSelectedReasons(prev => {
      if (prev.includes(value)) {
        return prev.filter(item => item !== value);
      }
      return [...prev, value];
    });
  };

  const handleSubmit = () => {
    if (selectedReasons.length === 0) return; // 防呆安全防線
    const priorityOrder = ['content', 'workload', 'instructor', 'schedule_preference'];
    const primaryReason = priorityOrder.find(p => selectedReasons.includes(p)) || selectedReasons[0] || null;
    onConfirm(primaryReason, selectedReasons);
    setSelectedReasons([]);
  };

  // 防呆狀態判斷：必須至少選一項
  const isSubmittable = selectedReasons.length > 0;

  return (
    <div
      onClick={handleCancel}
      style={{
        position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh',
        backgroundColor: 'rgba(15, 23, 42, 0.55)', backdropFilter: 'blur(3px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10000,
        animation: 'fadeIn 0.2s ease-out'
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          backgroundColor: '#ffffff', width: '680px', maxWidth: '92vw',
          borderRadius: '20px', boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
          overflow: 'hidden', display: 'flex', flexDirection: 'column',
          border: '1px solid rgba(226, 232, 240, 0.8)'
        }}
      >
        {/* 標題列 */}
        <div style={{ padding: '20px 28px', borderBottom: '1px solid #f1f5f9', display: 'flex', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#f8fafc' }}>
          <div>
            <h3 style={{ fontSize: '1.15rem', fontWeight: '700', margin: 0, color: '#1e293b', letterSpacing: '-0.01em' }}>從課表移除課程</h3>
            <span style={{ fontSize: '0.85rem', color: '#64748b', marginTop: '2px', display: 'block' }}>
              正在移除：<strong style={{ color: '#334155' }}>{course.name}</strong> ({course.code})
            </span>
          </div>
          <button 
            type="button" 
            onClick={handleCancel} 
            aria-label="關閉" 
            style={{ background: '#e2e8f0', border: 'none', borderRadius: '50%', width: '32px', height: '32px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: '#475569', transition: 'background 0.2s' }}
            onMouseOver={(e) => e.currentTarget.style.background = '#cbd5e1'}
            onMouseOut={(e) => e.currentTarget.style.background = '#e2e8f0'}
          >
            <X size={18} />
          </button>
        </div>

        {/* 內容區：8 個選項與動態防呆提示 */}
        <div style={{ padding: '24px 28px', display: 'flex', flexDirection: 'column', gap: '16px', maxHeight: '60vh', overflowY: 'auto' }}>
          <div style={{ 
            display: 'flex', alignItems: 'center', gap: '10px', 
            color: isSubmittable ? '#334155' : '#991b1b', 
            background: isSubmittable ? '#eff6ff' : '#fef2f2', 
            border: `1px solid ${isSubmittable ? '#dbeafe' : '#fecaca'}`, 
            padding: '12px 16px', borderRadius: '12px', fontSize: '0.88rem',
            transition: 'all 0.2s ease'
          }}>
            <AlertCircle size={18} style={{ flexShrink: 0, color: isSubmittable ? '#3b82f6' : '#ef4444' }} />
            <span>
              {isSubmittable 
                ? '已選擇退選原因，可點擊下方按鈕確認移除。' 
                : '【防呆提示】為協助系統演算法優化推薦，請至少勾選一項退選原因才能進行移除。'}
            </span>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '10px' }}>
            {CUSTOM_REMOVAL_REASONS.map(option => {
              const isSelected = selectedReasons.includes(option.value);
              return (
                <label 
                  key={option.value} 
                  style={{
                    display: 'flex', alignItems: 'center', gap: '12px', padding: '12px 16px',
                    borderRadius: '12px', border: `1.5px solid ${isSelected ? '#3b82f6' : '#e2e8f0'}`,
                    backgroundColor: isSelected ? '#eff6ff' : '#ffffff', cursor: 'pointer', transition: 'all 0.2s ease',
                    boxShadow: isSelected ? '0 4px 12px rgba(59, 130, 246, 0.08)' : '0 1px 2px rgba(0,0,0,0.02)'
                  }}
                  onMouseOver={(e) => { if (!isSelected) e.currentTarget.style.borderColor = '#cbd5e1'; }}
                  onMouseOut={(e) => { if (!isSelected) e.currentTarget.style.borderColor = '#e2e8f0'; }}
                >
                  <input
                    type="checkbox"
                    name="course-removal-reason"
                    value={option.value}
                    checked={isSelected}
                    onChange={() => handleToggleOption(option.value)}
                    style={{ width: '18px', height: '18px', accentColor: '#3b82f6', cursor: 'pointer', flexShrink: 0, borderRadius: '4px' }}
                  />
                  <span style={{ fontSize: '0.9rem', fontWeight: isSelected ? '600' : '500', color: isSelected ? '#1e40af' : '#334155', lineHeight: '1.3' }}>
                    {option.label}
                  </span>
                </label>
              );
            })}
          </div>
        </div>

        {/* 底部按鈕區：包含防呆禁用狀態 */}
        <div style={{ padding: '16px 28px', borderTop: '1px solid #f1f5f9', display: 'flex', justifyContent: 'flex-end', gap: '12px', backgroundColor: '#f8fafc' }}>
          <button 
            type="button" 
            onClick={handleCancel} 
            style={{ padding: '10px 20px', borderRadius: '10px', background: '#e2e8f0', color: '#475569', border: 'none', fontWeight: '600', fontSize: '0.9rem', cursor: 'pointer', transition: 'background 0.2s' }}
            onMouseOver={(e) => e.currentTarget.style.background = '#cbd5e1'}
            onMouseOut={(e) => e.currentTarget.style.background = '#e2e8f0'}
          >
            取消
          </button>
          <button 
            type="button" 
            onClick={handleSubmit} 
            disabled={!isSubmittable}
            style={{ 
              padding: '10px 24px', borderRadius: '10px', 
              background: isSubmittable ? '#ef4444' : '#cbd5e1', 
              color: '#fff', border: 'none', fontWeight: '600', fontSize: '0.9rem', 
              cursor: isSubmittable ? 'pointer' : 'not-allowed', 
              boxShadow: isSubmittable ? '0 4px 12px rgba(239, 68, 68, 0.25)' : 'none', 
              opacity: isSubmittable ? 1 : 0.7,
              transition: 'all 0.2s' 
            }}
          >
            確認移除
          </button>
        </div>
      </div>
    </div>
  );
}