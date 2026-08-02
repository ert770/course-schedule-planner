import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/useAuth';
import { Bot } from 'lucide-react';

export default function OnboardingPage() {
  const navigate = useNavigate();
  // 假設 useAuth 裡面有提供 logout 函數
  const { markOnboarded, logout } = useAuth();

  const handleAgree = () => {
    markOnboarded();
    navigate('/setup');
  };

  const handleLogout = () => {
    if (logout) {
      logout(); // 使用 context 標準作法清空狀態
    } else {
      localStorage.clear(); // 備用防呆方案
    }
    navigate('/login'); // 使用 React 路由滑順跳轉
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
            本系統僅將資料用於排課推薦，絕不外洩。
          </p>
        </div>

        {/* 加入 Actions 容器，強制內部元素垂直排列、置中、寬度撐滿 */}
        <div 
          className="onboarding-actions" 
          style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: '100%', gap: '16px' }}
        >
          <button
            className="onboarding-btn"
            onClick={handleAgree}
            id="onboarding-agree-btn"
            style={{ width: '100%' }} // 確保主按鈕寬度一致
          >
            同意並開始設定
          </button>

          <button 
            onClick={handleLogout}
            style={{
              background: 'transparent', 
              border: 'none', 
              color: '#888', 
              cursor: 'pointer', 
              fontSize: '0.85rem', 
              textDecoration: 'underline'
            }}
          >
            切換帳號 (重新登入)
          </button>
        </div>
      </div>
    </div>
  );
}