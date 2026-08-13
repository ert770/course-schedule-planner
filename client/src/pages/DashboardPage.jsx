import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/useAuth';
import { useTheme } from '../contexts/useTheme';
import { scheduleAPI, chatAPI, profileAPI } from '../services/api';
import ScheduleGrid from '../components/Schedule/ScheduleGrid';
import { formatCourseTime } from '../utils/courseTime';
import { X, Send, Search, Download, Loader2, Calendar, LayoutDashboard, Settings, Moon, Sun, CheckCircle2, Sparkles, AlertTriangle } from 'lucide-react';

// 偏好清單改由 `GET /api/profile/preference-tags` 提供。
//
// 這裡原本寫死一份 `PREFS`，用的是**排課旗標的 key**（`preferCompact` 等）
// 而不是標籤，而且**漏掉 `#不點名`**——它只有 12 項，後端有 13 項。
// 同一份資訊在前端兩處、後端一處各自維護，漂移只是時間問題，而它已經發生了。

const MAX_EXCLUDED_SHOWN = 5;

// 把排課回應整理成畫面上要顯示的提示。成功但有警告時也要顯示，
// 否則「學分不足」「偏好未滿足」這類訊息同樣會消失。
// notice 的渲染會無條件讀 `warnings` / `unscheduled` / `excluded` 的 `.length`，
// 少任何一個都會讓整個 Dashboard 白畫面。**錯誤路徑正是最容易漏欄位的地方**
// ——也就是最需要顯示訊息的時候反而整頁掛掉。一律經過這裡補齊。
function makeNotice({ level, message, warnings = [], excluded = [], unscheduled = [] }) {
  return { level, message, warnings, excluded, unscheduled };
}

function buildScheduleNotice(data) {
  const excluded = data.excludedCourses || [];
  // 尚未排定時間的課程有學分卻不會出現在課表格上，必須讓使用者看得到。
  const unscheduled = data.unscheduledCourses || [];
  const message = data.message || '無法產生符合限制的課表。';
  // 排課失敗時後端會把 warnings[0] 當作 message，直接全部渲染會重複一次。
  const warnings = (data.warnings || []).filter(warning => warning !== message);

  if (!data.success) {
    return makeNotice({ level: 'error', message, warnings, excluded, unscheduled });
  }

  // 成功排出課表不代表所有候選課都被採用。已修課程會由 A3 主動放進
  // excludedCourses；若這裡只看 warnings／時間未定課程，排除原因仍會在畫面上
  // 靜默消失，使用者無法知道候選池為何少了那些課。
  if (data.watchOnly || warnings.length > 0 || excluded.length > 0 || unscheduled.length > 0) {
    return makeNotice({ level: 'warning', message, warnings, excluded, unscheduled });
  }

  return null;
}

