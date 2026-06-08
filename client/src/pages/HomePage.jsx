import { useNavigate } from 'react-router-dom';
import { Calendar, MessageCircle, Star, Zap } from 'lucide-react';

export default function HomePage() {
  const navigate = useNavigate();

  return (
    <div className="home-page" id="home-page">
      <div className="hero-section">
        <h1 className="hero-title">智慧排課<br />從此輕鬆</h1>
        <p className="hero-subtitle">
          透過 AI 驅動的個人化課表規劃系統，自動產生無衝突最佳課表。
          輸入你的需求，讓 Agent 幫你搞定一切。
        </p>
        <div className="hero-actions">
          <button
            className="btn-primary"
            onClick={() => navigate('/schedule')}
            style={{ padding: '14px 32px', fontSize: '1rem' }}
            id="start-planning-btn"
          >
            🚀 開始排課
          </button>
          <button
            className="btn-secondary"
            onClick={() => navigate('/profile')}
            style={{ padding: '14px 32px', fontSize: '1rem' }}
            id="set-preferences-btn"
          >
            ⚙️ 設定偏好
          </button>
        </div>
      </div>

      <div className="features-grid">
        <div className="feature-card">
          <div className="feature-icon blue">
            <MessageCircle size={24} />
          </div>
          <h3>自然語言對話</h3>
          <p>
            直接用中文告訴我你的需求，例如「幫我排課表，不要早八，想修機器學習」，
            AI 會理解你的意圖並自動執行。
          </p>
        </div>

        <div className="feature-card">
          <div className="feature-icon purple">
            <Calendar size={24} />
          </div>
          <h3>CSP 智慧排課</h3>
          <p>
            採用「限制滿足問題」(CSP) 演算法，結合回溯搜尋與 MRV 啟發式策略，
            自動產出無衝突的最佳化課表。
          </p>
        </div>

        <div className="feature-card">
          <div className="feature-icon pink">
            <Star size={24} />
          </div>
          <h3>評價與涼度分析</h3>
          <p>
            整合課程評價資訊，提供涼度排名、好評率、難度評分，
            幫你找到最適合的課程選擇。
          </p>
        </div>

        <div className="feature-card">
          <div className="feature-icon emerald">
            <Zap size={24} />
          </div>
          <h3>個人化推薦</h3>
          <p>
            記住你的偏好設定（已修學分、時段限制、興趣領域），
            每次排課都更懂你的需求。
          </p>
        </div>
      </div>
    </div>
  );
}
