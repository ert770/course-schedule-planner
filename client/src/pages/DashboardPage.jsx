import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/useAuth';
import { useTheme } from '../contexts/useTheme';
import { useSchedule } from '../contexts/useSchedule'; 
import { scheduleAPI, chatAPI, profileAPI } from '../services/api';
import ScheduleGrid from '../components/Schedule/ScheduleGrid';
import { formatCourseTime } from '../utils/courseTime';
import { 
  X, Send, Search, Download, Loader2, Calendar, 
  LayoutDashboard, Settings, Moon, Sun, CheckCircle2, 
  Sparkles, Trash2, AlertTriangle 
} from 'lucide-react';

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
  
  
  const { schedule, setSchedule } = useSchedule();
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
  const [showUserMenu, setShowUserMenu] = useState(false);
  
  const chatInputRef = useRef(null);
  const chatScrollRef = useRef(null);

  // 計算學分防呆
  const totalCredits = schedule.reduce((sum, c) => sum + (Number(c.credits) || 0), 0);

  useEffect(() => {
    if (chatScrollRef.current) {
      chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
    }
  }, [chatHistory, chatLoading]); 

  const generateInitialSchedule = useCallback(async () => {
    if (schedule.length > 0) return; 

    setIsScheduling(true);
    try {
      if (!user?.studentId) {
        setScheduleNotice(makeNotice({
          level: 'error',
          message: '尚未登入，無法產生個人化課表。請重新登入後再試。',
        }));
        return;
      }

      const data = await scheduleAPI.generate({
        userId: user.studentId,
        constraints: { maxCredits: 25, minCredits: 12 },
      });

      setScheduleNotice(buildScheduleNotice(data));

      if (data.success) {
        setSchedule(data.schedule);
        setChatHistory(prev => [...prev, {
          role: 'bot',
          text: `成功生成課表！共 ${data.schedule.length} 門課，${data.totalCredits} 學分。`,
          schedule: data.schedule,
          totalCredits: data.totalCredits
        }]);
      }
    } catch (err) {
      console.error('Schedule generation failed:', err);
      setScheduleNotice(makeNotice({
        level: 'error',
        message: err.message || '無法連接到伺服器，請確認後端已啟動。',
        warnings: [],
        excluded: [],
        unscheduled: [],
      }));
    } finally {
      setTimeout(() => setIsScheduling(false), 1500);
    }
  }, [user?.studentId, schedule.length, setSchedule]);

  useEffect(() => {
    generateInitialSchedule();
  }, [generateInitialSchedule]);

  useEffect(() => {
    let cancelled = false;
    profileAPI.getPreferenceTags()
      .then(data => { if (!cancelled) setTagGroups(data.groups || []); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (!user?.studentId) return undefined;
    profileAPI.get(user.studentId)
      .then(profile => {
        if (!cancelled && Array.isArray(profile?.selectedTags)) {
          setSelectedTags(new Set(profile.selectedTags));
        }
      })
      .catch(err => { if (!cancelled) setPrefsError(err.message || '偏好設定載入失敗'); });
    return () => { cancelled = true; };
  }, [user?.studentId]);

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
      setSelectedTags(previous);
      setPrefsError(err.message || '偏好儲存失敗，請再試一次。');
    }
  };

  const handleRegenerate = async () => {
    setIsScheduling(true);
    try {
      const data = await scheduleAPI.generate({ userId: user?.studentId || 'default', constraints: { maxCredits: 25, minCredits: 12 } });
      setScheduleNotice(buildScheduleNotice(data));
      if (data.success) {
        setSchedule(data.schedule);
        setChatHistory(prev => [...prev, { 
          role: 'bot', text: `重新排課成功！共 ${data.schedule.length} 門課，${data.totalCredits} 學分。`, schedule: data.schedule
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

    if (!user?.studentId) {
      setChatHistory(prev => [...prev, { role: 'bot', text: '尚未登入，請重新登入後再試。' }]);
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
          role: 'bot', text: `成功生成課表！共 ${res.data.schedule.length} 門課。`, schedule: res.data.schedule
        }]);
      } else {
        setChatHistory(prev => [...prev, { role: 'bot', text: res.reply }]);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setChatLoading(false);
    }
  };

  const handleExport = () => {
    const text = schedule.map(c => `${c.name} | ${c.instructor} | ${formatCourseTime(c)}`).join('\n');
    const blob = new Blob([`預排課表\n\n${text}`], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = '預排課表.txt'; a.click(); URL.revokeObjectURL(url);
  };

  const handleRemoveCourse = (courseId) => {
    setSchedule(schedule.filter(c => c.id !== courseId));
    setDetailCourse(null); 
  };

  return (
    <div className="layout-container" id="dashboard-page" style={{ height: '100vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <header className="top-nav" style={{ flexShrink: 0 }}>
        <div className="nav-brand"><Calendar size={20} className="nav-icon" /><span>課表規劃助手</span></div>
        <div className="nav-links">
          <button className="nav-btn active"><LayoutDashboard size={16}/> 首頁</button>
          <button className="nav-btn" onClick={() => navigate('/schedule')}><Calendar size={16}/> 排課</button>
          <button className="nav-btn" onClick={() => navigate('/search')}><Search size={16}/> 尋找課程</button>
        </div>
        <div className="nav-actions">
          <div className="nav-user" style={{ position: 'relative' }}>
            <div className="user-trigger" onClick={() => setShowUserMenu(!showUserMenu)} style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
              <div className="avatar">{(user?.name || '同')[0]}</div><span>{user?.name || '同學'}</span>
            </div>
            {showUserMenu && (
              <>
                <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 98 }} onClick={() => setShowUserMenu(false)} />
                <div className="user-dropdown-menu" style={{ position: 'absolute', top: '100%', right: 0, zIndex: 99, marginTop: '8px' }}>
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
            {prefsError && <div className="error-text" role="alert" id="prefs-error">{prefsError}</div>}
            <div className="sidebar-prefs">
              {tagGroups.flatMap(g => g.tags).map(tag => (
                <label key={tag} className="sidebar-pref-item" style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <input type="checkbox" checked={selectedTags.has(tag)} onChange={() => handlePrefToggle(tag)} style={{ cursor: 'pointer' }}/>
                  {tag.replace('#', '')}
                </label>
              ))}
            </div>
          </div>
        </aside>

        <div className="schedule-area" style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div className="schedule-header-bar" style={{ flexShrink: 0 }}>
            <div className="schedule-stats">
              <span className="stat-badge course-badge">📚 {schedule.length} 門課</span>
              <span className="stat-badge credit-badge">🎓 {totalCredits} 學分</span>
            </div>
            <div className="schedule-actions">
              <button className="action-btn secondary" onClick={handleExport}>匯出</button>
              <button className="action-btn primary" onClick={handleRegenerate}><Sparkles size={16} /> 套用偏好排課</button>
            </div>
          </div>
          
          <div className="schedule-wrapper" style={{ flex: 1, overflowY: 'auto', paddingBottom: '24px' }}>
            {scheduleNotice && (
              <div className={`schedule-notice ${scheduleNotice.level}`} id="schedule-notice">
                <div className="schedule-notice-head">
                  <AlertTriangle size={16} /><span>{scheduleNotice.message}</span>
                  <button className="schedule-notice-close" onClick={() => setScheduleNotice(null)}><X size={14} /></button>
                </div>
                {scheduleNotice.warnings.length > 0 && <ul className="schedule-notice-list">{scheduleNotice.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>}
              </div>
            )}
            {isScheduling && <div className="scheduling-overlay"><Loader2 size={40} className="spin-animation" /><p>排課演算法執行中...</p></div>}
            <ScheduleGrid courses={schedule} onCourseClick={setDetailCourse} />
          </div>
        </div>

        <aside className="chat-panel" style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div className="chat-messages" ref={chatScrollRef} style={{ flex: 1, overflowY: 'auto' }}>
            {chatHistory.map((msg, i) => (
              <div key={i} className={`chat-message ${msg.role}`}>
                <div className="message-bubble">{msg.text}</div>
              </div>
            ))}
            {chatLoading && <div className="chat-message bot"><div className="message-bubble loading"><Loader2 size={16} className="spin-animation" /> 思考中...</div></div>}
          </div>
          <div className="chat-input-area" style={{ flexShrink: 0 }}>
            <form className="input-box" onSubmit={handleChatSubmit} style={{ display: 'flex', width: '100%' }}>
              <input ref={chatInputRef} type="text" placeholder="輸入需求..." value={chatInput} onChange={e => setChatInput(e.target.value)} disabled={chatLoading} style={{ flex: 1 }} />
              <button type="submit" className="send-btn" disabled={!chatInput.trim() || chatLoading}><Send size={18} /></button>
            </form>
          </div>
        </aside>
      </div>

      {detailCourse && (
        <div className="modal-overlay" onClick={() => setDetailCourse(null)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <button className="modal-close" onClick={() => setDetailCourse(null)}>✕</button>
            <h2>{detailCourse.name}</h2>
            <div style={{ marginTop: '24px', display: 'flex', justifyContent: 'flex-end' }}>
              <button onClick={() => handleRemoveCourse(detailCourse.id)} style={{ padding: '8px 16px', backgroundColor: '#ef4444', color: '#fff', borderRadius: '6px' }}>從課表中移除</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}