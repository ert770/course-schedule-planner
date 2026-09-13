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
import { formatCourseTime } from '../utils/courseTime';
import { X, Send, Search, Loader2, Calendar, LayoutDashboard, Settings, Moon, Sun, CheckCircle2, Sparkles, AlertTriangle, TreePine } from 'lucide-react';

const MAX_EXCLUDED_SHOWN = 5;

function makeNotice({ level, message, warnings = [], excluded = [], unscheduled = [] }) {
  return { level, message, warnings, excluded, unscheduled };
}

function buildScheduleNotice(data) {
  const excluded = data.excludedCourses || [];
  const unscheduled = data.unscheduledCourses || [];
  const message = data.message || '無法產生符合限制的課表。';
  const warnings = (data.warnings || []).filter(warning => warning !== message);

  if (!data.success) {
    return makeNotice({ level: 'error', message, warnings, excluded, unscheduled });
  }
  if (data.watchOnly || warnings.length > 0 || excluded.length > 0 || unscheduled.length > 0) {
    return makeNotice({ level: 'warning', message, warnings, excluded, unscheduled });
  }
  return null;
}

export default function DashboardPage() {
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const {
    schedule,
    watchlist,
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
    toggleWatchlist,
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
  
  // 觸發退課原因與技能樹彈窗的狀態
  const [removalCandidate, setRemovalCandidate] = useState(null);
  const [watchlistUpdatingId, setWatchlistUpdatingId] = useState('');
  const [showSkillTreeModal, setShowSkillTreeModal] = useState(false);
  
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

  const generateInitialSchedule = useCallback(async (trigger = 'initial_load') => {
    setIsScheduling(true);
    try {
      const constraints = { maxCredits: 25, minCredits: 12 };
      if (!user?.studentId) {
        setScheduleNotice(makeNotice({ level: 'error', message: '尚未登入，無法產生個人化課表。' }));
        return;
      }
      const data = await scheduleAPI.generate({ constraints, surface: 'dashboard', trigger });
      setScheduleNotice(buildScheduleNotice(data));

      if (trigger !== 'initial_load') {
        logScheduleRegenerated(data.requestId, { surface: 'dashboard', trigger });
      }
      if (data.success) {
        replaceSchedule(data.schedule, buildRecommendation(data));
        setConfirmation(data.requestId ? { state: 'pending' } : null);
      }
    } catch (err) {
      setScheduleNotice(makeNotice({ level: 'error', message: err.message || '無法連接到伺服器。' }));
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

  useEffect(() => {
    let cancelled = false;
    profileAPI.getPreferenceTags().then(data => { if (!cancelled) setTagGroups(data.groups || []); }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (!user?.studentId) return undefined;
    profileAPI.get().then(profile => {
      if (!cancelled && Array.isArray(profile?.selectedTags)) {
        setSelectedTags(new Set(profile.selectedTags));
      }
    }).catch(err => { if (!cancelled) setPrefsError(err.message || '偏好設定載入失敗'); });
    return () => { cancelled = true; };
  }, [user?.studentId]);

  const handlePrefToggle = async (tag) => {
    const next = new Set(selectedTags);
    if (next.has(tag)) next.delete(tag); else next.add(tag);

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
      setSelectedTags(previous);
      setPrefsError(err.message || '偏好儲存失敗，請再試一次。');
    }
  };

  const handleRegenerate = () => generateInitialSchedule('preference_regenerate');

  const handleChatSend = async (overrideMsg) => {
    const msg = overrideMsg || chatInput.trim();
    if (!msg || chatLoading) return;
    if (!user?.studentId) return;
    setChatInput('');
    setChatHistory(prev => [...prev, { role: 'user', text: msg }]);
    setChatLoading(true);

    try {
      const res = await chatAPI.send(msg);
      if (res.intent === 'run_csp_scheduler' && res.data?.success) {
        replaceSchedule(res.data.schedule, buildRecommendation(res.data));
        setChatHistory(prev => [...prev, { 
          role: 'bot', 
          text: `成功生成課表！共 ${res.data.schedule.length} 門課，${res.data.totalCredits} 學分。`,
          schedule: res.data.schedule
        }]);
      } else {
        setChatHistory(prev => [...prev, { role: 'bot', text: res.reply }]);
      }
    } finally {
      setChatLoading(false);
    }
  };

  const handleConfirmFit = async () => {
    const outcome = await acceptRecommendation();
    setConfirmation({ state: 'accepted', outcome });
  };

  // ✅ 圖層修正關鍵：開啟退課視窗同時，關閉詳細資訊彈窗
  const handleRemoveClick = (course) => {
    setRemovalCandidate(course); 
    setDetailCourse(null);       
  };

  const handleRemoveConfirmed = (feedbackReason) => {
    if (removalCandidate) {
      removeCourse(removalCandidate.id, { feedbackReason });
    }
    setRemovalCandidate(null);
  };

  const handleOpenDetail = (course) => {
    setDetailCourse(course);
    logCourseViewed(course);
  };

  const handleToggleWatchlist = async (event, course) => {
    event.stopPropagation();
    setWatchlistUpdatingId(String(course.id));
    await toggleWatchlist(course);
    setWatchlistUpdatingId('');
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
                <button className="user-dropdown-item" onClick={toggleTheme}>切換主題</button>
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
            {prefsError && <div className="error-text" role="alert">{prefsError}</div>}
            <div className="sidebar-prefs">
              {tagGroups.flatMap(group => group.tags).map(tag => (
                <label key={tag} className="sidebar-pref-item">
                  <input type="checkbox" checked={selectedTags.has(tag)} onChange={() => handlePrefToggle(tag)} />
                  {tag.replace('#', '')}
                </label>
              ))}
            </div>
          </div>

          <div className="sidebar-section" style={{ marginTop: '24px' }}>
            <h3 className="sidebar-section-title">我的專業技能樹</h3>
            <button 
              className="skill-tree-entry-btn"
              onClick={() => setShowSkillTreeModal(true)}
              style={{
                width: '100%', padding: '16px', background: 'var(--bg-card, #fff)', 
                border: '1px solid var(--border-color, #e5e7eb)', borderRadius: '8px', 
                cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', 
                gap: '8px', transition: 'all 0.2s', boxShadow: '0 2px 4px rgba(0,0,0,0.05)'
              }}
            >
              <TreePine size={32} color="var(--accent-blue, #3b82f6)" />
              <span style={{ fontWeight: '600', color: 'var(--text-primary, #1f2937)' }}>前往技能樹專屬畫布</span>
              <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary, #6b7280)' }}>點擊查看各項能力指標</span>
            </button>
          </div>
        </aside>

        <div className="schedule-area">
          <div className="schedule-header-bar">
            <div className="schedule-stats">
              <span className="stat-badge course-badge">📚 {schedule.length} 門課</span>
              <span className="stat-badge credit-badge">🎓 {totalCredits} 學分</span>
            </div>
            <div className="schedule-actions">
              <ExportDropdown schedule={schedule} gridElementId="schedule-grid-container" />
              <button className="action-btn secondary" onClick={handleSave} disabled={saving || schedule.length === 0}>
                儲存課表
              </button>
              <button className="action-btn primary" onClick={handleRegenerate}>
                <Sparkles size={16} /> 套用偏好排課
              </button>
            </div>
          </div>
          
          <ScheduleConfirmationBar
            confirmation={confirmation}
            personalizationEnabled={personalizationEnabled}
            onConfirmFit={handleConfirmFit}
            onRequestAdjust={() => setConfirmation({ state: 'adjusting' })}
            onDismiss={() => setConfirmation(null)}
          />

          {scheduleNotice && (
            <div className={`schedule-notice ${scheduleNotice.level}`}>
              <div className="schedule-notice-head">
                <AlertTriangle size={16} /><span>{scheduleNotice.message}</span>
                <button className="schedule-notice-close" onClick={() => setScheduleNotice(null)}><X size={14} /></button>
              </div>
            </div>
          )}

          <div className="schedule-wrapper">
            {isScheduling && (
              <div className="scheduling-overlay">
                <Loader2 size={40} className="spin-animation" /><p>Agent 正在呼叫排課演算法...</p>
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
              <h3>課表規劃助手</h3><p>用自然語言告訴我你的需求</p>
            </div>
          </div>
          <div className="chat-messages" ref={chatScrollRef}>
            {chatHistory.map((msg, i) => (
              <div key={i} className={`chat-message ${msg.role}`}>
                <div className="message-bubble">{msg.text}</div>
              </div>
            ))}
            {chatLoading && <div className="chat-message bot"><div className="message-bubble loading"><Loader2 size={16} className="spin-animation" /> 思考中...</div></div>}
          </div>
          <div className="chat-input-area">
            <div className="input-box">
              <input ref={chatInputRef} type="text" placeholder="輸入需求..." value={chatInput} onChange={e => setChatInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleChatSend()} disabled={chatLoading} />
              <button className="send-btn" onClick={() => handleChatSend()} disabled={!chatInput.trim() || chatLoading}><Send size={18} /></button>
            </div>
          </div>
        </aside>
      </div>

      {/* 技能樹專屬 Modal */}
      {showSkillTreeModal && (
        <div className="modal-overlay" onClick={() => setShowSkillTreeModal(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()} style={{ width: '400px' }}>
            <button className="modal-close" onClick={() => setShowSkillTreeModal(false)}>✕</button>
            <h3 className="sidebar-section-title" style={{ marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <TreePine size={20} color="var(--accent-blue, #3b82f6)" /> 我的專業技能樹
            </h3>
            <p className="sidebar-skill-desc" style={{ marginBottom: '24px' }}>基於歷年成績與修課紀錄動態生成</p>
            
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

            <div className="skill-overall" style={{ marginTop: '24px' }}>
              <span className="skill-overall-score">整體能力指數</span>
              <span className="score-value">80 / 100</span>
            </div>
            <div className="skill-bar overall-bar"><div className="skill-bar-fill overall" style={{width: '80%'}}></div></div>
          </div>
        </div>
      )}

      <RemoveReasonDialog
        course={removalCandidate}
        onCancel={() => setRemovalCandidate(null)}
        onConfirm={handleRemoveConfirmed}
      />

      <CourseDetailModal
        course={detailCourse}
        onClose={() => setDetailCourse(null)}
        isWatched={detailCourse ? watchlist.includes(String(detailCourse.id)) : false}
        isAdded={detailCourse ? schedule.some(item => String(item.id) === String(detailCourse.id)) : false}
        onToggleWatchlist={handleToggleWatchlist}
        onRemove={handleRemoveClick}
        watchlistUpdating={detailCourse ? watchlistUpdatingId === String(detailCourse.id) : false}
      />
    </div>
  );
}