export default function DashboardPage() {
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();
  
  const [schedule, setSchedule] = useState([]);
  const [scheduleNotice, setScheduleNotice] = useState(null);
  const [isScheduling, setIsScheduling] = useState(false);
  // 偏好狀態就是**目前勾選的標籤集合**，來源是 profile API（即 MySQL
  // `User_Profiles.preference_tags`），與 Setup 頁讀的是同一支 API、同一份資料。
  //
  // 先前這裡讀 `localStorage.fcu_initial_prefs`——那是 Setup 儲存時順手寫的副本。
  // 副本與真相各自演化，Setup 改存標籤陣列之後，這裡讀 `prefs.noMorningClasses`
  // 全部是 undefined，側邊面板因此永遠不打勾。改讀同一份資料就沒有「同步」問題。
  const [selectedTags, setSelectedTags] = useState(new Set());
  const [tagGroups, setTagGroups] = useState([]);
  const [prefsError, setPrefsError] = useState('');
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

  const totalCredits = schedule.reduce((sum, course) => sum + (course.credits || 0), 0);
  // 軍訓國防科技、體育、班級活動要排進課表但不計入畢業學分（校規）。
  // 後端在每門課上標記 countsTowardGraduation；未標記者一律視為計入。
  const graduationCredits = schedule.reduce(
    (sum, course) => (course.countsTowardGraduation === false ? sum : sum + (course.credits || 0)),
    0
  );
  const hasNonGraduationCredits = graduationCredits !== totalCredits;

  const generateInitialSchedule = useCallback(async () => {
    setIsScheduling(true);
    try {
      // **偏好不由前端重送。**
      //
      // 這裡原本把 12 個偏好逐一以 `currentPrefs.X || false` 送出，並自行把
      // `mondayFree` 展開成週一 1–14 節。兩者都是問題：
      //
      //   1. `|| false` 把「使用者沒設定」變成「明確設為 false」。後端的
      //      `pickFlag()` 是 `input ?? saved`，收到 false 就會覆蓋掉資料庫裡的 true
      //      ——使用者剛存的偏好在下一次排課就消失。
      //   2. `mondayFree` 的展開 `constraintService.buildBlockedPeriods()` 已經做過，
      //      兩處各做一次必然漂移。
      //
      // 偏好的真相來源是 `User_Profiles`，後端排課時自己會讀。前端只送
      // 「這次操作才成立」的條件。
      const constraints = {
        // 校規：每學期上限 25、下限 12（見 docs/COURSE_SELECTION_RULES.md）
        maxCredits: 25,
        minCredits: 12,
      };

      // 排課讀的是這位學生的偏好與修課歷史，未登入就不該產生課表。
      if (!user?.studentId) {
        setScheduleNotice(makeNotice({
          level: 'error',
          message: '尚未登入，無法產生個人化課表。請重新登入後再試。',
        }));
        return;
      }

      const data = await scheduleAPI.generate({
        userId: user.studentId,
        constraints,
      });

      // 後端會回傳 message / warnings / excludedCourses 說明排課結果，
      // 全部丟棄會讓失敗變成無聲失敗，使用者只看到空白課表。
      setScheduleNotice(buildScheduleNotice(data));

      if (data.success) {
        setSchedule(data.schedule);
      } else {
        setChatHistory(prev => [...prev, {
          role: 'bot',
          text: data.message || '排課失敗，但後端沒有回傳原因。',
        }]);
      }
    } catch (err) {
      console.error('Schedule generation failed:', err);
      // 這裡原本漏了 `unscheduled`，渲染時讀 `.length` 會讓整頁崩潰——
      // 後端一連不上就白畫面，使用者連錯誤訊息都看不到。
      setScheduleNotice(makeNotice({
        level: 'error',
        message: err.message || '無法連接到伺服器，請確認後端已啟動。',
      }));
    } finally {
      setTimeout(() => setIsScheduling(false), 1500);
    }
  }, [user?.studentId]);

  useEffect(() => {
    generateInitialSchedule();
  }, [generateInitialSchedule]);

  // 標籤目錄不隨使用者變動，載入一次即可。
  useEffect(() => {
    let cancelled = false;

    profileAPI.getPreferenceTags()
      .then(data => {
        if (!cancelled) setTagGroups(data.groups || []);
      })
      .catch(() => { /* 取不到就不顯示偏好面板，不影響課表 */ });

    return () => { cancelled = true; };
  }, []);

  // 目前勾選的偏好來自 profile，與 Setup 頁同一份資料。
  useEffect(() => {
    let cancelled = false;
    if (!user?.studentId) return undefined;

    profileAPI.get(user.studentId)
      .then(profile => {
        if (!cancelled && Array.isArray(profile?.selectedTags)) {
          setSelectedTags(new Set(profile.selectedTags));
        }
      })
      .catch(err => {
        if (!cancelled) setPrefsError(err.message || '偏好設定載入失敗');
      });

    return () => { cancelled = true; };
  }, [user?.studentId]);

  // 勾選立即寫回 MySQL，但**不重新排課**——重排由「套用偏好排課」觸發，
  // 否則連勾幾個偏好就會連跑幾次排課。
  //
  // 寫入失敗必須顯示出來。靜默失敗會讓使用者以為存好了、實際上沒有，
  // 那正是這批問題反覆出現的原因。
  const handlePrefToggle = async (tag) => {
    const next = new Set(selectedTags);
    if (next.has(tag)) next.delete(tag);
    else next.add(tag);

    if (!user?.studentId) {
      setPrefsError('尚未登入，無法儲存偏好設定。');
      return;
    }

    const previous = selectedTags;
    setSelectedTags(next);
    setPrefsError('');

    try {
      await profileAPI.update({ selectedTags: [...next] }, user.studentId);
    } catch (err) {
      // 存不進去就把畫面退回原狀，不讓勾選狀態與資料庫說法不一致。
      setSelectedTags(previous);
      setPrefsError(err.message || '偏好儲存失敗，請再試一次。');
    }
  };

  const handleRegenerate = () => {
    generateInitialSchedule();
  };

  const handleChatSend = async (overrideMsg) => {
    const msg = overrideMsg || chatInput.trim();
    if (!msg || chatLoading) return;

    // 聊天記憶與偏好更新都寫進這位使用者，不得退回 `default`。
    if (!user?.studentId) {
      setChatHistory(prev => [...prev, {
        role: 'bot',
        text: '尚未登入，無法使用課表助手。請重新登入後再試。',
      }]);
      return;
    }

    setChatInput('');
    setChatHistory(prev => [...prev, { role: 'user', text: msg }]);
    setChatLoading(true);

    try {
      const res = await chatAPI.send(msg, user.studentId);
      if (res.intent === 'run_csp_scheduler' && res.data?.success) {
        setSchedule(res.data.schedule);
        setChatHistory(prev => [...prev, { 
          role: 'bot', 
          text: `成功生成課表！共 ${res.data.schedule.length} 門課，${res.data.totalCredits} 學分。`,
          schedule: res.data.schedule,
          totalCredits: res.data.totalCredits
        }]);
      } else {
        // 後端 agentService 回傳的欄位是 reply，不是 response
        setChatHistory(prev => [...prev, { role: 'bot', text: res.reply }]);
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
      `${c.name} | ${c.instructor} | ${formatCourseTime(c)}`
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
          <button className="nav-btn" onClick={() => navigate('/schedule')}><Calendar size={16}/> 排課</button>
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
            {prefsError && (
              <div className="error-text" role="alert" id="prefs-error">{prefsError}</div>
            )}
            <div className="sidebar-prefs">
              {tagGroups.flatMap(group => group.tags).map(tag => (
                <label key={tag} className="sidebar-pref-item">
                  <input
                    type="checkbox"
                    checked={selectedTags.has(tag)}
                    onChange={() => handlePrefToggle(tag)}
                  />
                  {tag.replace('#', '')}
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
              <span className="stat-badge credit-badge">🎓 {totalCredits} 學分</span>
              {hasNonGraduationCredits && (
                <span
                  className="stat-badge credit-badge"
                  title="軍訓國防科技、體育、班級活動依校規不計入畢業學分"
                >
                  🧮 計入畢業 {graduationCredits} 學分
                </span>
              )}
            </div>
            <div className="schedule-actions">
              <button className="action-btn secondary" onClick={handleExport}>匯出課表</button>
              <button className="action-btn primary" onClick={handleRegenerate}>
                <Sparkles size={16} /> 套用偏好排課
              </button>
            </div>
          </div>
          
          {scheduleNotice && (
            <div className={`schedule-notice ${scheduleNotice.level}`} id="schedule-notice">
              <div className="schedule-notice-head">
                <AlertTriangle size={16} />
                <span>{scheduleNotice.message}</span>
                <button
                  className="schedule-notice-close"
                  onClick={() => setScheduleNotice(null)}
                  aria-label="關閉提示"
                >
                  <X size={14} />
                </button>
              </div>

              {scheduleNotice.warnings.length > 0 && (
                <ul className="schedule-notice-list">
                  {scheduleNotice.warnings.map((warning, i) => (
                    <li key={i}>{warning}</li>
                  ))}
                </ul>
              )}

              {scheduleNotice.unscheduled.length > 0 && (
                <details className="schedule-notice-excluded">
                  <summary>
                    有 {scheduleNotice.unscheduled.length} 門課時間未定，查看清單
                  </summary>
                  <ul className="schedule-notice-list">
                    {scheduleNotice.unscheduled.slice(0, MAX_EXCLUDED_SHOWN).map((course, i) => (
                      <li key={i}>
                        <strong>{course.name}</strong>（{course.credits} 學分）
                        {course.department ? `｜${course.department}` : ''}
                      </li>
                    ))}
                    {scheduleNotice.unscheduled.length > MAX_EXCLUDED_SHOWN && (
                      <li>其餘 {scheduleNotice.unscheduled.length - MAX_EXCLUDED_SHOWN} 門未列出。</li>
                    )}
                  </ul>
                </details>
              )}

              {scheduleNotice.excluded.length > 0 && (
                <details className="schedule-notice-excluded">
                  <summary>
                    有 {scheduleNotice.excluded.length} 門課未被排入，查看原因
                  </summary>
                  <ul className="schedule-notice-list">
                    {scheduleNotice.excluded.slice(0, MAX_EXCLUDED_SHOWN).map((item, i) => (
                      <li key={i}>
                        <strong>{item.course?.name || '未知課程'}</strong>：{item.reason}
                      </li>
                    ))}
                    {scheduleNotice.excluded.length > MAX_EXCLUDED_SHOWN && (
                      <li>其餘 {scheduleNotice.excluded.length - MAX_EXCLUDED_SHOWN} 門未列出。</li>
                    )}
                  </ul>
                </details>
              )}
            </div>
          )}

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
                                {formatCourseTime(c)} | {c.credits}學分
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
