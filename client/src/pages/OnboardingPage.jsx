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

        <button
          className="onboarding-btn"
          onClick={handleAgree}
          id="onboarding-agree-btn"
        >
          同意並開始設定
        </button>

        <button 
          onClick={() => {
            logout();
            window.location.href = '/login';
          }}
          style={{
            marginTop: '16px', background: 'transparent', border: 'none', 
            color: '#888', cursor: 'pointer', fontSize: '0.85rem', textDecoration: 'underline'
          }}
        >
          切換帳號 (重新登入)
        </button>
      </div>
    </div>
  );
}
