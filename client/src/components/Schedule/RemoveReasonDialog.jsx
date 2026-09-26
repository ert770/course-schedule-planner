import { useState } from 'react';
import { X, AlertCircle } from 'lucide-react';

const REASON_OPTIONS = [
  { id: 'interest', label: '對該課程主題興趣不高' },
  { id: 'workload', label: '作業、報告或考試負擔太重' },
  { id: 'instructor', label: '授課風格或教師評價不符合期待' },
  { id: 'difficulty', label: '課程難度過高或先修能力不足' },
  { id: 'schedule_slot', label: '上課時段雖無衝堂但個人時間安排不理想' },
  { id: 'credits', label: '學分數與預期學分規劃不符' },
  { id: 'redundant', label: '課程內容與其他已修或排入課程高度重複' },
  { id: 'other', label: '其他個人因素（如職涯方向調整等）' },
];

export default function RemoveReasonDialog({ course, onCancel, onConfirm }) {
  const [selectedReasons, setSelectedReasons] = useState(new Set());

  if (!course) return null;

  const handleToggle = (id) => {
    const next = new Set(selectedReasons);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedReasons(next);
  };

  const handleSubmit = () => {
    onConfirm([...selectedReasons]);
    setSelectedReasons(new Set());
  };

  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh',
      backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2000
    }}>
      {/* 調整為寬一點、高度精簡的對話框 */}
      <div style={{
        backgroundColor: '#ffffff', width: '650px', maxWidth: '90vw',
        borderRadius: '16px', boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1)', overflow: 'hidden', display: 'flex', flexDirection: 'column'
      }}>
        {/* 標題列 */}
        <div style={{ padding: '16px 24px', borderBottom: '1px solid #e5e7eb', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h3 style={{ fontSize: '1.05rem', fontWeight: '700', margin: 0, color: '#1e293b' }}>從課表移除課程</h3>
            <span style={{ fontSize: '0.8rem', color: '#64748b' }}>正在移除：{course.name} ({course.code})</span>
          </div>
          <button onClick={onCancel} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#6b7280' }}>
            <X size={18} />
          </button>
        </div>

        {/* 內容區塊：改為兩欄式或緊湊排列，減少縱向高度 */}
        <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: '12px', maxHeight: '60vh', overflowY: 'auto' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#d97706', background: '#fef3c7', padding: '10px 14px', borderRadius: '8px', fontSize: '0.85rem' }}>
            <AlertCircle size={16} style={{ flexShrink: 0 }} />
            <span>請勾選您不想修這門課的原因（可複選，無衝堂選項）：</span>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '8px' }}>
            {REASON_OPTIONS.map(option => {
              const isChecked = selectedReasons.has(option.id);
              return (
                <label key={option.id} style={{
                  display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 12px',
                  borderRadius: '8px', border: `1px solid ${isChecked ? '#3b82f6' : '#e2e8f0'}`,
                  backgroundColor: isChecked ? '#eff6ff' : '#f8fafc', cursor: 'pointer', transition: 'all 0.2s'
                }}>
                  <input
                    type="checkbox"
                    checked={isChecked}
                    onChange={() => handleToggle(option.id)}
                    style={{ width: '15px', height: '15px', accentColor: '#3b82f6', cursor: 'pointer' }}
                  />
                  <span style={{ fontSize: '0.85rem', fontWeight: isChecked ? '600' : '400', color: isChecked ? '#1e40af' : '#334155', lineHeight: '1.2' }}>
                    {option.label}
                  </span>
                </label>
              );
            })}
          </div>
        </div>

        {/* 底部按鈕區：拿掉「並回報演算法」，改用柔和的紅色 */}
        <div style={{ padding: '14px 24px', borderTop: '1px solid #e5e7eb', display: 'flex', justifyContent: 'flex-end', gap: '10px', backgroundColor: '#f8fafc' }}>
          <button onClick={onCancel} style={{ padding: '8px 16px', borderRadius: '8px', background: '#e2e8f0', color: '#475569', border: 'none', fontWeight: '600', fontSize: '0.9rem', cursor: 'pointer' }}>
            取消
          </button>
          <button onClick={handleSubmit} style={{ padding: '8px 20px', borderRadius: '8px', background: '#ef4444', color: '#fff', border: 'none', fontWeight: '600', fontSize: '0.9rem', cursor: 'pointer', boxShadow: '0 2px 4px rgba(239, 68, 68,.2)' }}>
            確認移除
          </button>
        </div>
      </div>
    </div>
  );
}