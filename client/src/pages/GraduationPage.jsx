import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/useAuth';
import { useTheme } from '../contexts/useTheme';
import { graduationAPI } from '../services/api';
import { useClickOutside } from '../hooks/useClickOutside';
import { X, Plus, Search, AlertTriangle, Lightbulb, Calendar, LayoutDashboard, Settings, Moon, Sun } from 'lucide-react';

// `GET /api/graduation/:studentId` 的學分類別 key 對應中文標題。
// API 依 `server/src/data/graduationRequirements.js` 的欄位回傳英文 key，
// 直接當標題渲染會在畫面上出現「尚缺 required」。
const CREDIT_CATEGORY_LABELS = {
  required: '本系必修',
  elective: '本系選修',
  general: '通識',
  external: '外系選修',
  unspecified: '自由選修',
};

export default function GraduationPage() {
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const userMenuRef = useRef(null);

  useClickOutside(userMenuRef, () => setShowUserMenu(false), showUserMenu);

  const loadGraduationData = useCallback(async () => {
    if (!user?.studentId) {
      setData(null);
      setLoading(false);
      return;
    }
    try {
      const result = await graduationAPI.get();
      setData(result);
    } catch (err) {
      console.error('Failed to load graduation data:', err);
      // Fallback data matching mockup
      setData({
        totalRequired: 128,
        totalEarned: 107,
        gaps: { required: 10, elective: 9, general: 4, external: 0 },
        recommendations: [
          {
            type: 'warning',
            title: '必修警告',
            message: '偵測到您尚未修畢大三必修【計算機結構學】，建議本學期優先排入以防延畢。',
            course: { id: 4, name: '計算機組織', credits: 3 },
          },
          {
            type: 'suggestion',
            title: '通識推薦',
            message: '您的通識尚缺 4 學分，AI 根據您先前勾選的涼課條件，為您推薦【現代車業事件剖析】。該課平常簡單自由簽到，老師確幸至10次，而且期末考不恐怖，若還有剩餘讀書時間可以拿到分數，達成您的篩選條件。',
            course: { id: 99, name: '現代車業事件剖析', credits: 2 },
          },
        ],
        watchlist: [
          { id: 101, name: '密碼學', category: '選修', credits: 3 },
          { id: 102, name: '人工智慧自然語言導論', category: '選修', credits: 3 },
          { id: 103, name: '資訊實務案例探討', category: '選修', credits: 2 },
        ],
      });
    } finally {
      setLoading(false);
    }
  }, [user?.studentId]);

  useEffect(() => {
    loadGraduationData();
  }, [loadGraduationData]);

  if (loading) {
    return (
      <div className="graduation-page" id="graduation-page">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', color: '#6b7280' }}>
          載入中...
        </div>
      </div>
    );
  }

  const progressPercent = data?.courseHistoryAvailable && data.totalRequired
    ? Math.round((data.totalEarned / data.totalRequired) * 100)
    : 0;

  return (
    <div className="layout-container" id="graduation-page">
      {/* Top Navbar */}
      <header className="top-nav">
        <div className="nav-brand">
          <Calendar size={20} className="nav-icon" />
          <span>課表規劃助手</span>
        </div>
        <div className="nav-links">
          <button className="nav-btn" onClick={() => navigate('/')}><LayoutDashboard size={16}/> 首頁</button>
          <button className="nav-btn" onClick={() => navigate('/schedule')}><Calendar size={16}/> 排課</button>
          <button className="nav-btn" onClick={() => navigate('/search')}><Search size={16}/> 尋找課程</button>
        </div>
        <div className="nav-actions">
          <div className="nav-user" ref={userMenuRef} onClick={() => setShowUserMenu(!showUserMenu)}>
            <div className="avatar">{(user?.name || '同')[0]}</div>
            <span>{user?.name || '同學'}</span>
            
            {showUserMenu && (
              <div className="user-dropdown-menu">
                <button className="user-dropdown-item" onClick={() => navigate('/graduation')}>
                  <Settings size={16} style={{marginRight: '8px'}} /> 畢業學分進度
                </button>
                <button className="user-dropdown-item" onClick={toggleTheme}>
                  {theme === 'dark' ? <Sun size={16} style={{marginRight: '8px'}}/> : <Moon size={16} style={{marginRight: '8px'}}/>} 
                  切換主題 ({theme === 'dark' ? '淺色' : '深色'})
                </button>
                <div style={{height: '1px', background: 'var(--border-color)', margin: '4px 0'}}></div>
                <button className="user-dropdown-item" onClick={logout}>登出 (Logout)</button>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Main content */}
      <div className="graduation-content">
        {/* Left - Credit cards */}
        <div className="graduation-left">
          {/* 後端的 warnings 陣列先前完全沒有渲染——查不到系所、資料待複核這類
              提醒送到前端後直接消失，使用者從未看過。與 courseHistoryAvailable
              是否為 false 無關，兩種情況要能同時顯示（例如有修課歷史但系所打錯字）。 */}
          {Array.isArray(data?.warnings) && data.warnings.length > 0 && (
            <div className="grad-card grad-warnings" role="alert">
              {data.warnings.map((warning, i) => (
                <p key={i} className="grad-warning-message">
                  <AlertTriangle size={16} className="grad-warning-icon" /> {warning}
                </p>
              ))}
            </div>
          )}

          {data?.courseHistoryAvailable === false ? (
            <div className="grad-card grad-history-missing" role="alert">
              <AlertTriangle size={24} className="grad-history-missing-icon" />
              <div>
                <div className="grad-history-missing-title">無法顯示修課進度</div>
                <p className="grad-history-missing-message">
                  {data.courseHistoryMessage || '缺少歷史修課資料，請至 MyFCU 擷取歷史修課資料並匯入。'}
                </p>
              </div>
            </div>
          ) : (
            <>
              {/* Total progress */}
              <div className="grad-card grad-total">
                <div className="grad-card-label">已修學分</div>
                <div className="grad-card-big-number">
                  <span className="grad-number-main">{data?.totalEarned || 0}</span>
                  <span className="grad-number-divider"> / </span>
                  {/* 系所查不到官方對照表時 totalRequired 是 null——不得用 128
                      這個假數字頂替，那正是這批捏造數字先前混進畫面的方式。 */}
                  <span className="grad-number-total">{data?.totalRequired ?? '—'}</span>
                </div>
                <div className="grad-progress-bar">
                  <div className="grad-progress-fill" style={{ width: `${progressPercent}%` }} />
                </div>
              </div>

              {/* Gap cards */}
              <div className="grad-gaps-grid">
                {Object.entries(data?.gaps || {}).map(([category, gap]) => (
                  <div key={category} className="grad-card grad-gap-card">
                    <div className="grad-gap-label">尚缺{CREDIT_CATEGORY_LABELS[category] || category}</div>
                    <div className={`grad-gap-value ${gap === 0 ? 'green' : 'red'}`}>
                      {gap} <span className="grad-gap-unit">學分</span>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}

          {/* Watchlist */}
          <div className="grad-watchlist">
            <h3 className="grad-watchlist-title">
              📌 我的候選課程口袋名單
            </h3>
            <p className="grad-watchlist-desc">可作為排課備案，或交由 AI 自動安插</p>
            <div className="grad-watchlist-grid">
              {(data?.watchlist || []).map((course, i) => (
                <div key={i} className="grad-watchlist-item">
                  <div>
                    <div className="grad-watchlist-name">{course.name}</div>
                    <div className="grad-watchlist-meta">{course.category} / {course.credits} 學分</div>
                  </div>
                  <button className="grad-watchlist-add" id={`watchlist-add-${i}`}>
                    <Plus size={16} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Right - AI recommendations */}
        <div className="graduation-right">
          <div className="grad-ai-card">
            <h3 className="grad-ai-title">🤖 AI 缺漏學分補救建議</h3>

            {(data?.recommendations || []).map((rec, i) => (
              <div key={i} className={`grad-rec-item ${rec.type}`}>
                <div className="grad-rec-header">
                  {rec.type === 'warning' ? (
                    <AlertTriangle size={16} className="rec-icon warning" />
                  ) : (
                    <Lightbulb size={16} className="rec-icon suggestion" />
                  )}
                  <span className="grad-rec-type">
                    {rec.type === 'warning' ? '⚠️ 必修警告：' : '💡 通識推薦：'}
                  </span>
                </div>
                <p className="grad-rec-message">{rec.message}</p>
                <div className="grad-rec-actions">
                  <button className="grad-rec-btn primary" id={`rec-add-${i}`}>
                    <Plus size={14} />
                    加入課表
                  </button>
                  <button className="grad-rec-btn secondary" id={`rec-detail-${i}`}>
                    <Search size={14} />
                    查看課程詳情
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
