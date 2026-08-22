import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/useAuth';
import { useTheme } from '../contexts/useTheme';
import { useSchedule } from '../contexts/useSchedule';
import { useClickOutside } from '../hooks/useClickOutside';
import { coursesAPI, profileAPI } from '../services/api';
import { Calendar, Search, LayoutDashboard, Settings, Moon, Sun, Heart, Plus, RotateCcw, X } from 'lucide-react';
import '../App.css'; // Reuse some layout styles
import { formatCourseTime } from '../utils/courseTime';

const CLASS_REQUIRED_MESSAGE = '缺少班級資料，請先匯入學生班級再搜尋課程。';

export default function SearchPage() {
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const { schedule, watchlist, validating, addCourse, removeCourse, toggleWatchlist } = useSchedule();
  
  const [activeTab, setActiveTab] = useState('dept');
  const [searchResults, setSearchResults] = useState([]);
  const [isSearching, setIsSearching] = useState(false);
  const [detailCourse, setDetailCourse] = useState(null);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [courseSearchScope, setCourseSearchScope] = useState(null);
  const [scopeLoading, setScopeLoading] = useState(true);
  const [searchError, setSearchError] = useState('');
  const [actionNotice, setActionNotice] = useState(null);
  const [watchlistUpdatingId, setWatchlistUpdatingId] = useState('');
  const [watchlistCourses, setWatchlistCourses] = useState([]);
  const [watchlistLoading, setWatchlistLoading] = useState(false);
  const [watchlistError, setWatchlistError] = useState('');
  const userMenuRef = useRef(null);

  useClickOutside(userMenuRef, () => setShowUserMenu(false), showUserMenu);

  // Form states for Tab 1
  const [deptForm, setDeptForm] = useState({
    department: '',
    grade: '',
    className: '',
    category: '',
    keyword: ''
  });

  // Form states for Tab 2
  const [condForm, setCondForm] = useState({
    code: '',
    dayOfWeek: '',
    period: '',
    keyword: '',
    instructor: '',
    language: '',
    isGenEd: false,
    description: ''
  });

  useEffect(() => {
    let cancelled = false;

    // 未登入時不退回 `default` 使用者。
    if (!user?.studentId) {
      setSearchError('尚未登入，請重新登入後再操作。');
      setScopeLoading(false);
      return () => { cancelled = true; };
    }

    profileAPI.get()
      .then(profile => {
        if (cancelled) return;
        const scope = profile?.courseSearchScope || null;
        setCourseSearchScope(scope);
        setDeptForm(prev => ({
          ...prev,
          department: scope?.department || '',
          grade: scope?.grade ? String(scope.grade) : '',
          className: scope?.className || '',
        }));
        setSearchError(scope?.className ? '' : CLASS_REQUIRED_MESSAGE);
      })
      .catch(err => {
        if (!cancelled) setSearchError(err.message || CLASS_REQUIRED_MESSAGE);
      })
      .finally(() => {
        if (!cancelled) setScopeLoading(false);
      });

    return () => { cancelled = true; };
  }, [user?.studentId]);

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
    if (!courseSearchScope?.className) {
      setSearchError(CLASS_REQUIRED_MESSAGE);
      return;
    }
    setIsSearching(true);
    setSearchError('');
    try {
      const filters = {
        ...courseSearchScope,
        keyword: deptForm.keyword,
        category: deptForm.category
      };
      
      // Clean up empty filters
      Object.keys(filters).forEach(k => {
        if (!filters[k]) delete filters[k];
      });

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
    if (!courseSearchScope?.className) {
      setSearchError(CLASS_REQUIRED_MESSAGE);
      return;
    }
    setIsSearching(true);
    setSearchError('');
    try {
      const filters = {
        ...courseSearchScope,
        code: condForm.code,
        keyword: condForm.keyword || condForm.description,
        instructor: condForm.instructor,
        dayOfWeek: condForm.dayOfWeek ? parseInt(condForm.dayOfWeek) : null,
        period: condForm.period,
        category: condForm.isGenEd ? '通識' : null,
        language: condForm.language
      };
      // Clean up null/empty
      Object.keys(filters).forEach(k => {
        if (filters[k] === null || filters[k] === '') delete filters[k];
      });

      const data = await coursesAPI.search(filters);
      setSearchResults(data.courses || []);
    } catch (err) {
      setSearchError(err.message || '課程搜尋失敗');
    } finally {
      setIsSearching(false);
    }
  };

  const handleAddCourse = async (event, course) => {
    event.stopPropagation();
    setActionNotice(null);
    const result = await addCourse(course);
    setActionNotice({
      level: result.success ? 'success' : 'error',
      text: result.success ? `已將「${course.name}」加入課表。` : result.message,
    });
  };

  const handleToggleCourse = async (event, course) => {
    event.stopPropagation();
    const isAdded = schedule.some(item => String(item.id) === String(course.id));
    if (isAdded) {
      removeCourse(course.id);
      setActionNotice({ level: 'success', text: `已將「${course.name}」從課表移除。` });
      return;
    }
    await handleAddCourse(event, course);
  };

  const handleToggleWatchlist = async (event, course) => {
    event.stopPropagation();
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
    setDeptForm(prev => ({ ...prev, category: '', keyword: '' }));
    setSearchError(courseSearchScope?.className ? '' : CLASS_REQUIRED_MESSAGE);
    setActionNotice(null);
  };

  const handleResetCondForm = () => {
    setCondForm({
      code: '', dayOfWeek: '', period: '', keyword: '', instructor: '',
      language: '', isGenEd: false, description: '',
    });
    setSearchError(courseSearchScope?.className ? '' : CLASS_REQUIRED_MESSAGE);
    setActionNotice(null);
  };

  const displayCourses = activeTab === 'watchlist' ? watchlistCourses : searchResults;
  const resultError = activeTab === 'watchlist' ? watchlistError : searchError;

  return (
    <div className="layout-container" id="search-page">
      {/* Top Navbar */}
      <header className="top-nav">
        <div className="nav-brand">
          <Calendar size={20} className="nav-icon" />
          <span>課表規劃助手</span>
        </div>
        <div className="nav-links">
          <button className="nav-btn" onClick={() => navigate('/')}><LayoutDashboard size={16}/> 首頁</button>
          <button className="nav-btn" onClick={() => navigate('/schedule')}><Calendar size={16}/> 排課</button>
          <button className="nav-btn active"><Search size={16}/> 尋找課程</button>
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

      <div className="search-content">
        <div className="search-sidebar">
          <h2>課程查詢</h2>
          <div className="search-tabs">
            <button 
              className={`search-tab ${activeTab === 'dept' ? 'active' : ''}`}
              onClick={() => setActiveTab('dept')}
            >
              依系所查詢
            </button>
            <button 
              className={`search-tab ${activeTab === 'cond' ? 'active' : ''}`}
              onClick={() => setActiveTab('cond')}
            >
              依條件查詢
            </button>
            <button
              className={`search-tab ${activeTab === 'watchlist' ? 'active' : ''}`}
              onClick={() => setActiveTab('watchlist')}
            >
              ❤️ 我的關注
            </button>
          </div>

          {activeTab === 'dept' && (
            <form className="search-form" onSubmit={handleDeptSearch}>
              <div className="form-group">
                <label>系所 (Department)</label>
                <select value={deptForm.department} disabled>
                  <option value="">全部 (All)</option>
                  <option value="資訊工程學系">資訊工程學系</option>
                  <option value="電機工程學系">電機工程學系</option>
                  <option value="企業管理學系">企業管理學系</option>
                </select>
              </div>
              <div className="form-group">
                <label>年級 (Grade)</label>
                <select value={deptForm.grade} disabled>
                  <option value="">全部 (All)</option>
                  <option value="1">大一</option>
                  <option value="2">大二</option>
                  <option value="3">大三</option>
                  <option value="4">大四</option>
                </select>
              </div>
              <div className="form-group">
                <label>班級 (Class)</label>
                <input value={deptForm.className} readOnly disabled placeholder="尚未匯入班級" />
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
                <input 
                  type="text" 
                  placeholder="輸入課名或老師..." 
                  value={deptForm.keyword}
                  onChange={e => setDeptForm({...deptForm, keyword: e.target.value})}
                />
              </div>
              <div className="search-form-actions">
                <button type="submit" className="search-submit-btn" disabled={isSearching || scopeLoading}>
                  {scopeLoading ? '讀取班級中...' : isSearching ? '搜尋中...' : '開始搜尋'}
                </button>
                <button
                  type="button"
                  className="search-reset-btn"
                  onClick={handleResetDeptForm}
                  disabled={isSearching || scopeLoading}
                  aria-label="重設依系所查詢條件"
                  title="重設查詢條件"
                >
                  <RotateCcw size={17} />
                </button>
              </div>
            </form>
          )}

          {activeTab === 'cond' && (
            <form className="search-form" onSubmit={handleCondSearch}>
              <div className="form-group">
                <label>選課代號 (Course ID)</label>
                <input 
                  type="text" 
                  placeholder="[請輸入代號]" 
                  value={condForm.code}
                  onChange={e => { setCondForm({...condForm, code: e.target.value}); }}
                />
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
                    {[...Array(14)].map((_, i) => (
                      <option key={i+1} value={i+1}>第 {i+1} 節</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="form-group">
                <label>科目名稱 (Course Title)</label>
                <input 
                  type="text" 
                  placeholder="[請輸入關鍵字]" 
                  value={condForm.keyword}
                  onChange={e => setCondForm({...condForm, keyword: e.target.value})}
                />
              </div>
              
              <div className="form-group">
                <label>開課教師姓名 (Instructor)</label>
                <input 
                  type="text" 
                  placeholder="[請輸入姓名]" 
                  value={condForm.instructor}
                  onChange={e => setCondForm({...condForm, instructor: e.target.value})}
                />
              </div>

              <div className="form-group">
                <label>授課語言 (Language)</label>
                <select value={condForm.language} onChange={e => setCondForm({...condForm, language: e.target.value})}>
                  <option value="">全部 (All)</option>
                  <option value="中文 (Chinese)">中文 (Chinese)</option>
                  <option value="English">English</option>
                </select>
              </div>

              <div className="form-group checkbox-group">
                <label>
                  <input 
                    type="checkbox" 
                    checked={condForm.isGenEd}
                    onChange={e => setCondForm({...condForm, isGenEd: e.target.checked})}
                  />
                  特定科目類別：通識課程
                </label>
              </div>

              <div className="form-group">
                <label>課程描述 (Description)</label>
                <input 
                  type="text" 
                  placeholder="[請輸入關鍵字]" 
                  value={condForm.description}
                  onChange={e => setCondForm({...condForm, description: e.target.value})}
                />
              </div>

              <div className="search-form-actions">
                <button type="submit" className="search-submit-btn" disabled={isSearching || scopeLoading}>
                  {scopeLoading ? '讀取班級中...' : isSearching ? '搜尋中...' : '開始搜尋'}
                </button>
                <button
                  type="button"
                  className="search-reset-btn"
                  onClick={handleResetCondForm}
                  disabled={isSearching || scopeLoading}
                  aria-label="重設依條件查詢條件"
                  title="重設查詢條件"
                >
                  <RotateCcw size={17} />
                </button>
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

        <div className="search-results-area">
          <div className="results-header">
            <h3>{activeTab === 'watchlist' ? '我的關注清單' : '搜尋結果'} ({displayCourses.length} 筆)</h3>
          </div>
          {actionNotice && (
            <div className={`search-action-notice ${actionNotice.level}`} role="status">
              {actionNotice.text}
            </div>
          )}
          {resultError && (
            <div className="search-action-notice error" role="alert">{resultError}</div>
          )}
          {watchlistLoading ? (
            <div className="no-results" role="status">正在載入關注課程…</div>
          ) : displayCourses.length === 0 && !resultError ? (
            <div className="no-results">
              {activeTab === 'watchlist' ? '目前沒有關注課程。' : '請設定條件並開始搜尋'}
            </div>
          ) : displayCourses.length > 0 ? (
            <div className="results-grid">
              {displayCourses.map(course => (
                <div key={course.id} className="course-card" onClick={() => setDetailCourse(course)}>
                  <div className="course-card-header">
                    <h4>{course.name}</h4>
                    <span className="course-code">{course.code}</span>
                  </div>
                  <div className="course-card-body">
                    <p>👨‍🏫 {course.instructor} | 🏢 {course.department}</p>
                    <p>⏰ {formatCourseTime(course)}</p>
                    <p>📍 {course.location}</p>
                  </div>
                  <div className="course-card-footer">
                    <span className="tag">{course.category}</span>
                    <span className="tag">{course.credits} 學分</span>
                    {course.category === '通識' && (
                      <span className="tag">
                        {course.generalEducationDomain || '不分領域'}
                      </span>
                    )}
                    {course.eligibility === 'unknown' && (
                      <span className="tag error-text">
                        資格待確認：{course.eligibilityReason}
                      </span>
                    )}
                    {course.category === '系外選修' && course.outsideElective && (
                      <span className={`tag ${course.outsideElective.eligible ? '' : 'error-text'}`}>
                        {course.outsideElective.eligible
                          ? '須向系辦確認'
                          : `不可認列：${course.outsideElective.reasons.join('；')}`}
                      </span>
                    )}
                  </div>
                  <div className="course-card-actions">
                    <button
                      type="button"
                      className={`course-card-action ${watchlist.includes(String(course.id)) ? 'active' : ''}`}
                      onClick={event => handleToggleWatchlist(event, course)}
                      disabled={watchlistUpdatingId === String(course.id)}
                      aria-label={watchlist.includes(String(course.id)) ? `取消關注 ${course.name}` : `關注 ${course.name}`}
                    >
                      <Heart size={15} fill={watchlist.includes(String(course.id)) ? 'currentColor' : 'none'} />
                      {watchlistUpdatingId === String(course.id)
                        ? '更新中…'
                        : (watchlist.includes(String(course.id)) ? '已關注' : '關注')}
                    </button>
                    <button
                      type="button"
                      className={`course-card-action ${schedule.some(item => String(item.id) === String(course.id)) ? 'danger' : 'primary'}`}
                      onClick={event => handleToggleCourse(event, course)}
                      disabled={validating && !schedule.some(item => String(item.id) === String(course.id))}
                      aria-label={schedule.some(item => String(item.id) === String(course.id))
                        ? `取消加選 ${course.name}`
                        : `加入課表 ${course.name}`}
                    >
                      {schedule.some(item => String(item.id) === String(course.id))
                        ? <><X size={15} /> 取消加選</>
                        : <><Plus size={15} /> {validating ? '驗證中…' : '加入課表'}</>}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      </div>

      {/* Course Detail Modal */}
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
