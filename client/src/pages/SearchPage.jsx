import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/useAuth';
import { useTheme } from '../contexts/useTheme';
import { useSchedule } from '../contexts/useSchedule';
import { coursesAPI, profileAPI } from '../services/api';
import { 
  Calendar, Search, LayoutDashboard, Settings, Moon, Sun, 
  Clock, MapPin, User, Building, Plus, Check, RotateCcw, AlertCircle, Heart, X
} from 'lucide-react';
import '../App.css'; 
import { formatCourseTime } from '../utils/courseTime';

const CLASS_REQUIRED_MESSAGE = '缺少班級資料，請先匯入學生班級再搜尋課程。';

export default function SearchPage() {
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();
  
  const { schedule, addCourse, removeCourse, watchlist, toggleWatchlist } = useSchedule();
  
  const [activeTab, setActiveTab] = useState('dept'); // dept, cond, watchlist
  const [searchResults, setSearchResults] = useState([]);
  const [isSearching, setIsSearching] = useState(false);
  const [detailCourse, setDetailCourse] = useState(null);
  const [showUserMenu, setShowUserMenu] = useState(false);
  
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  const [courseSearchScope, setCourseSearchScope] = useState(null);
  const [scopeLoading, setScopeLoading] = useState(true);
  const [searchError, setSearchError] = useState('');

  const initialDeptForm = { department: '', grade: '', className: '', category: '', keyword: '' };
  const initialCondForm = { code: '', dayOfWeek: '', period: '', keyword: '', instructor: '', language: '', isGenEd: false, description: '' };

  const [deptForm, setDeptForm] = useState(initialDeptForm);
  const [condForm, setCondForm] = useState(initialCondForm);

  useEffect(() => {
    let cancelled = false;

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

  const handleDeptSearch = async (e) => {
    if (e) e.preventDefault();
    setErrorMsg(''); setSuccessMsg('');
    
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
      
      // 清理空的搜尋條件
      Object.keys(filters).forEach(k => {
        if (!filters[k]) delete filters[k];
      });

      const data = await coursesAPI.search(filters);
      setSearchResults(data.courses || []);
    } catch (err) {
      setSearchError(err.message || '課程搜尋失敗，請檢查網路連線。');
    } finally {
      setIsSearching(false);
    }
  };

  const handleCondSearch = async (e) => {
    if (e) e.preventDefault();
    setErrorMsg(''); setSuccessMsg('');
    
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
      
      // 清理空的搜尋條件
      Object.keys(filters).forEach(k => {
        if (filters[k] === null || filters[k] === '') delete filters[k];
      });

      const data = await coursesAPI.search(filters);
      setSearchResults(data.courses || []);
    } catch (err) {
      setSearchError(err.message || '課程搜尋失敗，請檢查網路連線。');
    } finally {
      setIsSearching(false);
    }
  };

  // 🌟 因為 addCourse 變成 async 了，這裡加上 async/await
  const handleToggleCourse = async (course, e) => {
    if (e) e.stopPropagation(); 
    setErrorMsg(''); setSuccessMsg('');
    
    const isAdded = schedule.some(c => c.id === course.id);
    
    if (isAdded) {
      removeCourse(course.id);
      setSuccessMsg(`已將【${course.name}】從課表移除`);
      setTimeout(() => setSuccessMsg(''), 3000);
    } else {
      const result = await addCourse(course);
      if (result.success) {
        setSuccessMsg(result.message);
        setTimeout(() => setSuccessMsg(''), 3000);
      } else {
        setErrorMsg(result.message);
      }
    }
  };

  const displayCourses = activeTab === 'watchlist' ? watchlist : searchResults;

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
          <div className="nav-user" onClick={() => setShowUserMenu(!showUserMenu)}>
            <div className="avatar">{(user?.name || '同')[0]}</div>
            <span>{user?.name || '同學'}</span>
            
            {showUserMenu && (
              <div className="user-dropdown-menu">
                <button className="user-dropdown-item" onClick={() => navigate('/graduation')}><Settings size={16} style={{marginRight: '8px'}} /> 畢業學分進度</button>
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

      <div className="search-content">
        <div className="search-sidebar">
          <h2>課程查詢</h2>
          <div className="search-tabs">
            <button className={`search-tab ${activeTab === 'dept' ? 'active' : ''}`} onClick={() => { setActiveTab('dept'); setErrorMsg(''); setSuccessMsg(''); }}>
              依系所查詢
            </button>
            <button className={`search-tab ${activeTab === 'cond' ? 'active' : ''}`} onClick={() => { setActiveTab('cond'); setErrorMsg(''); setSuccessMsg(''); }}>
              依條件查詢
            </button>
            <button className={`search-tab ${activeTab === 'watchlist' ? 'active' : ''}`} onClick={() => { setActiveTab('watchlist'); setErrorMsg(''); setSuccessMsg(''); }}>
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
              <div className="form-actions" style={{ display: 'flex', gap: '8px' }}>
                <button type="submit" className="search-submit-btn" disabled={isSearching || scopeLoading} style={{ flex: 1 }}>
                  {scopeLoading ? '讀取班級中...' : isSearching ? '搜尋中...' : '開始搜尋'}
                </button>
                <button type="button" className="nav-btn" onClick={() => setDeptForm({...initialDeptForm, department: deptForm.department, grade: deptForm.grade, className: deptForm.className})} disabled={isSearching || scopeLoading} style={{ padding: '0 12px', background: 'var(--bg-secondary)' }}>
                  <RotateCcw size={18} />
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
              <div className="form-actions" style={{ display: 'flex', gap: '8px' }}>
                <button type="submit" className="search-submit-btn" disabled={isSearching || scopeLoading} style={{ flex: 1 }}>
                  {scopeLoading ? '讀取班級中...' : isSearching ? '搜尋中...' : '開始搜尋'}
                </button>
                <button type="button" className="nav-btn" onClick={() => setCondForm(initialCondForm)} disabled={isSearching || scopeLoading} style={{ padding: '0 12px', background: 'var(--bg-secondary)' }}>
                  <RotateCcw size={18} />
                </button>
              </div>
            </form>
          )}
          
          {activeTab === 'watchlist' && (
            <div style={{ padding: '24px 12px', textAlign: 'center', color: 'var(--text-secondary)' }}>
              <Heart size={48} color="#ef4444" style={{ marginBottom: '16px', opacity: 0.8 }} />
              <h3>關注清單</h3>
              <p style={{ marginTop: '8px', lineHeight: '1.6' }}>您在找課時點擊愛心收藏的課程都會顯示在這裡，方便您集中比較與加選。</p>
            </div>
          )}
        </div>

        <div className="search-results-area">
          <div className="results-header">
            <h3>{activeTab === 'watchlist' ? '我的關注清單' : '搜尋結果'} ({displayCourses.length} 筆)</h3>
          </div>
          
          {errorMsg && <div style={{ backgroundColor: '#fee2e2', color: '#b91c1c', padding: '12px', borderRadius: '8px', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}><AlertCircle size={18} /> {errorMsg}</div>}
          {successMsg && <div style={{ backgroundColor: '#dcfce3', color: '#166534', padding: '12px', borderRadius: '8px', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}><Check size={18} /> {successMsg}</div>}

          {searchError ? (
            <div className="no-results error-text" role="alert" style={{ color: '#b91c1c' }}>{searchError}</div>
          ) : displayCourses.length === 0 ? (
            <div className="no-results" style={{ color: 'var(--text-secondary)' }}>
              {activeTab === 'watchlist' ? '您目前尚未關注任何課程，趕快去搜尋並點擊愛心收藏吧！' : '請設定條件並開始搜尋'}
            </div>
          ) : (
            <div className="results-grid">
              {displayCourses.map(course => {
                const isAdded = schedule.some(c => c.id === course.id);
                const isWatched = watchlist.some(c => c.id === course.id);
                
                return (
                  <div key={course.id} className="course-card" onClick={() => setDetailCourse(course)} style={{ cursor: 'pointer', position: 'relative' }}>
                    
                    <button 
                      onClick={(e) => { e.stopPropagation(); toggleWatchlist(course); }}
                      style={{ position: 'absolute', top: '12px', right: '12px', background: 'none', border: 'none', cursor: 'pointer', color: isWatched ? '#ef4444' : '#9ca3af', padding: '4px' }}
                    >
                      <Heart fill={isWatched ? 'currentColor' : 'none'} size={20} />
                    </button>

                    <div className="course-card-header" style={{ paddingRight: '36px' }}>
                      <h4>{course.name}</h4><span className="course-code">{course.code}</span>
                    </div>
                    <div className="course-card-body" style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', lineHeight: '1.6' }}>
                      <p style={{ display: 'flex', alignItems: 'center', gap: '6px' }}><User size={14}/> {course.instructor} | <Building size={14}/> {course.department}</p>
                      <p style={{ display: 'flex', alignItems: 'center', gap: '6px' }}><Clock size={14}/> {formatCourseTime(course)}</p>
                      <p style={{ display: 'flex', alignItems: 'center', gap: '6px' }}><MapPin size={14}/> {course.location}</p>
                    </div>
                    <div className="course-card-footer" style={{ marginTop: '12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        <div>
                          <span className="tag">{course.category}</span>
                          <span className="tag" style={{ marginLeft: '4px' }}>{course.credits} 學分</span>
                        </div>
                        {course.category === '系外選修' && course.outsideElective && (
                          <span className={`tag ${course.outsideElective.eligible ? '' : 'error-text'}`} style={{ color: course.outsideElective.eligible ? 'inherit' : '#b91c1c' }}>
                            {course.outsideElective.eligible
                              ? '須向系辦確認'
                              : `不可認列：${course.outsideElective.reasons.join('；')}`}
                          </span>
                        )}
                      </div>
                      
                      <button 
                        onClick={(e) => handleToggleCourse(course, e)}
                        style={{
                          display: 'flex', alignItems: 'center', gap: '4px', padding: '6px 10px',
                          borderRadius: '6px', cursor: 'pointer', fontWeight: '500', transition: 'all 0.2s',
                          backgroundColor: isAdded ? '#fee2e2' : '#3b82f6', 
                          color: isAdded ? '#ef4444' : '#fff',
                          border: isAdded ? '1px solid #fca5a5' : '1px solid #3b82f6',
                          whiteSpace: 'nowrap'
                        }}
                      >
                        {isAdded ? <X size={14} /> : <Plus size={14} />}
                        {isAdded ? '取消加選' : '加選'}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Course Detail Modal */}
      {detailCourse && (
        <div className="modal-overlay" onClick={() => setDetailCourse(null)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <button className="modal-close" onClick={() => setDetailCourse(null)}>✕</button>
            <h2 style={{ fontSize: '1.3rem', marginBottom: '8px', paddingRight: '20px' }}>{detailCourse.name}</h2>
            <span className="detail-code" style={{ color: '#6b7280', fontSize: '0.9rem' }}>{detailCourse.code}</span>
            <div className="detail-meta" style={{ margin: '16px 0', padding: '12px', backgroundColor: 'var(--bg-secondary)', borderRadius: '8px' }}>
              <p style={{ margin: '4px 0' }}>👤 授課教師：{detailCourse.instructor}</p>
              <p style={{ margin: '4px 0' }}>📚 學分數：{detailCourse.credits} 學分</p>
            </div>
            {detailCourse.description && (
              <div className="detail-desc">
                <div className="detail-desc-label" style={{ fontWeight: 'bold', marginBottom: '8px' }}>課程說明</div>
                <p style={{ lineHeight: '1.6' }}>{detailCourse.description}</p>
              </div>
            )}
            <div style={{ marginTop: '24px', display: 'flex', justifyContent: 'flex-end' }}>
              <button 
                onClick={() => handleToggleCourse(detailCourse)}
                style={{
                  display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 16px', borderRadius: '6px',
                  cursor: 'pointer', fontWeight: 'bold', transition: 'all 0.2s',
                  backgroundColor: schedule.some(c => c.id === detailCourse.id) ? '#fee2e2' : '#3b82f6', 
                  color: schedule.some(c => c.id === detailCourse.id) ? '#ef4444' : '#fff',
                  border: schedule.some(c => c.id === detailCourse.id) ? '1px solid #fca5a5' : '1px solid #3b82f6'
                }}
              >
                {schedule.some(c => c.id === detailCourse.id) ? <X size={16} /> : <Plus size={16} />}
                {schedule.some(c => c.id === detailCourse.id) ? '從課表取消' : '加入課表'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}