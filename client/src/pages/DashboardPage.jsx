import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/useAuth';
import { useTheme } from '../contexts/useTheme';
import { scheduleAPI, chatAPI } from '../services/api';
import ScheduleGrid from '../components/Schedule/ScheduleGrid';
import { X, Send, Search, Download, Loader2, Calendar, LayoutDashboard, Settings, Moon, Sun, CheckCircle2, Sparkles } from 'lucide-react';

const PREFS = [
  { key: 'preferCompact', label: '盡量集中排課' },
  { key: 'noMorningClasses', label: '不排早八' },
  { key: 'mondayFree', label: '星期一排空' },
  { key: 'lunchBreakFree', label: '午休務必空出' },
  { key: 'noMidterm', label: '無期中考' },
  { key: 'practicalExam', label: '上機實作考試' },
  { key: 'finalReport', label: '期末報告為主' },
  { key: 'weightDaily', label: '平時成績佔比高' },
  { key: 'noGroupReport', label: '無分組報告' },
  { key: 'preferDiscussion', label: '高度課堂討論' },
  { key: 'englishTaught', label: '全英授課' },
  { key: 'learnMore', label: '學到許多知識' },
];

export default function DashboardPage() {
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();
  
  const [schedule, setSchedule] = useState([]);
  const [isScheduling, setIsScheduling] = useState(false);
  const [prefs, setPrefs] = useState(() => {
    try {
      const saved = localStorage.getItem('fcu_initial_prefs');
      return saved ? JSON.parse(saved) : {};
    } catch {
      return {};
    }
  });
  const [chatInput, setChatInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const [chatHistory, setChatHistory] = useState([
    { role: 'bot', text: '你好！我是課表規劃助手，用自然語言告訴我你的需求吧！' }
  ]);
  const [detailCourse, setDetailCourse] = useState(null);
  
  const [showUserMenu, setShowUserMenu] = useState(false);
  const chatInputRef = useRef(null);
  const chatScrollRef = useRef(null);

  useEffect(() => {
    // Scroll chat to bottom
    if (chatScrollRef.current) {
      chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
    }
  }, [chatHistory]);

  const generateInitialSchedule = useCallback(async (currentPrefs = prefs) => {
    setIsScheduling(true);
    try {
      const blockedPeriods = [];
      if (currentPrefs.mondayFree) {
        for (let p = 1; p <= 14; p++) {
          blockedPeriods.push({ day: 1, period: p });
        }
      }

      const constraints = {
        noMorningClasses: currentPrefs.noMorningClasses || false,
        noMidterm: currentPrefs.noMidterm || false,
        noGroupReport: currentPrefs.noGroupReport || false,
        discussion: currentPrefs.preferDiscussion || false,
        learnMore: currentPrefs.learnMore || false,
        weightDaily: currentPrefs.weightDaily || false,
        practicalExam: currentPrefs.practicalExam || false,
        finalReport: currentPrefs.finalReport || false,
        englishTaught: currentPrefs.englishTaught || false,
        lunchBreakFree: currentPrefs.lunchBreakFree || false,
        preferCompact: currentPrefs.preferCompact || false,
        hideConflict: currentPrefs.hideConflict || false,
        maxCredits: 25,
        minCredits: 15,
        blockedPeriods,
      };

      const data = await scheduleAPI.generate({
        userId: user?.studentId || 'default',
        constraints,
      });

      if (data.success) {
        setSchedule(data.schedule);
        if (Object.keys(currentPrefs).length > 0) {
          setChatHistory(prev => [...prev, { 
            role: 'bot', 
            text: `已套用偏好設定並重新排課，成功生成課表！共 ${data.schedule.length} 門課，${data.totalCredits} 學分。`,
            schedule: data.schedule,
            totalCredits: data.totalCredits
          }]);
        }
      }
    } catch (err) {
      console.error('Schedule generation failed:', err);
    } finally {
      setTimeout(() => setIsScheduling(false), 1500);
    }
  }, [prefs, user?.studentId]);

  useEffect(() => {
    generateInitialSchedule(prefs);
  }, [generateInitialSchedule, prefs]);

  const handlePrefToggle = (key) => {
    const newPrefs = { ...prefs, [key]: !prefs[key] };
    setPrefs(newPrefs);
  };

  const handleRegenerate = () => {
    generateInitialSchedule(prefs);
  };

  const handleChatSend = async (overrideMsg) => {
    const msg = overrideMsg || chatInput.trim();
    if (!msg || chatLoading) return;
    
    setChatInput('');
    setChatHistory(prev => [...prev, { role: 'user', text: msg }]);
    setChatLoading(true);

    try {
      const res = await chatAPI.send(msg, user?.studentId || 'default');
      if (res.intent === 'run_csp_scheduler' && res.data?.success) {
        setSchedule(res.data.schedule);
        setChatHistory(prev => [...prev, { 
          role: 'bot', 
          text: `成功生成課表！共 ${res.data.schedule.length} 門課，${res.data.totalCredits} 學分。`,
          schedule: res.data.schedule,
          totalCredits: res.data.totalCredits
        }]);
      } else {
        setChatHistory(prev => [...prev, { role: 'bot', text: res.response }]);
      }
    } catch (err) {
      console.error('Chat error:', err);
      setChatHistory(prev => [...prev, { role: 'bot', text: '抱歉，處理您的請求時發生錯誤。' }]);
    } finally {
      setChatLoading(false);
    }
  };

  const handleExport = () => {
    const text = schedule.map(c =>
      `${c.name} | ${c.instructor} | 週${'一二三四五'[c.dayOfWeek-1]} 第${c.startPeriod}-${c.endPeriod}節`
    ).join('\n');
    const blob = new Blob([`114學年度 上學期 預排課表\n\n${text}`], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = '預排課表.txt';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="layout-container" id="dashboard-page">
      {/* Top Navbar */}
      <header className="top-nav">
        <div className="nav-brand">
          <Calendar size={20} className="nav-icon" />
          <span>課表規劃助手</span>
        </div>
        <div className="nav-links">
          <button className="nav-btn active"><LayoutDashboard size={16}/> 首頁</button>
          <button className="nav-btn" onClick={() => navigate('/search')}><Search size={16}/> 尋找課程</button>
        </div>
        <div className="nav-actions">
          <div className="nav-user" onClick={() => setShowUserMenu(!showUserMenu)}>
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

      <div className="dashboard-content">
        {/* Left Sidebar: Preferences and Skill Tree */}
        <aside className="left-sidebar">
          <div className="sidebar-section">
            <h3 className="sidebar-section-title">我的排課偏好</h3>
            <div className="sidebar-prefs">
              {PREFS.map(p => (
                <label key={p.key} className="sidebar-pref-item">
                  <input 
                    type="checkbox" 
                    checked={!!prefs[p.key]}
                    onChange={() => handlePrefToggle(p.key)}
                  />
                  {p.label}
                </label>
              ))}
            </div>
          </div>

          <div className="sidebar-skill-tree">
            <h3 className="sidebar-section-title">🌳 我的專業技能樹</h3>
            <p className="sidebar-skill-desc">基於歷年成績與修課紀錄動態生成</p>
            
            <div className="skill-item">
              <div className="skill-header">
                <span className="skill-name">資訊與網路安全</span>
                <span className="skill-level">Lv.4/5</span>
              </div>
              <div className="skill-bar"><div className="skill-bar-fill" style={{width: '80%'}}></div></div>
            </div>
            
            <div className="skill-item">
              <div className="skill-header">
                <span className="skill-name">程式設計</span>
                <span className="skill-level">Lv.4/5</span>
              </div>
              <div className="skill-bar"><div className="skill-bar-fill" style={{width: '80%'}}></div></div>
            </div>
            
            <div className="skill-item">
              <div className="skill-header">
                <span className="skill-name">資料庫系統</span>
                <span className="skill-level">Lv.4/5</span>
              </div>
              <div className="skill-bar"><div className="skill-bar-fill" style={{width: '80%'}}></div></div>
            </div>

            <div className="skill-item">
              <div className="skill-header">
                <span className="skill-name">微積分</span>
                <span className="skill-level">Lv.4/5</span>
              </div>
              <div className="skill-bar"><div className="skill-bar-fill" style={{width: '80%'}}></div></div>
            </div>

            <div className="skill-overall">
              <span className="skill-overall-score">整體能力指數</span>
              <span className="score-value">80 / 100</span>
            </div>
            <div className="skill-bar overall-bar"><div className="skill-bar-fill overall" style={{width: '80%'}}></div></div>
          </div>
        </aside>

        {/* Center: Schedule Area */}
        <div className="schedule-area">
          <div className="schedule-header-bar">
            <div className="schedule-stats">
              <span className="stat-badge course-badge">📚 {schedule.length} 門課</span>
              <span className="stat-badge credit-badge">🎓 {schedule.reduce((s, c) => s + c.credits, 0)} 學分</span>
            </div>
            <div className="schedule-actions">
              <button className="action-btn secondary" onClick={handleExport}>匯出課表</button>
              <button className="action-btn primary" onClick={handleRegenerate}>
                <Sparkles size={16} /> 套用偏好排課
              </button>
            </div>
          </div>
          
          <div className="schedule-wrapper">
            {isScheduling && (
              <div className="scheduling-overlay">
                <Loader2 size={40} className="spin-animation" />
                <p>Agent 正在呼叫排課演算法...</p>
              </div>
            )}
            <ScheduleGrid courses={schedule} onCourseClick={setDetailCourse} />
          </div>
        </div>

        {/* Right Side: Chat Panel */}
        <aside className="chat-panel">
          <div className="chat-header">
            <div className="chat-bot-avatar">🤖</div>
            <div className="chat-title-info">
              <h3>課表規劃助手</h3>
              <p>用自然語言告訴我你的需求</p>
            </div>
          </div>
          
          <div className="chat-messages" ref={chatScrollRef}>
            {chatHistory.map((msg, i) => (
              <div key={i} className={`chat-message ${msg.role}`}>
                {msg.role === 'bot' && (
                  <div className="message-bubble">
                    {msg.schedule && <CheckCircle2 size={16} className="success-icon" />}
                    <span>{msg.text}</span>
                    
                    {msg.schedule && (
                      <div className="chat-schedule-list">
                        {msg.schedule.map(c => (
                          <div key={c.id} className="chat-course-item">
                            <div className="chat-course-color" style={{background: 'var(--accent-blue)'}}></div>
                            <div className="chat-course-details">
                              <strong>{c.name}</strong> ({c.code}) — {c.instructor}
                              <div className="chat-course-meta">
                                週{'一二三四五'[c.dayOfWeek-1]} 第{c.startPeriod}-{c.endPeriod}節 | {c.credits}學分
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
                {msg.role === 'user' && (
                  <div className="message-bubble">{msg.text}</div>
                )}
              </div>
            ))}
            {chatLoading && (
              <div className="chat-message bot">
                <div className="message-bubble loading">
                  <Loader2 size={16} className="spin-animation" /> 思考中...
                </div>
              </div>
            )}
          </div>

          <div className="chat-input-area">
            <div className="input-box">
              <input
                ref={chatInputRef}
                type="text"
                placeholder="輸入你的需求... 例如「幫我排課表」"
                value={chatInput}
                onChange={e => setChatInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleChatSend()}
                disabled={chatLoading}
              />
              <button 
                className="send-btn" 
                onClick={() => handleChatSend()} 
                disabled={!chatInput.trim() || chatLoading}
              >
                <Send size={18} />
              </button>
            </div>
          </div>
        </aside>
      </div>

      {/* Modal is same as before */}
      {detailCourse && (
        <div className="modal-overlay" onClick={() => setDetailCourse(null)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <button className="modal-close" onClick={() => setDetailCourse(null)}>✕</button>
            <h2 style={{ fontSize: '1.3rem', marginBottom: '8px' }}>{detailCourse.name}</h2>
            <span className="detail-code">{detailCourse.code}</span>
            <div className="detail-meta">
              <span>👤 {detailCourse.instructor}</span>
              <span>📚 {detailCourse.credits} 學分</span>
            </div>
            {detailCourse.description && (
              <div className="detail-desc">
                <div className="detail-desc-label">課程說明</div>
                <p>{detailCourse.description}</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
