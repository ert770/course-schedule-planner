import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/useAuth';
import { useTheme } from '../contexts/useTheme';
import { useSchedule } from '../contexts/useSchedule';
import { useClickOutside } from '../hooks/useClickOutside';
import { scheduleAPI, chatAPI, profileAPI, historyFeedbackAPI } from '../services/api';
import ScheduleGrid from '../components/Schedule/ScheduleGrid';
import ExportDropdown from '../components/Schedule/ExportDropdown';
import RemoveReasonDialog from '../components/Schedule/RemoveReasonDialog';
import ScheduleConfirmationBar from '../components/Schedule/ScheduleConfirmationBar';
import SessionAvoidanceBar from '../components/Schedule/SessionAvoidanceBar';
import { formatCourseTime } from '../utils/courseTime';
import CourseDetailModal from '../components/CourseCard/CourseDetailModal';
import ScheduleNotice from '../components/Schedule/ScheduleNotice';
import PlanSwitcher from '../components/Schedule/PlanSwitcher';
import PlanComparison from '../components/Schedule/PlanComparison';
import PreferenceSourceBadge from '../components/Profile/PreferenceSourceBadge';
import SkillTreeModal from '../components/Profile/SkillTreeModal';
import HistoryFeedbackModal from '../components/Profile/HistoryFeedbackModal';
import { makeNotice, buildScheduleNotice, buildScheduleNoticeForPlan } from '../utils/scheduleNotice';
import { getUserIdentity } from '../utils/userIdentity';
import { Send, Search, Loader2, Calendar, LayoutDashboard, Settings, Moon, Sun, CheckCircle2, Sparkles, Award, Compass } from 'lucide-react';

// 偏好清單改由 `GET /api/profile/preference-tags` 提供。
//
// 這裡原本寫死一份 `PREFS`，用的是**排課旗標的 key**（`preferCompact` 等）
// 而不是標籤，而且**漏掉 `#不點名`**——它只有 12 項，後端有 13 項。
// 同一份資訊在前端兩處、後端一處各自維護，漂移只是時間問題，而它已經發生了。

