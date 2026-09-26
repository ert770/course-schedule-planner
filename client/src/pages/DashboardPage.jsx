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
import CourseDetailModal from '../components/CourseCard/CourseDetailModal';
import PreferenceSourceBadge from '../components/Profile/PreferenceSourceBadge';
import SkillTreeModal from '../components/Profile/SkillTreeModal';
import { makeNotice, buildScheduleNotice } from '../utils/scheduleNotice';
import { getUserIdentity } from '../utils/userIdentity';
import { Send, Search, Loader2, Calendar, LayoutDashboard, Settings, Moon, Sun, Sparkles, Award } from 'lucide-react';

export default function DashboardPage() {
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const userIdentity = getUserIdentity(user);
  const { theme, toggleTheme } = useTheme();
  const {
    schedule,
    loading: scheduleLoading,
    replaceSchedule,
    removeCourse,
    buildRecommendation,
    logCourseViewed,
    logScheduleRegenerated,
    acceptRecommendation,
    personalizationEnabled,
    plans,
    selectPlan,
  } = useSchedule();
  
  const [scheduleNotice, setScheduleNotice] = useState(null);
  const [isScheduling, setIsScheduling] = useState(false);
  const [selectedTags, setSelectedTags] = useState(new Set());
  const [tagGroups, setTagGroups] = useState([]);
  const [prefsError, setPrefsError] = useState('');
  const [chatInput, setChatInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const [chatHistory, setChatHistory] = useState([
    { role: 'bot', text: '你好！我是課表規劃助手，用自然語言告訴我你的需求吧！' }
  ]);
  const [detailCourse, setDetailCourse] = useState(null);
  const [confirmation, setConfirmation] = useState(null);
  const [removalCandidate, setRemovalCandidate] = useState(null);
  const [isFading, setIsFading] = useState(false);
  const [showSkillModal, setShowSkillModal] = useState(false);
  
  const [showUserMenu, setShowUserMenu] = useState(false);
  const chatInputRef = useRef(null);
  const chatScrollRef = useRef(null);
  const initialGenerationUserRef = useRef(null);
  const userMenuRef = useRef(null);

  useClickOutside(userMenuRef, () => setShowUserMenu(false), showUserMenu);

  useEffect(() => {
    if (chatScrollRef.current) {
      chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
    }
  }, [chatHistory]);

  const totalCredits = schedule.reduce((sum, course) => sum + (course.credits || 0), 0);
  const minCredits = user?.gradeLevel === 4 ? 9 : 12;

  const generateInitialSchedule = useCallback(async (trigger = 'initial_load') => {
    setIsScheduling(true);
    try {
      const constraints = { maxCredits: 25 };
      if (userIdentity === null) {
        setScheduleNotice(makeNotice({ level: 'error', message: '尚未登入，無法產生個人化課表。' }));
        return;
      }
      const data = await scheduleAPI.generate({ constraints, surface: 'dashboard', trigger });
      setScheduleNotice(buildScheduleNotice(data));
      if (trigger !== 'initial_load') {
        logScheduleRegenerated(data.requestId, { surface: 'dashboard', trigger });
      }
      if (data.success) {
        replaceSchedule(data.schedule, buildRecommendation(data), data.plans, data.planDiversity);
        setConfirmation(data.requestId ? { state: 'pending' } : null);
      }
    } catch {
      // 略過未使用的錯誤變數
    } finally {
      setTimeout(() => setIsScheduling(false), 1500);
    }
  }, [buildRecommendation, logScheduleRegenerated, replaceSchedule, userIdentity]);

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

  useEffect(() => {
    let cancelled = false;
    profileAPI.getPreferenceTags()
      .then(data => { if (!cancelled) setTagGroups(data.groups || []); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (userIdentity === null) return undefined;
    profileAPI.get()
      .then(profile => {
        if (!cancelled && Array.isArray(profile?.selectedTags)) {
          setSelectedTags(new Set(profile.selectedTags));
        }
      })
      .catch(err => { if (!cancelled) setPrefsError(err.message); });
    return () => { cancelled = true; };
  }, [userIdentity]);

  const handlePrefToggle = async (tag) => {
    const next = new Set(selectedTags);
    if (next.has(tag)) next.delete(tag);
    else next.add(tag);
    if (userIdentity === null) return;
    const previous = selectedTags;
    setSelectedTags(next);
    try {
      await profileAPI.update({ selectedTags: [...next] });
    } catch {
      setSelectedTags(previous);
    }
  };

  const handleRegenerate = () => generateInitialSchedule('preference_regenerate');

  const handleChatSend = async (overrideMsg) => {
    const msg = overrideMsg || chatInput.trim();
    if (!msg || chatLoading) return;
    setChatInput('');
    setChatHistory(prev => [...prev, { role: 'user', text: msg }]);
    setChatLoading(true);
    try {
      const res = await chatAPI.send(msg);
      if (res.intent === 'run_csp_scheduler' && res.data?.success) {
        replaceSchedule(res.data.schedule, buildRecommendation(res.data), res.data.plans, res.data.planDiversity);
        setChatHistory(prev => [...prev, { role: 'bot', text: res.reply, schedule: res.data.schedule }]);
      } else {
        setChatHistory(prev => [...prev, { role: 'bot', text: res.reply }]);
      }
    } catch {
      setChatHistory(prev => [...prev, { role: 'bot', text: '處理您的請求時發生錯誤。' }]);
    } finally {
      setChatLoading(false);
    }
  };

  const handleConfirmFit = async () => {
    const outcome = await acceptRecommendation();
    setConfirmation({ state: 'accepted', outcome });
    setIsFading(false);
    setTimeout(() => { setIsFading(true); }, 4500);
    setTimeout(() => {
      setConfirmation(null);
      setIsFading(false);
    }, 5000);
  };

  const handleRequestAdjust = () => {
    setConfirmation({ state: 'adjusting' });
    setIsFading(false);
    setTimeout(() => { setIsFading(true); }, 4500);
    setTimeout(() => {
      setConfirmation(null);
      setIsFading(false);
    }, 5000);
  };

  const handleRemoveClick = (course) => {
    setDetailCourse(null);
    setRemovalCandidate(course);
  };

  const handleRemoveConfirmed = (feedbackReasons) => {
    if (removalCandidate) {
      removeCourse(removalCandidate.id, { feedbackReason: feedbackReasons });
    }
    setRemovalCandidate(null);
    setDetailCourse(null);
  };

  const handleOpenDetail = (course) => {
    setDetailCourse(course);
    logCourseViewed(course);
  };

  return (
    <div className="layout-container" id="dashboard-page">
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
                <button className="user-dropdown-item" onClick={() => navigate('/setup')}><Settings size={16} style={{marginRight: '8px'}} /> 個人資料設定</button>
                <button className="user-dropdown-item" onClick={() => navigate('/graduation')}><Settings size={16} style={{marginRight: '8px'}} /> 畢業學分進度</button>
                <button className="user-dropdown-item" onClick={() => navigate('/privacy')}><Settings size={16} style={{marginRight: '8px'}} /> 隱私與資料</button>
                <button className="user-dropdown-item" onClick={toggleTheme}>
                  {theme === 'dark' ? <Sun size={16} style={{marginRight: '8px'}}/> : <Moon size={16} style={{marginRight: '8px'}}/>} 切換主題
                </button>
                <div style={{height: '1px', background: 'var(--border-color)', margin: '4px 0'}}></div>
                <button className="user-dropdown-item" onClick={logout}>登出 (Logout)</button>
              </div>
            )}
          </div>
        </div>
      </header>

      <div className="dashboard-content">
        <aside className="left-sidebar">
          <div className="sidebar-section">
            <h3 className="sidebar-section-title">我的排課偏好</h3>
            <PreferenceSourceBadge variant="compact" />
            {prefsError && <div className="error-text" role="alert" id="prefs-error">{prefsError}</div>}
            <div className="sidebar-prefs">
              {tagGroups.flatMap(group => group.tags).map(tag => (
                <label key={tag} className="sidebar-pref-item">
                  <input type="checkbox" checked={selectedTags.has(tag)} onChange={() => handlePrefToggle(tag)} />
                  {tag.replace('#', '')}
                </label>
              ))}
            </div>

            <div className="selected-prefs-summary" style={{ marginTop: '16px', padding: '10px', background: 'var(--bg-secondary, #f9fafb)', borderRadius: '8px', border: '1px solid var(--border-color, #e5e7eb)' }}>
              <div style={{ fontSize: '0.85rem', fontWeight: '600', marginBottom: '6px', color: 'var(--text-secondary, #4b5563)' }}>已套用的偏好項目：</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                {tagGroups.flatMap(group => group.tags).filter(tag => selectedTags.has(tag)).length > 0 ? (
                  tagGroups.flatMap(group => group.tags).filter(tag => selectedTags.has(tag)).map(tag => (
                    <span key={tag} style={{ fontSize: '0.75rem', backgroundColor: 'var(--accent-blue, #3b82f6)', color: 'white', padding: '2px 8px', borderRadius: '999px' }}>
                      {tag.replace('#', '')}
                    </span>
                  ))
                ) : (
                  <span style={{ fontSize: '0.8rem', color: '#9ca3af' }}>尚未勾選任何偏好</span>
                )}
              </div>
            </div>
          </div>

          <div className="sidebar-section" style={{ marginTop: '16px' }}>
            <h3 className="sidebar-section-title">🌳 個人專業技能</h3>
            <button
              onClick={() => setShowSkillModal(true)}
              style={{
                width: '100%', padding: '12px', borderRadius: '10px',
                backgroundColor: '#eff6ff', border: '1px solid #bfdbfe', color: '#1d4ed8',
                fontWeight: '600', fontSize: '0.9rem', cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
                transition: 'all 0.2s'
              }}
            >
              <Award size={18} /> 查看詳細技能樹與進度
            </button>
          </div>
        </aside>

        <div className="schedule-area">
          <div className="schedule-header-bar">
            <div className="schedule-stats">
              <span className="stat-badge course-badge">📚 {schedule.length} 門課</span>
              <span className="stat-badge credit-badge">🎓 {totalCredits} 學分</span>
              {totalCredits > 25 && <span className="stat-badge error-badge">⚠️ 已超修 (上限25)</span>}
              {totalCredits > 0 && totalCredits < minCredits && <span className="stat-badge warning-badge">⚠️ 低修警告 (下限{minCredits})</span>}
            </div>
            <div className="schedule-actions">
              <ExportDropdown schedule={schedule} gridElementId="schedule-grid-container" />
              <button className="action-btn primary" onClick={handleRegenerate}><Sparkles size={16} /> 套用偏好排課</button>
            </div>
          </div>
          
          <div className="schedule-top-stack">
            <ScheduleConfirmationBar
              confirmation={confirmation}
              personalizationEnabled={personalizationEnabled}
              onConfirmFit={handleConfirmFit}
              onRequestAdjust={handleRequestAdjust}
              onDismiss={() => setConfirmation(null)}
              isFading={isFading}
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

        <aside className="chat-panel">
          <div className="chat-header">
            <div className="chat-bot-avatar">🤖</div>
            <div className="chat-title-info">
              <h3>課表規劃助手</h3>
              <p>用自然語言告訴我你的需求吧</p>
            </div>
          </div>
          <div className="chat-messages" ref={chatScrollRef}>
            {chatHistory.map((msg, i) => (
              <div key={i} className={`chat-message ${msg.role}`}>
                <div className="message-bubble">{msg.text}</div>
              </div>
            ))}
          </div>
          <div className="chat-input-area">
            <div className="input-box">
              <input
                ref={chatInputRef}
                type="text"
                placeholder="輸入你的需求..."
                value={chatInput}
                onChange={e => setChatInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleChatSend()}
              />
              <button className="send-btn" onClick={() => handleChatSend()}><Send size={18} /></button>
            </div>
          </div>
        </aside>
      </div>

      <SkillTreeModal
        isOpen={showSkillModal}
        onClose={() => setShowSkillModal(false)}
        schedule={schedule}
      />

      <RemoveReasonDialog
        course={removalCandidate}
        onCancel={() => setRemovalCandidate(null)}
        onConfirm={handleRemoveConfirmed}
      />

      {!removalCandidate && (
        <CourseDetailModal
          course={detailCourse}
          onClose={() => setDetailCourse(null)}
          onRemove={handleRemoveClick}
          showTime={false}
        />
      )}
    </div>
  );
}