import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/useAuth';
import { useTheme } from '../contexts/useTheme';
import { useSchedule } from '../contexts/useSchedule';
import { useClickOutside } from '../hooks/useClickOutside';
import { coursesAPI, profileAPI } from '../services/api';
import RemoveReasonDialog from '../components/Schedule/RemoveReasonDialog';
import CourseDetailModal from '../components/CourseCard/CourseDetailModal';
import { Calendar, Search, LayoutDashboard, Settings, Moon, Sun, Heart, Plus, RotateCcw, X, Compass, GripVertical, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import '../App.css'; 
import { formatCourseTime } from '../utils/courseTime';
import { getUserIdentity } from '../utils/userIdentity';
import { formatCourseGradeLevel } from '../utils/courseGradeLevel';

const GRADE_CLASS_MAP = {
  '1': ['資訊一甲', '資訊一乙', '資訊一丙', '合'],
  '2': ['資訊二甲', '資訊二乙', '資訊二丙', '資訊二丁', '合'],
  '3': ['資訊三甲', '資訊三乙', '資訊三丙', '資訊三丁', '合'],
  '4': ['資訊四甲', '資訊四乙', '資訊四丙', '資訊四丁', '合'],
  '5': ['合'],
};

export default function SearchPage() {
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const userIdentity = getUserIdentity(user);
  const { theme, toggleTheme } = useTheme();
  const {
    schedule, watchlist, validating, addCourse, removeCourse, toggleWatchlist, logCourseViewed, personalizationEnabled
  } = useSchedule();
  
  const [activeTab, setActiveTab] = useState('dept');
  const [searchResults, setSearchResults] = useState([]);
  const [isSearching, setIsSearching] = useState(false);
  const [detailCourse, setDetailCourse] = useState(null);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [actionNotice, setActionNotice] = useState(null);
  const [watchlistUpdatingId, setWatchlistUpdatingId] = useState('');
  const [watchlistCourses, setWatchlistCourses] = useState([]);
  const [watchlistLoading, setWatchlistLoading] = useState(false);
  const [watchlistError, setWatchlistError] = useState('');
  const [removalCandidate, setRemovalCandidate] = useState(null);
  
  const [sidebarWidth, setSidebarWidth] = useState(340);
  const [isResizing, setIsResizing] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  
  const userMenuRef = useRef(null);
  useClickOutside(userMenuRef, () => setShowUserMenu(false), showUserMenu);

  const [deptForm, setDeptForm] = useState({
    department: '資訊工程學系',
    gradeLevel: '4',
    className: '合',
    category: '',
    keyword: ''
  });

  const [condForm, setCondForm] = useState({
    code: '', dayOfWeek: '', period: '', keyword: '', instructor: '', language: '', isGenEd: false, description: ''
  });

  const availableClasses = deptForm.gradeLevel 
    ? GRADE_CLASS_MAP[deptForm.gradeLevel] || ['合']
    : [...new Set(Object.values(GRADE_CLASS_MAP).flat())];

  const handleGradeChange = (e) => {
    const newGrade = e.target.value;
    const validClasses = GRADE_CLASS_MAP[newGrade] || [];
    setDeptForm(prev => ({
      ...prev,
      gradeLevel: newGrade,
      className: validClasses.includes(prev.className) ? prev.className : '合'
    }));
  };

  const startResizing = (e) => {
    setIsResizing(true);
    e.preventDefault();
  };

  useEffect(() => {
    const handleMouseMove = (e) => {
      if (!isResizing) return;
      let newWidth = e.clientX;
      if (newWidth < 280) newWidth = 280;
      if (newWidth > 600) newWidth = 600;
      setSidebarWidth(newWidth);
    };

    const handleMouseUp = () => {
      setIsResizing(false);
    };

    if (isResizing) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    } else {
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizing]);

  useEffect(() => {
    let cancelled = false;
    if (userIdentity === null) {
      setSearchError('尚未登入，請重新登入後再操作。');
      return () => { cancelled = true; };
    }

    profileAPI.get()
      .then(profile => {
        if (cancelled) return;
        const scope = profile?.courseSearchScope || null;
        if (scope) {
          setDeptForm(prev => ({
            ...prev,
            department: '資訊工程學系',
            gradeLevel: scope.gradeLevel ? String(scope.gradeLevel) : '4',
            className: scope.className || '合',
          }));
        }
      })
      .catch(() => {});

    return () => { cancelled = true; };
  }, [userIdentity]);

  useEffect(() => {
    if (activeTab !== 'watchlist') return undefined;
    if (watchlist.length === 0) {
      setWatchlistCourses([]);
      setWatchlistError('');
      setWatchlistLoading(false);
      return undefined;
    }

    let cancelled = false;
    setWatchlistLoading(true);
    setWatchlistError('');

    Promise.allSettled(watchlist.map(id => coursesAPI.getDetail(id)))
      .then(results => {
        if (cancelled) return;
        const courses = results
          .filter(result => result.status === 'fulfilled')
          .map(result => result.value);
        setWatchlistCourses(courses);
        const unavailableCount = results.length - courses.length;
        if (unavailableCount > 0) {
          setWatchlistError(`有 ${unavailableCount} 門關注課程目前無法載入，其他課程仍可正常管理。`);
        }
      })
      .finally(() => {
        if (!cancelled) setWatchlistLoading(false);
      });

    return () => { cancelled = true; };
  }, [activeTab, watchlist]);

  const handleDeptSearch = async (e) => {
    e.preventDefault();
    setIsSearching(true);
    setSearchError('');
    try {
      const filters = { 
        department: '資訊工程學系',
        gradeLevel: deptForm.gradeLevel ? Number(deptForm.gradeLevel) : undefined,
        className: deptForm.className,
        keyword: deptForm.keyword, 
        category: deptForm.category 
      };
      Object.keys(filters).forEach(k => { if (!filters[k]) delete filters[k]; });
      const data = await coursesAPI.search(filters);
      setSearchResults(data.courses || []);
    } catch (err) {
      setSearchError(err.message || '課程搜尋失敗');
    } finally {
      setIsSearching(false);
    }
  };

  const handleCondSearch = async (e) => {
    e.preventDefault();
    setIsSearching(true);
    setSearchError('');
    try {
      const filters = {
        code: condForm.code, 
        keyword: condForm.keyword || condForm.description,
        instructor: condForm.instructor, 
        dayOfWeek: condForm.dayOfWeek ? parseInt(condForm.dayOfWeek) : null,
        period: condForm.period, 
        category: condForm.isGenEd ? '通識' : null, 
        language: condForm.language
      };
      Object.keys(filters).forEach(k => { if (filters[k] === null || filters[k] === '') delete filters[k]; });
      
      const data = await coursesAPI.search(filters);
      setSearchResults(data.courses || []);
    } catch (err) {
      setSearchError(err.message || '課程搜尋失敗');
    } finally {
      setIsSearching(false);
    }
  };

  const handleAddCourse = async (event, course) => {
    if (event) event.stopPropagation();
    setActionNotice(null);
    const result = await addCourse(course);
    setActionNotice({
      level: result.success ? 'success' : 'error',
      text: result.success ? `已將「${course.name}」加入課表。` : result.message,
    });
  };

  const handleToggleCourse = async (event, course) => {
    if (event) event.stopPropagation();
    const isAdded = schedule.some(item => String(item.id) === String(course.id));
    if (isAdded) {
      setDetailCourse(null);
      if (!personalizationEnabled) {
        removeCourse(course.id);
        setActionNotice({ level: 'success', text: '已將「' + course.name + '」從課表移除。' });
        return;
      }
      setRemovalCandidate(course);
      return;
    }
    await handleAddCourse(event, course);
  };
  
  const handleOpenDetail = (course) => {
    setDetailCourse(course);
    logCourseViewed(course);
  };

  const handleRemoveConfirmed = (feedbackReason) => {
    const course = removalCandidate;
    setRemovalCandidate(null);
    if (!course) return;
    removeCourse(course.id, { feedbackReason });
    setActionNotice({ level: 'success', text: `已將「${course.name}」從課表移除。` });
  };

  const handleToggleWatchlist = async (event, course) => {
    if (event) event.stopPropagation();
    const id = String(course.id);
    setWatchlistUpdatingId(id);
    setActionNotice(null);
    const result = await toggleWatchlist(course);
    setWatchlistUpdatingId('');
    setActionNotice({
      level: result.success ? 'success' : 'error',
      text: result.success
        ? (result.watching ? `已關注「${course.name}」。` : `已取消關注「${course.name}」。`)
        : result.message,
    });
  };

  const handleResetDeptForm = () => {
    setDeptForm({ department: '資訊工程學系', gradeLevel: '', className: '合', category: '', keyword: '' });
    setSearchError('');
    setActionNotice(null);
  };

  const handleResetCondForm = () => {
    setCondForm({ code: '', dayOfWeek: '', period: '', keyword: '', instructor: '', language: '', isGenEd: false, description: '' });
    setSearchError('');
    setActionNotice(null);
  };

  const displayCourses = activeTab === 'watchlist' ? watchlistCourses : searchResults;
  const resultError = activeTab === 'watchlist' ? watchlistError : searchError;

  return (
    <div className="layout-container" id="search-page">
      <header className="top-nav">
        <div className="nav-brand">
          <Calendar size={20} className="nav-icon" />
          <span>課表規劃助手</span>
        </div>
        <div className="nav-links">
          <button className="nav-btn" onClick={() => navigate('/')}><LayoutDashboard size={16}/> 首頁</button>
          <button className="nav-btn active"><Search size={16}/> 尋找課程</button>
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

      <div className="search-content" style={{ display: 'flex', overflow: 'hidden', position: 'relative', height: '100%' }}>
        
        <div 
          className="search-sidebar" 
          style={{ 
            width: isSidebarOpen ? `${sidebarWidth}px` : '0px', 
            minWidth: isSidebarOpen ? `${sidebarWidth}px` : '0px',
            opacity: isSidebarOpen ? 1 : 0,
            padding: isSidebarOpen ? undefined : '0',
            overflowY: 'auto',
            borderRight: 'none',
            transition: 'width 0.3s ease, min-width 0.3s ease, opacity 0.3s ease, padding 0.3s ease'
          }}
        >
          <h2>課程查詢</h2>
          <div className="search-tabs">
            <button className={`search-tab ${activeTab === 'dept' ? 'active' : ''}`} onClick={() => setActiveTab('dept')}>查詢本系課程</button>
            <button className={`search-tab ${activeTab === 'cond' ? 'active' : ''}`} onClick={() => setActiveTab('cond')}>查詢全校課程</button>
            <button className={`search-tab ${activeTab === 'watchlist' ? 'active' : ''}`} onClick={() => setActiveTab('watchlist')}>❤️ 我的關注</button>
          </div>

          {activeTab === 'dept' && (
            <form className="search-form" onSubmit={handleDeptSearch}>
              <div className="form-group">
                <label>系所 (Department)</label>
                <select 
                  value="資訊工程學系" 
                  disabled 
                  style={{ backgroundColor: '#f1f5f9', color: '#64748b', cursor: 'not-allowed' }}
                >
                  <option value="資訊工程學系">資訊工程學系</option>
                </select>
              </div>
              <div className="form-group">
                <label>年級 (Grade)</label>
                <select value={deptForm.gradeLevel} onChange={handleGradeChange}>
                  <option value="">全部 (All)</option>
                  <option value="1">大一</option>
                  <option value="2">大二</option>
                  <option value="3">大三</option>
                  <option value="4">大四</option>
                  <option value="5">研究所</option>
                </select>
              </div>
              <div className="form-group">
                <label>班級 (Class)</label>
                <select value={deptForm.className} onChange={e => setDeptForm({...deptForm, className: e.target.value})}>
                  <option value="">請選擇班級</option>
                  {availableClasses.map(cls => (
                    <option key={cls} value={cls}>{cls}</option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label>修別 (Category)</label>
                <select value={deptForm.category} onChange={e => setDeptForm({...deptForm, category: e.target.value})}>
                  <option value="">全部 (All)</option>
                  <option value="必修">必修 (Required)</option>
                  <option value="核心選修">核心選修 (Core Elective)</option>
                  <option value="一般選修">一般選修 (Elective)</option>
                  <option value="系外選修">系外選修 (Outside Elective)</option>
                  <option value="通識">通識 (General Education)</option>
                </select>
              </div>
              <div className="form-group">
                <label>課程關鍵字</label>
                <input type="text" placeholder="輸入課名或老師..." value={deptForm.keyword} onChange={e => setDeptForm({...deptForm, keyword: e.target.value})} />
              </div>
              <div className="search-form-actions">
                <button type="submit" className="search-submit-btn" disabled={isSearching}>{isSearching ? '搜尋中...' : '開始搜尋'}</button>
                <button type="button" className="search-reset-btn" onClick={handleResetDeptForm} disabled={isSearching}><RotateCcw size={17} /></button>
              </div>
            </form>
          )}

          {activeTab === 'cond' && (
            <form className="search-form" onSubmit={handleCondSearch}>
              <div className="form-group">
                <label>選課代號 (Course ID)</label>
                <input type="text" placeholder="[請輸入代號]" value={condForm.code} onChange={e => setCondForm({...condForm, code: e.target.value})} />
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>星期 (Day)</label>
                  <select value={condForm.dayOfWeek} onChange={e => setCondForm({...condForm, dayOfWeek: e.target.value})}>
                    <option value="">全部 (All)</option>
                    <option value="1">星期一</option>
                    <option value="2">星期二</option>
                    <option value="3">星期三</option>
                    <option value="4">星期四</option>
                    <option value="5">星期五</option>
                  </select>
                </div>
                <div className="form-group">
                  <label>節次 (Period)</label>
                  <select value={condForm.period} onChange={e => setCondForm({...condForm, period: e.target.value})}>
                    <option value="">全部 (All)</option>
                    {[...Array(14)].map((_, i) => (<option key={i+1} value={i+1}>第 {i+1} 節</option>))}
                  </select>
                </div>
              </div>
              <div className="form-group">
                <label>科目名稱 (Course Title)</label>
                <input type="text" placeholder="[請輸入關鍵字]" value={condForm.keyword} onChange={e => setCondForm({...condForm, keyword: e.target.value})} />
              </div>
              <div className="form-group">
                <label>開課教師姓名 (Instructor)</label>
                <input type="text" placeholder="[請輸入姓名]" value={condForm.instructor} onChange={e => setCondForm({...condForm, instructor: e.target.value})} />
              </div>
              <div className="form-group">
                <label>授課語言 (Language)</label>
                <select value={condForm.language} onChange={e => setCondForm({...condForm, language: e.target.value})}>
                  <option value="">全部 (All)</option>
                  <option value="中文 (Chinese)">中文 (Chinese)</option>
                  <option value="English">English</option>
                </select>
              </div>
              <div className="form-group checkbox-group" style={{ marginTop: '4px' }}>
                <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }}>
                  <input type="checkbox" checked={condForm.isGenEd} onChange={e => setCondForm({...condForm, isGenEd: e.target.checked})} style={{ marginRight: '8px' }} />
                  特定科目類別：通識課程
                </label>
              </div>
              <div className="form-group">
                <label>課程描述 (Description)</label>
                <input type="text" placeholder="[請輸入關鍵字]" value={condForm.description} onChange={e => setCondForm({...condForm, description: e.target.value})} />
              </div>
              <div className="search-form-actions">
                <button type="submit" className="search-submit-btn" disabled={isSearching}>{isSearching ? '搜尋中...' : '開始搜尋'}</button>
                <button type="button" className="search-reset-btn" onClick={handleResetCondForm} disabled={isSearching}><RotateCcw size={17} /></button>
              </div>
            </form>
          )}

          {activeTab === 'watchlist' && (
            <div className="watchlist-help">
              <Heart size={42} aria-hidden="true" />
              <h3>關注清單</h3>
              <p>關注資料保存在目前登入帳號中，可在這裡集中比較、加選或取消關注。</p>
            </div>
          )}
        </div>

        {isSidebarOpen && (
          <div
            onMouseDown={startResizing}
            style={{
              width: '16px',
              cursor: 'col-resize',
              backgroundColor: isResizing ? '#e0f2fe' : '#f8fafc',
              borderLeft: '1px solid #cbd5e1',
              borderRight: '1px solid #cbd5e1',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'background-color 0.15s ease',
              zIndex: 10,
              boxShadow: isResizing ? 'inset 0 0 8px rgba(59, 130, 246, 0.2)' : 'none'
            }}
            onMouseOver={(e) => { if (!isResizing) e.currentTarget.style.backgroundColor = '#f1f5f9' }}
            onMouseOut={(e) => { if (!isResizing) e.currentTarget.style.backgroundColor = '#f8fafc' }}
            title="左右拖曳以調整版面寬度"
          >
            <GripVertical size={20} color={isResizing ? '#3b82f6' : '#94a3b8'} />
          </div>
        )}

        <div className="search-results-area" style={{ flexGrow: 1, overflowY: 'auto', paddingLeft: '20px' }}>
          <div className="results-header" style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
            <button 
              onClick={() => setIsSidebarOpen(!isSidebarOpen)}
              style={{ 
                background: '#f8fafc', border: '1px solid #e2e8f0', cursor: 'pointer', 
                color: '#64748b', display: 'flex', alignItems: 'center', justifyContent: 'center',
                padding: '8px', borderRadius: '8px', transition: 'all 0.2s'
              }}
              onMouseOver={(e) => { e.currentTarget.style.background = '#f1f5f9'; e.currentTarget.style.color = '#3b82f6'; }}
              onMouseOut={(e) => { e.currentTarget.style.background = '#f8fafc'; e.currentTarget.style.color = '#64748b'; }}
              title={isSidebarOpen ? "收合左側查詢列" : "展開左側查詢列"}
            >
              {isSidebarOpen ? <PanelLeftClose size={20} /> : <PanelLeftOpen size={20} />}
            </button>
            <h3 style={{ margin: 0, fontSize: '1.25rem' }}>
              {activeTab === 'watchlist' ? '我的關注清單' : '搜尋結果'} ({displayCourses.length} 筆)
            </h3>
          </div>

          {actionNotice && <div className={`search-action-notice ${actionNotice.level}`} role="status">{actionNotice.text}</div>}
          {resultError && <div className="search-action-notice error" role="alert">{resultError}</div>}
          
          {watchlistLoading ? (
            <div className="no-results" role="status">正在載入關注課程…</div>
          ) : displayCourses.length === 0 && !resultError ? (
            <div className="no-results" style={{ color: '#64748b' }}>
              {activeTab === 'watchlist' ? '目前沒有關注課程。' : '請設定條件並開始搜尋'}
            </div>
          ) : displayCourses.length > 0 ? (
            <div className="results-grid">
              {displayCourses.map(course => (
                <div key={course.id} className="course-card" onClick={() => handleOpenDetail(course)}>
                  <div className="course-card-header">
                    <h4>{course.name}</h4><span className="course-code">{course.code}</span>
                  </div>
                  <div className="course-card-body">
                    <p>👨‍🏫 {course.instructor} | 🏢 {course.department}</p>
                    <p>⏰ {formatCourseTime(course)}</p>
                    <p>📍 {course.location}</p>
                  </div>
                  <div className="course-card-footer">
                    <span className="tag">{course.category}</span>
                    <span className="tag">{course.credits} 學分</span>
                    <span className="tag">{formatCourseGradeLevel(course.gradeLevel)}</span>
                    {course.category === '通識' && (
                      <span className="tag">
                        {course.generalEducationDomain || '不分領域'}
                      </span>
                    )}
                  </div>
                  <div className="course-card-actions">
                    <button type="button" className={`course-card-action ${watchlist.includes(String(course.id)) ? 'active' : ''}`} onClick={event => handleToggleWatchlist(event, course)} disabled={watchlistUpdatingId === String(course.id)}>
                      <Heart size={15} fill={watchlist.includes(String(course.id)) ? 'currentColor' : 'none'} />
                      {watchlistUpdatingId === String(course.id) ? '更新中…' : (watchlist.includes(String(course.id)) ? '已關注' : '關注')}
                    </button>
                    <button type="button" className={`course-card-action ${schedule.some(item => String(item.id) === String(course.id)) ? 'danger' : 'primary'}`} onClick={event => handleToggleCourse(event, course)} disabled={validating && !schedule.some(item => String(item.id) === String(course.id))}>
                      {schedule.some(item => String(item.id) === String(course.id)) ? <><X size={15} /> 取消加選</> : <><Plus size={15} /> {validating ? '驗證中…' : '加入課表'}</>}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : null}
        </div>
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
        onToggleCourse={handleToggleCourse}
        validating={validating}
        watchlistUpdating={detailCourse ? watchlistUpdatingId === String(detailCourse.id) : false}
      />
    </div>
  );
}