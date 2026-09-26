import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/useAuth';
import { useTheme } from '../contexts/useTheme';
import { useSchedule } from '../contexts/useSchedule';
import { useClickOutside } from '../hooks/useClickOutside';
import { Sparkles, BookOpen, Calendar, LayoutDashboard, Search, Settings, Moon, Sun, Save } from 'lucide-react';
import ScheduleGrid from '../components/Schedule/ScheduleGrid';
import RemoveReasonDialog from '../components/Schedule/RemoveReasonDialog';
import ScheduleConfirmationBar from '../components/Schedule/ScheduleConfirmationBar';
import ChatPanel from '../components/Chat/ChatPanel';
import CourseCard from '../components/CourseCard/CourseCard';
import CourseDetailModal from '../components/CourseCard/CourseDetailModal';
import ScheduleNotice from '../components/Schedule/ScheduleNotice';
import PlanSwitcher from '../components/Schedule/PlanSwitcher';
import PlanComparison from '../components/Schedule/PlanComparison';
import { makeNotice, buildScheduleNoticeForPlan } from '../utils/scheduleNotice';
import { getUserIdentity } from '../utils/userIdentity';
import { coursesAPI, profileAPI, scheduleAPI } from '../services/api';

const CLASS_REQUIRED_MESSAGE = '缺少班級資料，請先匯入學生班級再搜尋課程。';

