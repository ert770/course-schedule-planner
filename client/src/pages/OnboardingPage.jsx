import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/useAuth';
import { Bot } from 'lucide-react';

export default function OnboardingPage() {
  const navigate = useNavigate();
  const { markOnboarded, logout } = useAuth();

  const handleAgree = () => {
    markOnboarded();
    navigate('/setup');
  };

  return (
    <div className="onboarding-page" id="onboarding-page">
      <div className="onboarding-card animate-fadeInUp">
        <div className="onboarding-icon">
          <Bot size={36} />
        </div>
        <h1 className="onboarding-title">歡迎使用逢甲專屬排課 Agent</h1>

        <div className="onboarding-body">
          <p className="onboarding-desc">
            為了幫您量身打造最適合的課表，我們需要了解您的修課背景。
          </p>
          <p className="onboarding-privacy">
            你的資料會依隱私中心中已同意的用途處理；可選的個人化學習與研究預設關閉。
          </p>
        </div>

        {/* 調整後的動作區域：直立堆疊、加大間距與視覺層級 */}
        <div style={{ display: 'flex', flexDirection: 'column', width: '100%', gap: '12px', marginTop: '24px' }}>
          <button
            className="onboarding-btn"
            onClick={handleAgree}
            id="onboarding-agree-btn"
            style={{ width: '100%', margin: 0 }}
          >
            同意並開始設定
          </button>

          <div style={{ height: '1px', backgroundColor: 'var(--border-color, #e5e7eb)', width: '100%', margin: '4px 0' }} />

          <button
            onClick={() => {
              logout();
              window.location.href = '/login';
            }}
            style={{
              background: 'transparent',
              border: 'none',
              color: '#6b7280',
              cursor: 'pointer',
              fontSize: '0.9rem',
              padding: '6px',
              textDecoration: 'none',
              transition: 'color 0.2s'
            }}
            onMouseEnter={(e) => e.target.style.color = '#374151'}
            onMouseLeave={(e) => e.target.style.color = '#6b7280'}
          >
            切換帳號 (重新登入)
          </button>
        </div>
      </div>
    </div>
  );
}