export default function DashboardPage() {
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const userIdentity = getUserIdentity(user);
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
    recommendedPlanId,
    planDiversity,
    selectPlan,
    // 本次規劃的避開清單
    sessionAvoidances,
    clearSessionAvoidances,
    applyResolvedAvoidances,
    buildAvoidanceConstraints,
    userAddedCourseIds,
    buildPlanningContext,
  } = useSchedule();
  const [scheduleNotice, setScheduleNotice] = useState(null);
  // 儲存課表的結果提示：直接覆蓋在「儲存課表」按鈕上顯示，數秒後恢復原狀。
  const [saveToast, setSaveToast] = useState(null);
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
  const [showSkillModal, setShowSkillModal] = useState(false);
  // 階段 5：還有沒回答過的歷史修課時，進排課主頁自動跳出一次。
  const [historyFeedback, setHistoryFeedback] = useState(null);

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
      // 【修復點】：前端防護網。
      // 雖然註解說後端會自動讀取標籤，但實測後端未能將 '#星期一排空' 標籤轉換為硬性限制。
      // 因此我們在這裡明確把阻擋時段 (blockedPeriods) 抓出來，包進 constraints 送給後端。
      const isMondayFree = selectedTags.has('#星期一排空') || selectedTags.has('星期一排空');
      const blockedPeriods = [];
      
      if (isMondayFree) {
        // 星期一第 1 到 14 節全部排空
        for (let i = 1; i <= 14; i++) {
          blockedPeriods.push({ dayOfWeek: 1, period: i });
        }
      }

      const constraints = {
        sessionAvoidances: buildAvoidanceConstraints(),
        selectedCourseIds: userAddedCourseIds(),
        // 如果有勾選星期一排空，強制將條件送給後端
        ...(blockedPeriods.length > 0 && { mondayFree: true, blockedPeriods })
      };

      if (userIdentity === null) {
        setScheduleNotice(makeNotice({
          level: 'error',
          message: '尚未登入，無法產生個人化課表。請重新登入後再試。',
        }));
        return;
      }

      const data = await scheduleAPI.generate({
        constraints,
        surface: 'dashboard',
        trigger,
      });

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
      setScheduleNotice(makeNotice({
        level: 'error',
        message: err.message || '無法連接到伺服器，請確認後端已啟動。',
      }));
    } finally {
      setTimeout(() => setIsScheduling(false), 1500);
    }
  }, [buildAvoidanceConstraints, buildRecommendation, logScheduleRegenerated, replaceSchedule, userAddedCourseIds, userIdentity, selectedTags]); 
  // ↑ 注意最後的 dependency array 加入了 selectedTags
  
  useEffect(() => {
    if (scheduleLoading || userIdentity === null) return;
    if (schedule.length > 0) {
      initialGenerationUserRef.current = userIdentity;
      return;
    }
    if (initialGenerationUserRef.current === userIdentity) return;
    initialGenerationUserRef.current = userIdentity;
    generateInitialSchedule();
  }, [generateInitialSchedule, schedule.length, scheduleLoading, userIdentity]);

  // 階段 5：歷史修課回饋。只在同意個人化學習時查；查不到不影響排課。
  useEffect(() => {
    let cancelled = false;
    if (userIdentity === null || !personalizationEnabled) return undefined;
    historyFeedbackAPI.get()
      .then(data => { if (!cancelled && data?.pendingCount > 0) setHistoryFeedback(data); })
      .catch(() => { /* 取不到就不跳出，不影響排課 */ });
    return () => { cancelled = true; };
  }, [userIdentity, personalizationEnabled]);

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
    if (userIdentity === null) return undefined;

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
  }, [userIdentity]);

  // 勾選立即寫回 MySQL，但**不重新排課**——重排由「套用偏好排課」觸發，
  // 否則連勾幾個偏好就會連跑幾次排課。
  //
  // 寫入失敗必須顯示出來。靜默失敗會讓使用者以為存好了、實際上沒有，
  // 那正是這批問題反覆出現的原因。
  const handlePrefToggle = async (tag) => {
    const next = new Set(selectedTags);
    if (next.has(tag)) next.delete(tag);
    else next.add(tag);

    if (userIdentity === null) {
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
    if (userIdentity === null) {
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
      // 把畫面目前的狀態一起送過去：Agent 才不會反問它其實問得到的資料
      // （目前課表、剛移除了哪些課、原因是什麼）。
      const res = await chatAPI.send(msg, buildPlanningContext());

      // 規劃狀態的三態回覆。
      //
      // 只有 `rejected-invalid`（格式不合法，通常是舊版本留在 sessionStorage 的資料）
      // 才清掉避開清單。`temporarily-unavailable` 是後端這次查不動，清掉會讓使用者
      // 仍然有效的避開條件無聲消失。
      if (res.planningContextStatus === 'rejected-invalid') clearSessionAvoidances();

      if (res.intent === 'run_csp_scheduler' && res.data?.success) {
        // 伺服器回報這次實際套用了哪些避開條件（含 Agent 追問原因後重算的範圍），
        // 寫回 sessionStorage，之後按一般「重新排課」才會沿用同樣的範圍。
        applyResolvedAvoidances(res.data.appliedSessionAvoidances);
        // Chat 路徑同樣不再由前端回報曝光——`agentService.js` 呼叫
        // `generateForUser()` 時已經固定帶 `surface:'chat', trigger:'chat_tool'`，
        // 伺服器在算出結果時就直接寫入了。
        replaceSchedule(res.data.schedule, buildRecommendation(res.data), res.data.plans, res.data.planDiversity);
        // 顯示的文字必須是 res.reply（已經過忠實度檢查），不能換成固定字串——
        // 換掉等於讓忠實度檢查的結果沒有出現在使用者真正看到的畫面上。
        // 課表本身另外用下面的 schedule 卡片呈現，不需要靠這句文字重複交代。
        setChatHistory(prev => [...prev, {
          role: 'bot',
          text: res.reply,
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

  // 點擊「從課表移除」後，立即關閉背後的課程資訊視窗，只顯示退選原因視窗
  const handleRemoveClick = (course) => {
    setDetailCourse(null);
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
    const message = result.success ? '✓ 課表已儲存' : '✕ 儲存失敗';
    setSaveToast({ success: result.success, message });
  };

  useEffect(() => {
    if (!saveToast) return undefined;
    const timer = setTimeout(() => setSaveToast(null), 3000);
    return () => clearTimeout(timer);
  }, [saveToast]);

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
          <button className="nav-btn" onClick={() => navigate('/explore')}><Compass size={16}/> 探索</button>
        </div>
        <div className="nav-actions">
          <div className="nav-user" ref={userMenuRef} onClick={() => setShowUserMenu(!showUserMenu)}>
            <div className="avatar">{(user?.name || '同')[0]}</div>
            <span>{user?.name || '同學'}</span>

            {showUserMenu && (
              <div className="user-dropdown-menu">
                <button className="user-dropdown-item" onClick={() => navigate('/setup')}>
                  <Settings size={16} style={{marginRight: '8px'}} /> 個人資料設定
                </button>
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
            {/* roadmap #31：目前這份課表的個人化來源——顯式、學習到但尚未套用、
                還是資料不足。自己抓資料（不傳 personalization prop），跟隱私中心
                各自獨立載入，不必把 PrivacyPage 的 state 提到這裡共用。 */}
            <PreferenceSourceBadge variant="compact" />
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

          <div className="sidebar-section" style={{ marginTop: '16px' }}>
            <h3 className="sidebar-section-title">🌳 本學期課程主題</h3>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary, #64748b)', lineHeight: '1.5' }}>
              依課名與課程說明整理命中課程，不代表能力程度或歷年修課成果。
            </p>
            <button
              type="button"
              onClick={() => setShowSkillModal(true)}
              className="action-btn"
              style={{ width: '100%', justifyContent: 'center' }}
            >
              <Award size={16} /> 查看課程主題
            </button>
          </div>
        </aside>

        {/* Center: Schedule Area */}
        <div className="schedule-area">
          <div
            className="schedule-header-bar"
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: '12px',
            }}
          >
            <div
              className="schedule-stats"
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                alignItems: 'center',
                gap: '8px',
              }}
            >
              <span className="stat-badge course-badge" style={{ whiteSpace: 'nowrap', flexShrink: 0 }}>
                📚 {schedule.length} 門課
              </span>
              <span className="stat-badge credit-badge" style={{ whiteSpace: 'nowrap', flexShrink: 0 }}>
                🎓 {totalCredits} 學分
              </span>
              {hasNonGraduationCredits && (
                <span
                  className="stat-badge credit-badge"
                  title="軍訓國防科技、體育、班級活動依校規不計入畢業學分"
                  style={{ whiteSpace: 'nowrap', flexShrink: 0 }}
                >
                  🧮 計入畢業 {graduationCredits} 學分
                </span>
              )}
            </div>

            <div
              className="schedule-actions"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                flexShrink: 0,
              }}
            >
              {/* 固定不壓縮、不換行 */}
              <div style={{ flexShrink: 0, whiteSpace: 'nowrap', display: 'inline-flex', alignItems: 'center' }}>
                <ExportDropdown schedule={schedule} gridElementId="schedule-grid-container" />
              </div>

              {/* 儲存課表按鈕：點擊後原地覆蓋為「✓ 課表已儲存」，3 秒後自動恢復 */}
              <button
                className="action-btn secondary"
                onClick={handleSave}
                disabled={saving || schedule.length === 0}
                id="save-dashboard-schedule-btn"
                style={{
                  flexShrink: 0,
                  whiteSpace: 'nowrap',
                  minWidth: '116px',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  transition: 'all 0.25s ease',
                  ...(saveToast?.success ? {
                    backgroundColor: '#10b981',
                    borderColor: '#10b981',
                    color: '#ffffff',
                  } : {}),
                  ...(saveToast && !saveToast.success ? {
                    backgroundColor: '#ef4444',
                    borderColor: '#ef4444',
                    color: '#ffffff',
                  } : {}),
                }}
              >
                {saving
                  ? '儲存中…'
                  : saveToast
                    ? saveToast.message
                    : '儲存課表'}
              </button>

              <button
                className="action-btn primary"
                onClick={handleRegenerate}
                style={{
                  flexShrink: 0,
                  whiteSpace: 'nowrap',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                }}
              >
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

            {/* 本次避開條件必須看得見。系統默默套用使用者看不到的排課限制，
                跟「移除後又被排回來、畫面沒有解釋」是同一種毛病的反面。 */}
            <SessionAvoidanceBar
              avoidances={sessionAvoidances}
              onClear={clearSessionAvoidances}
            />

            <PlanSwitcher
              plans={plans}
              selectedPlanId={selectedPlanId}
              recommendedPlanId={recommendedPlanId}
              planDiversity={planDiversity}
              onSelectPlan={handleSelectPlan}
            />

            {/* constraints 不送 minCredits 與 maxCredits：交給後端依年級與個人上限判斷，
                反事實比較才會與上面的課表用同一組學分範圍。 */}
            <PlanComparison
              plans={plans}
              recommendedPlanId={recommendedPlanId}
              constraints={{}}
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

      <SkillTreeModal
        isOpen={showSkillModal}
        onClose={() => setShowSkillModal(false)}
        schedule={schedule}
      />

      {historyFeedback && (
        <HistoryFeedbackModal
          data={historyFeedback}
          mode="initial"
          onClose={() => setHistoryFeedback(null)}
        />
      )}

      {/* Modal is same as before */}
      <CourseDetailModal
        course={detailCourse}
        onClose={() => setDetailCourse(null)}
        onRemove={handleRemoveClick}
        showTime={false}
      />

      <RemoveReasonDialog
        course={removalCandidate}
        onCancel={() => setRemovalCandidate(null)}
        onConfirm={handleRemoveConfirmed}
      />
    </div>
  );
}