export default function SchedulePage() {
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const userIdentity = getUserIdentity(user);
  const { theme, toggleTheme } = useTheme();
  const {
    schedule,
    watchlist,
    toggleWatchlist,
    saving,
    replaceSchedule,
    removeCourse,
    saveCurrentSchedule,
    buildRecommendation,
    logCourseViewed,
    logScheduleRegenerated,
    acceptRecommendation,
    personalizationEnabled,
    plans,
    selectedPlanId,
    planDiversity,
    selectPlan,
  } = useSchedule();

  const [courses, setCourses] = useState([]);
  const [selectedCourses, setSelectedCourses] = useState([]);
  const [showCourses, setShowCourses] = useState(false);
  const [filters, setFilters] = useState({ keyword: '', category: '', department: '' });
  const [courseSearchScope, setCourseSearchScope] = useState(null);
  const [loading, setLoading] = useState(false);
  const [detailCourse, setDetailCourse] = useState(null);
  const [confirmation, setConfirmation] = useState(null);
  
  const [removalCandidate, setRemovalCandidate] = useState(null);
  const [watchlistUpdatingId, setWatchlistUpdatingId] = useState('');

  const [notice, setNotice] = useState(null);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const userMenuRef = useRef(null);

  useClickOutside(userMenuRef, () => setShowUserMenu(false), showUserMenu);

  useEffect(() => {
    let cancelled = false;

    if (userIdentity === null) {
      setNotice(makeNotice({ level: 'error', message: '尚未登入，請重新登入後再操作。' }));
      return () => { cancelled = true; };
    }

    profileAPI.get()
      .then(profile => {
        if (cancelled) return;
        const scope = profile?.courseSearchScope || null;
        setCourseSearchScope(scope);
        setFilters(prev => ({ ...prev, department: scope?.department || '' }));
        if (!scope?.className) {
          setNotice(makeNotice({ level: 'error', message: CLASS_REQUIRED_MESSAGE }));
        }
      })
      .catch(err => {
        if (!cancelled) {
          setNotice(makeNotice({ level: 'error', message: err.message || CLASS_REQUIRED_MESSAGE }));
        }
      });

    return () => { cancelled = true; };
  }, [userIdentity]);

  const searchCourses = async () => {
    if (!courseSearchScope?.className) {
      setNotice(makeNotice({ level: 'error', message: CLASS_REQUIRED_MESSAGE }));
      return;
    }

    setLoading(true);
    try {
      const data = await coursesAPI.search({ ...filters, ...courseSearchScope });
      setCourses(data.courses || []);
      setShowCourses(true);
    } catch (err) {
      console.error('Search failed:', err);
      setNotice(makeNotice({ level: 'error', message: `課程搜尋失敗：${err.message}` }));
    } finally {
      setLoading(false);
    }
  };

  const toggleCourseSelection = (course) => {
    setSelectedCourses(prev => {
      const exists = prev.find(c => c.id === course.id);
      if (exists) return prev.filter(c => c.id !== course.id);
      return [...prev, course];
    });
  };

  const generateSchedule = async () => {
    if (userIdentity === null) {
      setNotice({ level: 'error', text: '尚未登入，無法產生個人化課表。' });
      return;
    }

    setLoading(true);
    try {
      const data = await scheduleAPI.generate({
        courseIds: selectedCourses.map(c => c.id),
        constraints: {},
        surface: 'schedule',
        trigger: 'manual_generate',
      });

      logScheduleRegenerated(data.requestId, { surface: 'schedule', trigger: 'manual_generate' });
      setNotice(buildScheduleNoticeForPlan(data));

      if (data.success) {
        replaceSchedule(data.schedule, buildRecommendation(data), data.plans, data.planDiversity);
        setConfirmation(data.requestId ? { state: 'pending' } : null);
        setShowCourses(false);
      }
    } catch (err) {
      setNotice(makeNotice({ level: 'error', message: `排課失敗：${err.message}` }));
    } finally {
      setLoading(false);
    }
  };

  const handleSelectPlan = (variantId) => {
    const target = plans.find(plan => plan.id === variantId);
    if (!selectPlan(variantId)) return;
    setNotice(prev => buildScheduleNoticeForPlan({ success: true, message: prev?.message }, target));
  };

  const handleScheduleFromChat = (newSchedule, result = null) => {
    replaceSchedule(
      newSchedule,
      result ? buildRecommendation(result) : null,
      result?.plans,
      result?.planDiversity
    );
    if (result) {
      setConfirmation(result.requestId ? { state: 'pending' } : null);
    }
    setShowCourses(false);
    setNotice(null);
  };

  const handleConfirmFit = async () => {
    const outcome = await acceptRecommendation();
    setConfirmation({ state: 'accepted', outcome });
  };

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
    if (event) event.stopPropagation();
    setWatchlistUpdatingId(String(course.id));
    await toggleWatchlist(course);
    setWatchlistUpdatingId('');
  };

  const totalCredits = schedule.reduce((sum, course) => sum + (course.credits || 0), 0);
  const graduationCredits = schedule.reduce(
    (sum, course) => (course.countsTowardGraduation === false ? sum : sum + (course.credits || 0)),
    0
  );
  const hasNonGraduationCredits = graduationCredits !== totalCredits;

  // 新增：動態判斷低修下限，優先讀取 courseSearchScope，若無則依賴 user 設定
  const minCredits = (courseSearchScope?.gradeLevel === 4 || user?.gradeLevel === 4) ? 9 : 12;

  return (
    <div className="layout-container" id="schedule-page">
      <header className="top-nav">
        <div className="nav-brand">
          <Calendar size={20} className="nav-icon" />
          <span>課表規劃助手</span>
        </div>
        <div className="nav-links">
          <button className="nav-btn" onClick={() => navigate('/')}><LayoutDashboard size={16}/> 首頁</button>
          <button className="nav-btn active"><Calendar size={16}/> 排課</button>
          <button className="nav-btn" onClick={() => navigate('/search')}><Search size={16}/> 尋找課程</button>
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
        <div className="schedule-area">
          {/* 替換的 schedule-header-bar */}
          <div className="schedule-header-bar">
            <div className="schedule-stats">
              <span className="stat-badge course-badge">📚 {schedule.length} 門課</span>
              <span className="stat-badge credit-badge">🎓 {totalCredits} 學分</span>
              
              {/* 超修與低修提示 */}
              {totalCredits > 25 && (
                <span className="stat-badge error-badge" style={{ backgroundColor: '#fee2e2', color: '#ef4444', padding: '4px 8px', borderRadius: '4px', fontSize: '0.85rem' }}>
                  ⚠️ 已超修 (上限25)
                </span>
              )}
              {totalCredits > 0 && totalCredits < minCredits && (
                <span className="stat-badge warning-badge" style={{ backgroundColor: '#fef3c7', color: '#d97706', padding: '4px 8px', borderRadius: '4px', fontSize: '0.85rem' }}>
                  ⚠️ 低修警告 (下限{minCredits})
                </span>
              )}

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
              <button className="action-btn secondary" onClick={() => setShowCourses(!showCourses)} id="toggle-courses-btn">
                <BookOpen size={16} />
                {showCourses ? '隱藏課程' : '瀏覽課程'}
              </button>
              <button className="action-btn primary" onClick={generateSchedule} disabled={loading} id="generate-btn">
                <Sparkles size={16} />
                {loading ? '排課中...' : '自動排課'}
              </button>
            </div>
          </div>

          <div className="schedule-top-stack">
            <ScheduleConfirmationBar
              confirmation={confirmation}
              personalizationEnabled={personalizationEnabled}
              onConfirmFit={handleConfirmFit}
              onRequestAdjust={() => setConfirmation({ state: 'adjusting' })}
              onDismiss={() => setConfirmation(null)}
            />

            <ScheduleNotice
              notice={notice}
              onDismiss={() => setNotice(null)}
              domId="schedule-page-notice"
            />

            <PlanSwitcher
              plans={plans}
              selectedPlanId={selectedPlanId}
              planDiversity={planDiversity}
              onSelectPlan={handleSelectPlan}
            />

            <PlanComparison
              plans={plans}
              constraints={{}}
              courseIds={selectedCourses.map(c => c.id)}
              surface="schedule"
            />
          </div>

          {showCourses && (
            <div className="course-browser" id="course-browser">
              <div className="course-browser-filters">
                <input
                  className="input-field"
                  placeholder="搜尋課程名稱..."
                  value={filters.keyword}
                  onChange={(e) => setFilters(f => ({ ...f, keyword: e.target.value }))}
                  id="course-search-input"
                />
                <input
                  className="input-field"
                  value={courseSearchScope
                    ? `${courseSearchScope.department}／${courseSearchScope.gradeLevel === 5 ? '研究所' : `大${courseSearchScope.gradeLevel}`}／${courseSearchScope.className}班`
                    : ''}
                  readOnly
                  disabled
                  placeholder="尚未匯入班級"
                  id="department-select"
                />
                <select className="input-field" value={filters.category} onChange={(e) => setFilters(f => ({ ...f, category: e.target.value }))} id="category-select">
                  <option value="">所有類別</option>
                  <option value="必修">必修</option>
                  <option value="核心選修">核心選修</option>
                  <option value="一般選修">一般選修</option>
                  <option value="系外選修">系外選修</option>
                  <option value="通識">通識</option>
                </select>
                <button className="action-btn primary" onClick={searchCourses} id="search-btn">搜尋</button>
              </div>

              {selectedCourses.length > 0 && (
                <div className="course-browser-selected">
                  已選 {selectedCourses.length} 門課（點擊「自動排課」使用已選課程排課）
                </div>
              )}

              <div className="course-browser-list">
                {courses.map(course => (
                  <CourseCard
                    key={course.id}
                    course={course}
                    onSelect={toggleCourseSelection}
                    selected={selectedCourses.some(c => c.id === course.id)}
                  />
                ))}
                {courses.length === 0 && (
                  <div className="course-browser-empty">
                    點擊搜尋瀏覽課程，或在右側對話框輸入需求
                  </div>
                )}
              </div>
            </div>
          )}

          <div className="schedule-wrapper">
            <ScheduleGrid courses={schedule} onCourseClick={handleOpenDetail} />
          </div>
        </div>

        <ChatPanel onScheduleGenerated={handleScheduleFromChat} />
      </div>

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