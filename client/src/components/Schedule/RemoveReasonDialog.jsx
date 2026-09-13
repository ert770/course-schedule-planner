import { useState, useEffect } from 'react';

// 退課原因清單 (之後若心樂決定修改文字，直接在這裡改陣列內容即可)
const REASONS = [
  '想保留空堂',
  '有更想優先排入的課程',
  '課程內容不感興趣',
  '授課教師因素',
  '課業負擔太重',
  '不符修課資格',
  '其他原因'
];

export default function RemoveReasonDialog({ course, onCancel, onConfirm }) {
  // 使用陣列來儲存多個選中的原因
  const [selectedReasons, setSelectedReasons] = useState([]);

  // 當開啟新視窗（傳入新的 course）時，清空上一次的選項
  useEffect(() => {
    setSelectedReasons([]);
  }, [course]);

  if (!course) return null;

  // 處理點擊選項的切換邏輯 (Toggle)
  const toggleReason = (reason) => {
    setSelectedReasons(prev => 
      prev.includes(reason) 
        ? prev.filter(r => r !== reason) // 如果已選，則移除
        : [...prev, reason]              // 如果未選，則加入
    );
  };

  const handleConfirm = () => {
    // 將選中的原因陣列組合成字串（例如："人數已滿, 其他原因"）傳給上層，
    // 也可以依據後端需求直接傳陣列。這裡先用逗號分隔字串。
    onConfirm(selectedReasons.join(', '));
  };

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: '420px', padding: '24px' }}>
        <h2 style={{ fontSize: '1.25rem', marginBottom: '8px', color: 'var(--text-primary, #111827)' }}>
          移除「{course.name}」
        </h2>
        <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary, #6b7280)', marginBottom: '20px', lineHeight: '1.5' }}>
          告訴我們原因，之後的推薦才不會把「排不進去」當成「你不喜歡」：
        </p>
        
        {/* 選項網格 (複選) */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '24px' }}>
          {REASONS.map(reason => {
            const isSelected = selectedReasons.includes(reason);
            return (
              <button
                key={reason}
                type="button"
                onClick={() => toggleReason(reason)}
                style={{
                  padding: '10px 8px',
                  borderRadius: '6px',
                  border: `1px solid ${isSelected ? 'var(--accent-blue, #3b82f6)' : '#d1d5db'}`,
                  backgroundColor: isSelected ? '#eff6ff' : 'transparent',
                  color: isSelected ? 'var(--accent-blue, #3b82f6)' : '#374151',
                  cursor: 'pointer',
                  fontSize: '0.85rem',
                  textAlign: 'center',
                  transition: 'all 0.15s ease-in-out',
                  fontWeight: isSelected ? '600' : '400'
                }}
              >
                {reason}
              </button>
            );
          })}
        </div>

        {/* 底部操作按鈕：取消與確認 */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
          <button 
            type="button"
            onClick={onCancel}
            style={{ 
              padding: '8px 16px', 
              border: 'none', 
              background: 'transparent', 
              color: '#6b7280', 
              cursor: 'pointer',
              fontSize: '0.95rem'
            }}
          >
            取消
          </button>
          <button 
            type="button"
            onClick={handleConfirm}
            // 防呆：如果都沒選，就不給按確認 (或者你可以拿掉 disabled 允許不選)
            disabled={selectedReasons.length === 0}
            style={{ 
              padding: '8px 16px', 
              borderRadius: '6px', 
              backgroundColor: selectedReasons.length === 0 ? '#d1d5db' : 'var(--accent-blue, #3b82f6)', 
              color: '#fff', 
              border: 'none', 
              cursor: selectedReasons.length === 0 ? 'not-allowed' : 'pointer',
              fontSize: '0.95rem',
              fontWeight: '600'
            }}
          >
            確認移除
          </button>
        </div>
      </div>
    </div>
  );
}