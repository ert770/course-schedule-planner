import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/useAuth';
import { useTheme } from '../contexts/useTheme';
import { useSchedule } from '../contexts/useSchedule';
import { useClickOutside } from '../hooks/useClickOutside';
import { scheduleAPI, chatAPI, profileAPI } from '../services/api';
import ScheduleGrid from '../components/Schedule/ScheduleGrid';
import ExportDropdown from '../components/Schedule/ExportDropdown';
import RemoveReasonDialog from '../components/Schedule/RemoveReasonDialog';
import ScheduleConfirmationBar from '../components/Schedule/ScheduleConfirmationBar';
import { formatCourseTime } from '../utils/courseTime';
import CourseDetailModal from '../components/CourseCard/CourseDetailModal';
import ScheduleNotice from '../components/Schedule/ScheduleNotice';
import PlanSwitcher from '../components/Schedule/PlanSwitcher';
import PlanComparison from '../components/Schedule/PlanComparison';
import { makeNotice, buildScheduleNotice, buildScheduleNoticeForPlan } from '../utils/scheduleNotice';
import { Send, Search, Loader2, Calendar, LayoutDashboard, Settings, Moon, Sun, CheckCircle2, Sparkles } from 'lucide-react';

// 偏好清單改由 `GET /api/profile/preference-tags` 提供。
//
// 這裡原本寫死一份 `PREFS`，用的是**排課旗標的 key**（`preferCompact` 等）
// 而不是標籤，而且**漏掉 `#不點名`**——它只有 12 項，後端有 13 項。
// 同一份資訊在前端兩處、後端一處各自維護，漂移只是時間問題，而它已經發生了。

