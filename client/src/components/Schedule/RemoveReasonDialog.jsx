import { useState } from 'react';
import { X, AlertCircle } from 'lucide-react';
import { REMOVAL_REASONS } from '../../services/interactionLog';

export default function RemoveReasonDialog({ course, onCancel, onConfirm }) {
  const [selectedReason, setSelectedReason] = useState('');

if (!course) return null;

  const handleCancel = () => {
    setSelectedReason('');
    onCancel();
  };

  const handleSubmit = () => {
    onConfirm(selectedReason || null);
    setSelectedReason('');
  };

  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh',
      backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2000
    }}>
      <div style={{
        backgroundColor: '#ffffff', width: '650px', maxWidth: '90vw',
        borderRadius: '16px', boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1)', overflow: 'hidden', display: 'flex', flexDirection: 'column'
      }}>
        <div style={{ padding: '16px 24px', borderBottom: '1px solid #e5e7eb', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h3 style={{ fontSize: '1.05rem', fontWeight: '700', margin: 0, color: '#1e293b' }}>從課表移除課程</h3>
            <span style={{ fontSize: '0.8rem', color: '#64748b' }}>正在移除：{course.name} ({course.code})</span>
          </div>
          <button type="button" onClick={handleCancel} aria-label="關閉" style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#6b7280' }}>
            <X size={18} />
          </button>
        </div>

        <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: '12px', maxHeight: '60vh', overflowY: 'auto' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#475569', background: '#f1f5f9', padding: '10px 14px', borderRadius: '8px', fontSize: '0.85rem' }}>
            <AlertCircle size={16} style={{ flexShrink: 0 }} />
            <span>提供移除原因為選填；未提供原因不影響移除課程。</span>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '8px' }}>
            {[...REMOVAL_REASONS, { value: '', label: '不提供原因' }].map(option => {
              const isSelected = selectedReason === option.value;
              return (
                <label key={option.value || 'no-reason'} style={{
                  display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 12px',
                  borderRadius: '8px', border: '1px solid ' + (isSelected ? '#3b82f6' : '#e2e8f0'),
                  backgroundColor: isSelected ? '#eff6ff' : '#f8fafc', cursor: 'pointer', transition: 'all 0.2s'
                }}>
                  <input
                    type="radio"
                    name="course-removal-reason"
                    value={option.value}
                    checked={isSelected}
                    onChange={() => setSelectedReason(option.value)}
                    style={{ width: '15px', height: '15px', accentColor: '#3b82f6', cursor: 'pointer' }}
                  />
                  <span style={{ fontSize: '0.85rem', fontWeight: isSelected ? '600' : '400', color: isSelected ? '#1e40af' : '#334155', lineHeight: '1.2' }}>
                    {option.label}
                  </span>
                </label>
              );
            })}
          </div>
        </div>

        <div style={{ padding: '14px 24px', borderTop: '1px solid #e5e7eb', display: 'flex', justifyContent: 'flex-end', gap: '10px', backgroundColor: '#f8fafc' }}>
          <button type="button" onClick={handleCancel} style={{ padding: '8px 16px', borderRadius: '8px', background: '#e2e8f0', color: '#475569', border: 'none', fontWeight: '600', fontSize: '0.9rem', cursor: 'pointer' }}>
            取消
          </button>
          <button type="button" onClick={handleSubmit} style={{ padding: '8px 20px', borderRadius: '8px', background: '#ef4444', color: '#fff', border: 'none', fontWeight: '600', fontSize: '0.9rem', cursor: 'pointer', boxShadow: '0 2px 4px rgba(239, 68, 68,.2)' }}>
            確認移除
          </button>
        </div>
      </div>
    </div>
  );
}