import { useState, useEffect, useRef } from 'react';
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
import { makeNotice, buildScheduleNotice, buildScheduleNoticeForPlan } from '../utils/scheduleNotice';
import { coursesAPI, profileAPI, scheduleAPI } from '../services/api';

const CLASS_REQUIRED_MESSAGE = '缺少班級資料，請先匯入學生班級再搜尋課程。';

export default function SchedulePage() {
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const {
    schedule,
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

  const [courses, setCourses] = useState([]);
  const [selectedCourses, setSelectedCourses] = useState([]);
  const [showCourses, setShowCourses] = useState(false);
  const [filters, setFilters] = useState({ keyword: '', category: '', department: '' });
  const [courseSearchScope, setCourseSearchScope] = useState(null);
  const [loading, setLoading] = useState(false);
  const [detailCourse, setDetailCourse] = useState(null);
  const [confirmation, setConfirmation] = useState(null);
  const [removalCandidate, setRemovalCandidate] = useState(null);
  const [notice, setNotice] = useState(null);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const userMenuRef = useRef(null);

  useClickOutside(userMenuRef, () => setShowUserMenu(false), showUserMenu);

  useEffect(() => {
    let cancelled = false;

    // 未登入時不呼叫，也不退回 `default` 使用者——那會讀到共用假帳號的 scope，
    // 畫面看起來正常但資料是別人的。
    if (!user?.studentId) {
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
  }, [user?.studentId]);

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
    if (!user?.studentId) {
      setNotice({ level: 'error', text: '尚未登入，無法產生個人化課表。' });
      return;
    }

    setLoading(true);
    try {
      // 曝光事件現在由伺服器在算出結果時直接寫入（roadmap #2 對抗式審查修正）；
      // 前端只送 `surface`／`trigger` 標記這次排課在哪個畫面、被什麼觸發。
      const data = await scheduleAPI.generate({
        courseIds: selectedCourses.map(c => c.id),
        constraints: {},
        surface: 'schedule',
        trigger: 'manual_generate',
      });

      logScheduleRegenerated(data.requestId, { surface: 'schedule', trigger: 'manual_generate' });

      // 原本這裡只看 `data.warnings`，excludedCourses／unscheduledCourses
      // 完全沒讀——排除原因在這一頁靜默消失。改用跟 DashboardPage 同一份
      // `buildScheduleNotice()`，兩頁的提示內容才一致。
      setNotice(buildScheduleNotice(data));

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

  // roadmap #27：切換方案後，提示訊息也要換成選中方案自己的排除原因與
  // 時間未定課程——理由與 DashboardPage 的 handleSelectPlan 相同。
  const handleSelectPlan = (variantId) => {
    const target = plans.find(plan => plan.id === variantId);
    if (!selectPlan(variantId)) return;
    setNotice(prev => buildScheduleNoticeForPlan({ success: true, message: prev?.message }, target));
  };

  // ChatPanel 只回傳課表陣列；帶得到完整結果時一併顯示確認提示。曝光事件
  // 已由伺服器在 `agentService.js` 呼叫排課時直接寫入，前端不用也不能回報。
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

  const handleSave = async () => {
    const result = await saveCurrentSchedule();
    setNotice(makeNotice({
      level: result.success ? 'success' : 'error',
      message: result.success ? '課表已儲存到目前登入帳號。' : result.message,
    }));
  };

  const totalCredits = schedule.reduce((sum, course) => sum + (course.credits || 0), 0);
  // 軍訓國防科技、體育、班級活動要排進課表但不計入畢業學分（校規）。
  // 後端在每門課上標記 countsTowardGraduation；未標記者一律視為計入。
  const graduationCredits = schedule.reduce(
    (sum, course) => (course.countsTowardGraduation === false ? sum : sum + (course.credits || 0)),
    0
  );
  const hasNonGraduationCredits = graduationCredits !== totalCredits;

  return (
    <div className="layout-container" id="schedule-page">
      {/* Top Navbar */}
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
        {/* Center: schedule + course browser */}
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
              <button
                className="action-btn secondary"
                onClick={handleSave}
                disabled={saving || schedule.length === 0}
                id="save-schedule-btn"
              >
                <Save size={16} />
                {saving ? '儲存中…' : '儲存課表'}
              </button>
              <button
                className="action-btn secondary"
                onClick={() => setShowCourses(!showCourses)}
                id="toggle-courses-btn"
              >
                <BookOpen size={16} />
                {showCourses ? '隱藏課程' : '瀏覽課程'}
              </button>
              <button
                className="action-btn primary"
                onClick={generateSchedule}
                disabled={loading}
                id="generate-btn"
              >
                <Sparkles size={16} />
                {loading ? '排課中...' : '自動排課'}
              </button>
            </div>
          </div>

          {/* roadmap #27：同 DashboardPage 的理由——`.schedule-wrapper` 是
              `flex:1`，方案切換／比較的文字量不設邊界會把課表格擠到幾乎消失。 */}
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
                    ? `${courseSearchScope.department}／大${courseSearchScope.grade}／${courseSearchScope.className}班`
                    : ''}
                  readOnly
                  disabled
                  placeholder="尚未匯入班級"
                  id="department-select"
                />
                <select
                  className="input-field"
                  value={filters.category}
                  onChange={(e) => setFilters(f => ({ ...f, category: e.target.value }))}
                  id="category-select"
                >
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

        {/* Right: AI chat */}
        <ChatPanel onScheduleGenerated={handleScheduleFromChat} />
      </div>

      <RemoveReasonDialog
        course={removalCandidate}
        onCancel={() => setRemovalCandidate(null)}
        onConfirm={handleRemoveConfirmed}
      />

      {/* Course Detail Modal */}
      <CourseDetailModal
        course={detailCourse}
        onClose={() => setDetailCourse(null)}
        onRemove={handleRemoveClick}
      />
    </div>
  );
}