export default function DashboardPage() {
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const {
    schedule,
    loading: scheduleLoading,
    saving,
    replaceSchedule,
    removeCourse,
    saveCurrentSchedule,
    buildRecommendation,
    logCourseViewed,
    logScheduleRegenerated,
    acceptRecommendation,
    personalizationEnabled,
    // roadmap #27
    plans,
    selectedPlanId,
    planDiversity,
    selectPlan,
  } = useSchedule();
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
  // roadmap #2：排課只是推薦，使用者是否覺得符合需求才是最終選擇。
  const [confirmation, setConfirmation] = useState(null);
  const [removalCandidate, setRemovalCandidate] = useState(null);
  
  const [showUserMenu, setShowUserMenu] = useState(false);
  const chatInputRef = useRef(null);
  const chatScrollRef = useRef(null);
  const initialGenerationUserRef = useRef(null);
  const userMenuRef = useRef(null);

  useClickOutside(userMenuRef, () => setShowUserMenu(false), showUserMenu);

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

  const generateInitialSchedule = useCallback(async (trigger = 'initial_load') => {
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

      // `surface`／`trigger` 讓伺服器知道這次曝光要記在哪個畫面、被什麼觸發
      // （roadmap #2）；曝光事件本身現在由伺服器在算出結果時直接寫入，
      // 前端不再事後回報「系統顯示了什麼」——那份宣稱是使用者瀏覽器自己說的，
      // 無法作為可信的訓練資料來源。
      const data = await scheduleAPI.generate({
        constraints,
        surface: 'dashboard',
        trigger,
      });

      // 後端會回傳 message / warnings / excludedCourses 說明排課結果，
      // 全部丟棄會讓失敗變成無聲失敗，使用者只看到空白課表。
      setScheduleNotice(buildScheduleNotice(data));

      if (trigger !== 'initial_load') {
        logScheduleRegenerated(data.requestId, { surface: 'dashboard', trigger });
      }

      if (data.success) {
        replaceSchedule(data.schedule, buildRecommendation(data), data.plans, data.planDiversity);
        setConfirmation(data.requestId ? { state: 'pending' } : null);
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
  }, [buildRecommendation, logScheduleRegenerated, replaceSchedule, user?.studentId]);

  useEffect(() => {
    if (scheduleLoading || !user?.studentId) return;
    if (schedule.length > 0) {
      initialGenerationUserRef.current = user.studentId;
      return;
    }
    if (initialGenerationUserRef.current === user.studentId) return;
    initialGenerationUserRef.current = user.studentId;
    generateInitialSchedule();
  }, [generateInitialSchedule, schedule.length, scheduleLoading, user?.studentId]);

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

    profileAPI.get()
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
      await profileAPI.update({ selectedTags: [...next] });
    } catch (err) {
      // 存不進去就把畫面退回原狀，不讓勾選狀態與資料庫說法不一致。
      setSelectedTags(previous);
      setPrefsError(err.message || '偏好儲存失敗，請再試一次。');
    }
  };

  const handleRegenerate = () => {
    generateInitialSchedule('preference_regenerate');
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
      const res = await chatAPI.send(msg);
      if (res.intent === 'run_csp_scheduler' && res.data?.success) {
        // Chat 路徑同樣不再由前端回報曝光——`agentService.js` 呼叫
        // `generateForUser()` 時已經固定帶 `surface:'chat', trigger:'chat_tool'`，
        // 伺服器在算出結果時就直接寫入了。
        replaceSchedule(res.data.schedule, buildRecommendation(res.data), res.data.plans, res.data.planDiversity);
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

  // roadmap #2：明確回答「符合」才算接受。儲存課表刻意不算——存草稿也會按儲存。
  const handleConfirmFit = async () => {
    const outcome = await acceptRecommendation();
    setConfirmation({ state: 'accepted', outcome });
  };

  // 未同意個人化學習時不問原因，直接移除。不同意的人不該被問。
  const handleRemoveClick = (course) => {
    if (!personalizationEnabled) {
      removeCourse(course.id);
      setDetailCourse(null);
      return;
    }
    setRemovalCandidate(course);
  };

  const handleRemoveConfirmed = (feedbackReason) => {
    if (removalCandidate) removeCourse(removalCandidate.id, { feedbackReason });
    setRemovalCandidate(null);
    setDetailCourse(null);
  };

  const handleOpenDetail = (course) => {
    setDetailCourse(course);
    logCourseViewed(course);
  };

  // roadmap #27：切換方案後，提示訊息（排除原因、時間未定課程）也要換成
  // 選中方案自己的，不是繼續顯示前一個方案的——否則畫面上的課表已經換了，
  // 底下的「有 N 門課未被排入」卻還是舊方案的數字。
  const handleSelectPlan = (variantId) => {
    const target = plans.find(plan => plan.id === variantId);
    if (!selectPlan(variantId)) return;
    setScheduleNotice(prev => buildScheduleNoticeForPlan(
      { success: true, message: prev?.message },
      target
    ));
  };

  const handleSave = async () => {
    const result = await saveCurrentSchedule();
    setScheduleNotice(makeNotice({
      level: result.success ? 'success' : 'error',
      message: result.success ? '課表已儲存到目前登入帳號。' : result.message,
    }));
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
          <div className="nav-user" ref={userMenuRef} onClick={() => setShowUserMenu(!showUserMenu)}>
            <div className="avatar">{(user?.name || '同')[0]}</div>
            <span>{user?.name || '同學'}</span>
            
            {showUserMenu && (
              <div className="user-dropdown-menu">
                <button className="user-dropdown-item" onClick={() => navigate('/graduation')}>
                  <Settings size={16} style={{marginRight: '8px'}} /> 畢業學分進度
                </button>
                <button className="user-dropdown-item" onClick={() => navigate('/privacy')}>
                  <Settings size={16} style={{marginRight: '8px'}} /> 隱私與資料
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
              <ExportDropdown schedule={schedule} gridElementId="schedule-grid-container" />
              <button
                className="action-btn secondary"
                onClick={handleSave}
                disabled={saving || schedule.length === 0}
                id="save-dashboard-schedule-btn"
              >
                {saving ? '儲存中…' : '儲存課表'}
              </button>
              <button className="action-btn primary" onClick={handleRegenerate}>
                <Sparkles size={16} /> 套用偏好排課
              </button>
            </div>
          </div>
          
          {/* roadmap #27：`.schedule-area` 是 `overflow:hidden`、`.schedule-wrapper`
              是 `flex:1`——這個區塊（確認列／提示／方案切換／方案比較）加了
              PlanSwitcher 與 PlanComparison 之後文字量可能很大，若不設邊界，
              `.schedule-wrapper` 的可用高度會被擠到只剩幾十像素，課表格實質上
              消失不見。用自己的捲動邊界把它圍起來，確保課表格永遠有合理空間。 */}
          <div className="schedule-top-stack">
            <ScheduleConfirmationBar
              confirmation={confirmation}
              personalizationEnabled={personalizationEnabled}
              onConfirmFit={handleConfirmFit}
              onRequestAdjust={() => setConfirmation({ state: 'adjusting' })}
              onDismiss={() => setConfirmation(null)}
            />

            <ScheduleNotice
              notice={scheduleNotice}
              onDismiss={() => setScheduleNotice(null)}
              domId="schedule-notice"
            />

            <PlanSwitcher
              plans={plans}
              selectedPlanId={selectedPlanId}
              planDiversity={planDiversity}
              onSelectPlan={handleSelectPlan}
            />

            <PlanComparison
              plans={plans}
              constraints={{ maxCredits: 25, minCredits: 12 }}
              surface="dashboard"
            />
          </div>

          <div className="schedule-wrapper">
            {isScheduling && (
              <div className="scheduling-overlay">
                <Loader2 size={40} className="spin-animation" />
                <p>Agent 正在呼叫排課演算法...</p>
              </div>
            )}
            <div id="schedule-grid-container">
              <ScheduleGrid courses={schedule} onCourseClick={handleOpenDetail} />
            </div>
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

      <RemoveReasonDialog
        course={removalCandidate}
        onCancel={() => setRemovalCandidate(null)}
        onConfirm={handleRemoveConfirmed}
      />

      {/* Modal is same as before */}
      <CourseDetailModal
        course={detailCourse}
        onClose={() => setDetailCourse(null)}
        onRemove={handleRemoveClick}
        showTime={false}
      />
    </div>
  );
}
