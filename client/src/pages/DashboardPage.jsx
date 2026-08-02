import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/useAuth';
import { useTheme } from '../contexts/useTheme';
import { useSchedule } from '../contexts/useSchedule'; // 🌟 引入全域課表狀態
import { scheduleAPI, chatAPI } from '../services/api';
import ScheduleGrid from '../components/Schedule/ScheduleGrid';
import { 
  X, Send, Search, Download, Loader2, Calendar, 
  LayoutDashboard, Settings, Moon, Sun, CheckCircle2, Sparkles, Trash2 
} from 'lucide-react';

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
  
  // 🌟 將原本的 useState 替換為全域的 useSchedule
  const { schedule, setSchedule } = useSchedule();
  
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
  }, [chatHistory, chatLoading]); 

  const generateInitialSchedule = useCallback(async (currentPrefs = prefs) => {
    // 💡 防呆：如果全域課表已經有課，就不要一進來又自動覆蓋重排
    if (schedule.length > 0) return; 

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
        setSchedule(data.schedule); // 🌟 這裡會直接更新到全域狀態
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
  }, [prefs, user?.studentId, schedule.length, setSchedule]);

  useEffect(() => {
    generateInitialSchedule(prefs);
  }, [generateInitialSchedule, prefs]);

  const handlePrefToggle = (key) => {
    const newPrefs = { ...prefs, [key]: !prefs[key] };
    setPrefs(newPrefs);
  };

  const handleRegenerate = async () => {
    // 手動點擊重新排課時，不受「已有課表」的限制
    setIsScheduling(true);
    try {
      const blockedPeriods = [];
      if (prefs.mondayFree) {
        for (let p = 1; p <= 14; p++) {
          blockedPeriods.push({ day: 1, period: p });
        }
      }
      const constraints = { ...prefs, blockedPeriods, maxCredits: 25, minCredits: 15 };
      const data = await scheduleAPI.generate({ userId: user?.studentId || 'default', constraints });
      if (data.success) {
        setSchedule(data.schedule);
        setChatHistory(prev => [...prev, { 
          role: 'bot', 
          text: `已套用偏好設定並重新排課，成功生成課表！共 ${data.schedule.length} 門課，${data.totalCredits} 學分。`,
          schedule: data.schedule,
          totalCredits: data.totalCredits
        }]);
      }
    } catch (err) {
      console.error('Regeneration failed:', err);
    } finally {
      setTimeout(() => setIsScheduling(false), 1000);
    }
  };

  const handleChatSubmit = async (e) => {
    if (e) e.preventDefault(); 
    const msg = chatInput.trim();
    if (!msg || chatLoading) return;
    
    setChatInput('');
    setChatHistory(prev => [...prev, { role: 'user', text: msg }]);
    setChatLoading(true);

    try {
      const res = await chatAPI.send(msg, user?.studentId || 'default');
      if (res.intent === 'run_csp_scheduler' && res.data?.success) {
        setSchedule(res.data.schedule); // 🌟 聊天機器人排課結果存入全域
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

  // 🌟 新增：從課表中移除特定課程
  const handleRemoveCourse = (courseId) => {
    setSchedule(schedule.filter(c => c.id !== courseId));
    setDetailCourse(null); // 關閉 Modal
  };

  return (
    <div className="layout-container" id="dashboard-page" style={{ height: '100vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      
      <header className="top-nav" style={{ flexShrink: 0 }}>
        <div className="nav-brand">
          <Calendar size={20} className="nav-icon" />
          <span>課表規劃助手</span>
        </div>
        <div className="nav-links">
          <button className="nav-btn active"><LayoutDashboard size={16}/> 首頁</button>
          <button className="nav-btn" onClick={() => navigate('/search')}><Search size={16}/> 尋找課程</button>
        </div>
        <div className="nav-actions">
          <div className="nav-user" style={{ position: 'relative' }}>
            <div 
              className="user-trigger" 
              onClick={() => setShowUserMenu(!showUserMenu)}
              style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}
            >
              <div className="avatar">{(user?.name || '同')[0]}</div>
              <span>{user?.name || '同學'}</span>
            </div>
            
            {showUserMenu && (
              <>
                <div 
                  style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 98 }} 
                  onClick={() => setShowUserMenu(false)} 
                />
                <div className="user-dropdown-menu" style={{ position: 'absolute', top: '100%', right: 0, zIndex: 99, marginTop: '8px' }}>
                  <button className="user-dropdown-item" onClick={() => { setShowUserMenu(false); navigate('/graduation'); }}>
                    <Settings size={16} style={{marginRight: '8px'}} /> 畢業學分進度
                  </button>
                  <button className="user-dropdown-item" onClick={() => { setShowUserMenu(false); toggleTheme(); }}>
                    {theme === 'dark' ? <Sun size={16} style={{marginRight: '8px'}}/> : <Moon size={16} style={{marginRight: '8px'}}/>} 
                    切換主題 ({theme === 'dark' ? '淺色' : '深色'})
                  </button>
                  <div style={{height: '1px', background: 'var(--border-color)', margin: '4px 0'}}></div>
                  <button className="user-dropdown-item" onClick={logout}>登出 (Logout)</button>
                </div>
              </>
            )}
          </div>
        </div>
      </header>

      <div className="dashboard-content" style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        
        <aside className="left-sidebar" style={{ overflowY: 'auto', paddingBottom: '24px' }}>
          <div className="sidebar-section">
            <h3 className="sidebar-section-title">我的排課偏好</h3>
            <div className="sidebar-prefs">
              {PREFS.map(p => (
                <label key={p.key} className="sidebar-pref-item" style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <input 
                    type="checkbox" 
                    checked={!!prefs[p.key]}
                    onChange={() => handlePrefToggle(p.key)}
                    style={{ cursor: 'pointer' }}
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

        <div className="schedule-area" style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div className="schedule-header-bar" style={{ flexShrink: 0 }}>
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
          
          <div className="schedule-wrapper" style={{ flex: 1, overflowY: 'auto', paddingBottom: '24px' }}>
            {isScheduling && (
              <div className="scheduling-overlay">
                <Loader2 size={40} className="spin-animation" />
                <p>Agent 正在呼叫排課演算法...</p>
              </div>
            )}
            <ScheduleGrid courses={schedule} onCourseClick={setDetailCourse} />
          </div>
        </div>

        <aside className="chat-panel" style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div className="chat-header" style={{ flexShrink: 0 }}>
            <div className="chat-bot-avatar">🤖</div>
            <div className="chat-title-info">
              <h3>課表規劃助手</h3>
              <p>用自然語言告訴我你的需求</p>
            </div>
          </div>
          
          <div className="chat-messages" ref={chatScrollRef} style={{ flex: 1, overflowY: 'auto' }}>
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

          <div className="chat-input-area" style={{ flexShrink: 0 }}>
            <form className="input-box" onSubmit={handleChatSubmit} style={{ display: 'flex', width: '100%' }}>
              <input
                ref={chatInputRef}
                type="text"
                placeholder="輸入你的需求... 例如「幫我排課表」"
                value={chatInput}
                onChange={e => setChatInput(e.target.value)}
                disabled={chatLoading}
                style={{ flex: 1 }}
              />
              <button 
                type="submit"
                className="send-btn" 
                disabled={!chatInput.trim() || chatLoading}
              >
                <Send size={18} />
              </button>
            </form>
          </div>
        </aside>
      </div>

      {detailCourse && (
        <div className="modal-overlay" onClick={() => setDetailCourse(null)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <button className="modal-close" onClick={() => setDetailCourse(null)}>✕</button>
            <h2 style={{ fontSize: '1.3rem', marginBottom: '8px', paddingRight: '20px' }}>{detailCourse.name}</h2>
            <span className="detail-code" style={{ color: '#6b7280', fontSize: '0.9rem' }}>{detailCourse.code}</span>
            <div className="detail-meta" style={{ margin: '16px 0', padding: '12px', backgroundColor: 'var(--bg-secondary)', borderRadius: '8px' }}>
              <p style={{ margin: '4px 0' }}>👤 授課教師：{detailCourse.instructor}</p>
              <p style={{ margin: '4px 0' }}>📚 學分數：{detailCourse.credits} 學分</p>
            </div>
            {detailCourse.description && (
              <div className="detail-desc">
                <div className="detail-desc-label" style={{ fontWeight: 'bold', marginBottom: '8px' }}>課程說明</div>
                <p style={{ lineHeight: '1.6' }}>{detailCourse.description}</p>
              </div>
            )}
            
            {/* 🌟 新增：移除課程按鈕 */}
            <div style={{ marginTop: '24px', display: 'flex', justifyContent: 'flex-end' }}>
              <button 
                onClick={() => handleRemoveCourse(detailCourse.id)}
                style={{
                  display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 16px', borderRadius: '6px',
                  border: 'none', cursor: 'pointer', backgroundColor: '#ef4444', color: '#fff', fontWeight: 'bold',
                  transition: 'background-color 0.2s'
                }}
                onMouseOver={(e) => e.currentTarget.style.backgroundColor = '#dc2626'}
                onMouseOut={(e) => e.currentTarget.style.backgroundColor = '#ef4444'}
              >
                <Trash2 size={16} /> 
                從課表中移除
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
