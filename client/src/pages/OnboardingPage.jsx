import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/useAuth';
import { privacyAPI } from '../services/api';
import { ShieldCheck, Loader2 } from 'lucide-react';

export default function OnboardingPage() {
  const navigate = useNavigate();
  const { markOnboarded, logout } = useAuth();
  
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [consents, setConsents] = useState({
    necessary: true,
    personalized: false,
    research: false,
  });
  const [personalization, setPersonalization] = useState(null);

  useEffect(() => {
    let cancelled = false;
    privacyAPI.getPersonalization()
      .then(data => {
        if (!cancelled && data) {
          setPersonalization(data);
          if (data.consents) {
            setConsents({
              necessary: data.consents.necessary ?? true,
              personalized: data.consents.personalized ?? false,
              research: data.consents.research ?? false,
            });
          }
        }
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  const handleCheckboxChange = (key) => {
    if (key === 'necessary') return;
    setConsents(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const handleAgreeAndSetup = async () => {
    setSaving(true);
    try {
      await privacyAPI.updateConsents(consents);
      markOnboarded();
      navigate('/setup');
    } catch (err) {
      console.error('Failed to update consents:', err);
      markOnboarded();
      navigate('/setup');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="onboarding-page" id="onboarding-page" style={{ 
      minHeight: '100vh', 
      display: 'flex', 
      alignItems: 'center', 
      justifyContent: 'center', 
      backgroundColor: '#f8fafc',
      padding: '24px'
    }}>
      <div className="onboarding-card animate-fadeInUp" style={{ 
        maxWidth: '720px', 
        width: '100%', 
        background: '#ffffff', 
        padding: '36px 40px', 
        borderRadius: '20px', 
        boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.05), 0 8px 10px -6px rgba(0, 0, 0, 0.05)',
        border: '1px solid #e2e8f0'
      }}>
        
        {/* 頂部標題區 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px', marginBottom: '28px', borderBottom: '1px solid #f1f5f9', paddingBottom: '16px' }}>
          <div style={{ padding: '10px', background: '#eff6ff', borderRadius: '12px', color: '#3b82f6', display: 'flex' }}>
            <ShieldCheck size={26} />
          </div>
          <div>
            <h1 className="onboarding-title" style={{ fontSize: '1.25rem', fontWeight: '700', color: '#1e293b', margin: 0 }}>隱私與資料使用</h1>
            <span style={{ fontSize: '0.8rem', color: '#64748b' }}>政策版本：2026-08-30.v2</span>
          </div>
        </div>

        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '50px' }}>
            <Loader2 size={36} className="spin-animation" style={{ color: '#3b82f6' }} />
          </div>
        ) : (
          <div className="onboarding-body" style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            
            {/* 項目 1：必要 */}
            <div style={{ padding: '16px 20px', borderRadius: '12px', border: '1px solid #e2e8f0', background: '#f8fafc', transition: 'all 0.2s' }}>
              <label style={{ display: 'flex', alignItems: 'flex-start', gap: '14px', cursor: 'not-allowed' }}>
                <input type="checkbox" checked={consents.necessary} disabled style={{ marginTop: '4px', width: '16px', height: '16px', accentColor: '#3b82f6' }} />
                <div style={{ textAlign: 'left' }}>
                  <strong style={{ fontSize: '0.95rem', color: '#1e293b' }}>提供排課與 AI 對話服務 (必要)</strong>
                  <p style={{ fontSize: '0.85rem', color: '#64748b', margin: '4px 0 0 0', lineHeight: '1.4' }}>
                    使用 Profile、修課歷史、偏好、已存課表及近期對話，提供排課、畢業檢核與對話連續性。
                  </p>
                </div>
              </label>
            </div>

            {/* 項目 2：個人化 */}
            <div style={{ padding: '16px 20px', borderRadius: '12px', border: '1px solid #e2e8f0', background: '#ffffff', transition: 'all 0.2s' }}>
              <label style={{ display: 'flex', alignItems: 'flex-start', gap: '14px', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={consents.personalized}
                  onChange={() => handleCheckboxChange('personalized')}
                  style={{ marginTop: '4px', width: '16px', height: '16px', accentColor: '#3b82f6', cursor: 'pointer' }}
                />
                <div style={{ textAlign: 'left' }}>
                  <strong style={{ fontSize: '0.95rem', color: '#1e293b' }}>從互動持續改善個人化 (可選)</strong>
                  <p style={{ fontSize: '0.85rem', color: '#64748b', margin: '4px 0 0 0', lineHeight: '1.4' }}>
                    允許未來的互動事件與學習紀錄使用你的操作回饋。
                  </p>
                </div>
              </label>
            </div>

            {/* 項目 3：匿名研究 */}
            <div style={{ padding: '16px 20px', borderRadius: '12px', border: '1px solid #e2e8f0', background: '#ffffff', transition: 'all 0.2s' }}>
              <label style={{ display: 'flex', alignItems: 'flex-start', gap: '14px', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={consents.research}
                  onChange={() => handleCheckboxChange('research')}
                  style={{ marginTop: '4px', width: '16px', height: '16px', accentColor: '#3b82f6', cursor: 'pointer' }}
                />
                <div style={{ textAlign: 'left' }}>
                  <strong style={{ fontSize: '0.95rem', color: '#1e293b' }}>匿名彙總研究 (可選)</strong>
                  <p style={{ fontSize: '0.85rem', color: '#64748b', margin: '4px 0 0 0', lineHeight: '1.4' }}>
                    允許將符合門檻的彙總統計用於研究；不匯出逐筆事件或完整修課歷史。
                  </p>
                </div>
              </label>
            </div>

            {/* 個人化來源狀態提示 */}
            {personalization && (
              <div style={{ padding: '14px 18px', borderRadius: '12px', background: '#eff6ff', border: '1px solid #bfdbfe', fontSize: '0.85rem', color: '#1e40af', textAlign: 'left' }}>
                <strong>目前個人化來源：</strong> {personalization.label || '未啟用個人化學習'}
              </div>
            )}

            {/* 底部操作按鈕 */}
            <div style={{ display: 'flex', flexDirection: 'column', width: '100%', gap: '12px', marginTop: '20px' }}>
              <button
                className="onboarding-btn"
                onClick={handleAgreeAndSetup}
                disabled={saving}
                id="onboarding-agree-btn"
                style={{ 
                  width: '100%', 
                  margin: 0, 
                  padding: '14px', 
                  borderRadius: '10px', 
                  fontSize: '1rem', 
                  fontWeight: '600', 
                  backgroundColor: '#3b82f6', 
                  color: '#fff', 
                  border: 'none', 
                  cursor: 'pointer',
                  boxShadow: '0 4px 12px rgba(59, 130, 246, 0.3)',
                  transition: 'background-color 0.2s'
                }}
              >
                {saving ? '儲存中...' : '同意並開始設定 ✨'}
              </button>

              <div style={{ height: '1px', backgroundColor: '#e2e8f0', width: '100%', margin: '6px 0' }} />

              <button
                onClick={() => {
                  logout();
                  window.location.href = '/login';
                }}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: '#64748b',
                  cursor: 'pointer',
                  fontSize: '0.9rem',
                  padding: '6px',
                  textDecoration: 'underline'
                }}
              >
                切換帳號 (重新登入)
              </button>
            </div>

          </div>
        )}
      </div>
    </div>
  );
}