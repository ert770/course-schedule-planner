import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '../contexts/useAuth';
import { useSchedule } from '../contexts/useSchedule';
import { coursesAPI, profileAPI } from '../services/api';
import CourseActions, { CourseActionsProvider } from '../components/CourseCard/CourseActions';
import CourseDetailModal from '../components/CourseCard/CourseDetailModal';
import { Heart, RotateCcw, GripVertical, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import '../App.css'; 
import { formatCourseTime } from '../utils/courseTime';
import { getUserIdentity } from '../utils/userIdentity';
import { formatCourseGradeLevel } from '../utils/courseGradeLevel';

import TopNav from '../components/Layout/TopNav';
const GRADE_CLASS_MAP = {
  '1': ['資訊一甲', '資訊一乙', '資訊一丙', '合'],
  '2': ['資訊二甲', '資訊二乙', '資訊二丙', '資訊二丁', '合'],
  '3': ['資訊三甲', '資訊三乙', '資訊三丙', '資訊三丁', '合'],
  '4': ['資訊四甲', '資訊四乙', '資訊四丙', '資訊四丁', '合'],
  '5': ['合'],
};
const DEFAULT_DEPT_FORM = {
  department: '資訊工程學系', gradeLevel: '4', className: '合', category: '', keyword: '',
};
const DEFAULT_COND_FORM = {
  code: '', dayOfWeek: '', period: '', keyword: '', instructor: '', language: '', isGenEd: false, description: '',
};
const QUERY_TABS = ['dept', 'cond'];
const SEARCH_TABS = [...QUERY_TABS, 'watchlist'];
const searchStateKey = identity => `fcu:${identity}:courseSearch`;
const searchResultsKey = (identity, tab) => `${searchStateKey(identity)}:${tab}`;

function readSearchItem(key) {
  try {
    return JSON.parse(sessionStorage.getItem(key));
  } catch {
    return null;
  }
}

function readSearchState(identity) {
  if (identity === null) return null;
  return {
    ...readSearchItem(searchStateKey(identity)),
    results: Object.fromEntries(QUERY_TABS.map(tab => [tab, readSearchItem(searchResultsKey(identity, tab))])),
  };
}

function savedResults(courses) {
  return Array.isArray(courses) ? courses.filter(course => course?.id != null) : null;
}

function storeSearchResults(identity, tab, filters, courses) {
  if (identity === null) return;
  const key = searchResultsKey(identity, tab);
  try {
    sessionStorage.setItem(key, JSON.stringify({ filters, courses }));
  } catch {
    try {
      // 全校結果太大時用上次成功送出的條件重查，保留完整的結果筆數。
      sessionStorage.setItem(key, JSON.stringify({ filters }));
    } catch {
      // 瀏覽器禁止儲存時，這次查詢仍可在畫面上使用。
    }
  }
}

export default function SearchPage() {
  const { user } = useAuth();
  const userIdentity = getUserIdentity(user);
  const { watchlist, logCourseViewed } = useSchedule();
  
  const [initialSearch] = useState(() => readSearchState(userIdentity));
  const [activeTab, setActiveTab] = useState(() => (
    SEARCH_TABS.includes(initialSearch?.activeTab) ? initialSearch.activeTab : 'dept'
  ));
  const [searchResults, setSearchResults] = useState(() => ({
    dept: savedResults(initialSearch?.results.dept?.courses),
    cond: savedResults(initialSearch?.results.cond?.courses),
  }));
  const [requests, setRequests] = useState({});
  const [detailCourse, setDetailCourse] = useState(null);
  const [actionReset, setActionReset] = useState(0);
  const [watchlistCourses, setWatchlistCourses] = useState([]);
  const [watchlistLoading, setWatchlistLoading] = useState(false);
  const [watchlistError, setWatchlistError] = useState('');
  
  const [sidebarWidth, setSidebarWidth] = useState(340);
  const [isResizing, setIsResizing] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const searchRequestRef = useRef({ dept: 0, cond: 0 });
  const [deptForm, setDeptForm] = useState(() => initialSearch?.deptForm
    ? { ...DEFAULT_DEPT_FORM, ...initialSearch.deptForm } : DEFAULT_DEPT_FORM);
  const [condForm, setCondForm] = useState(() => ({ ...DEFAULT_COND_FORM, ...initialSearch?.condForm }));

  useEffect(() => {
    if (userIdentity === null) return;
    try {
      sessionStorage.setItem(searchStateKey(userIdentity), JSON.stringify({
        activeTab,
        deptForm: deptForm === DEFAULT_DEPT_FORM ? undefined : deptForm,
        condForm,
      }));
    } catch {
      // 關閉瀏覽器儲存或超出容量時，仍可在這個頁面切換查詢。
    }
  }, [activeTab, condForm, deptForm, userIdentity]);

  useEffect(() => {
    const requestIds = searchRequestRef.current;
    return () => {
      requestIds.dept += 1;
      requestIds.cond += 1;
    };
  }, []);

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
    if (userIdentity === null || initialSearch?.deptForm) return undefined;
    let cancelled = false;

    profileAPI.get()
      .then(profile => {
        if (cancelled) return;
        const scope = profile?.courseSearchScope || null;
        if (scope) {
          setDeptForm(prev => prev === DEFAULT_DEPT_FORM ? {
            ...prev,
            gradeLevel: scope.gradeLevel ? String(scope.gradeLevel) : '4',
            className: scope.className || '合',
          } : prev);
        }
      })
      .catch(() => {});

    return () => { cancelled = true; };
  }, [initialSearch, userIdentity]);

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

  const runSearch = useCallback(async (tab, filters) => {
    const requestId = ++searchRequestRef.current[tab];
    const isCurrent = () => requestId === searchRequestRef.current[tab];
    setRequests(prev => ({ ...prev, [tab]: { loading: true } }));
    try {
      const data = await (tab === 'dept' ? coursesAPI.search(filters) : coursesAPI.searchCatalog(filters));
      if (!isCurrent()) return;
      const courses = Array.isArray(data.courses) ? data.courses : [];
      storeSearchResults(userIdentity, tab, filters, courses);
      setSearchResults(prev => ({ ...prev, [tab]: courses }));
      setRequests(prev => ({ ...prev, [tab]: null }));
    } catch (err) {
      if (isCurrent()) {
        setRequests(prev => ({ ...prev, [tab]: { error: err.message || '課程搜尋失敗' } }));
      }
    }
  }, [userIdentity]);

  useEffect(() => {
    const saved = initialSearch?.results[activeTab];
    // 只有過大而未保存結果的查詢才需要重新向 API 取得結果。
    if (searchResults[activeTab] !== null || requests[activeTab] || !saved?.filters) return;
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) void runSearch(activeTab, saved.filters);
    });
    return () => { cancelled = true; };
  }, [activeTab, initialSearch, requests, runSearch, searchResults]);

  const handleDeptSearch = (e) => {
    e.preventDefault();
    if (!deptForm.category) return;
    const filters = {
      department: deptForm.department,
      gradeLevel: deptForm.gradeLevel ? Number(deptForm.gradeLevel) : undefined,
      className: deptForm.className,
      keyword: deptForm.keyword,
      category: deptForm.category,
    };
    void runSearch('dept', filters);
  };

  const handleCondSearch = (e) => {
    e.preventDefault();
    const filters = {
      code: condForm.code,
      // 「科目名稱」只比對課名與課號，「課程描述」才用關鍵字比對。
      name: condForm.keyword,
      keyword: condForm.description,
      instructor: condForm.instructor,
      dayOfWeek: condForm.dayOfWeek ? Number(condForm.dayOfWeek) : undefined,
      period: condForm.period,
      category: condForm.isGenEd ? '通識' : undefined,
      language: condForm.language,
    };
    void runSearch('cond', filters);
  };

  const handleOpenDetail = (course) => {
    setDetailCourse(course);
    logCourseViewed(course);
  };

  const handleResetDeptForm = () => {
    setDeptForm({ ...DEFAULT_DEPT_FORM, gradeLevel: '' });
    setRequests(prev => ({ ...prev, dept: null }));
    setActionReset(value => value + 1);
  };

  const handleResetCondForm = () => {
    setCondForm(DEFAULT_COND_FORM);
    setRequests(prev => ({ ...prev, cond: null }));
    setActionReset(value => value + 1);
  };

  const showingWatchlist = activeTab === 'watchlist';
  const courses = searchResults[activeTab];
  const isSearching = Boolean(requests[activeTab]?.loading);
  const displayCourses = showingWatchlist ? watchlistCourses : courses ?? [];
  const resultError = showingWatchlist ? watchlistError : requests[activeTab]?.error;
  const emptyMessage = showingWatchlist ? '目前沒有關注課程。'
    : courses ? '找不到符合查詢條件的課程。' : '請設定條件並開始搜尋';

  return (
    <div className="layout-container" id="search-page">
      <TopNav active="search" />

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
                  style={{ backgroundColor: 'var(--bg-card-hover)', color: 'var(--text-muted)', cursor: 'not-allowed' }}
                >
                  <option value="資訊工程學系">資訊工程學系</option>
                </select>
              </div>
              <div className="form-group">
                <label>年級 (Grade)</label>
                <select value={deptForm.gradeLevel} onChange={handleGradeChange}>
                  <option value="">全部</option>
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
                <label htmlFor="dept-search-category">修別 (Category)</label>
                <select id="dept-search-category" required value={deptForm.category}
                  onChange={e => setDeptForm({...deptForm, category: e.target.value})}>
                  <option value="" disabled>請選擇修別</option>
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
                <input type="text" placeholder="請輸入代號..." value={condForm.code} onChange={e => setCondForm({...condForm, code: e.target.value})} />
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>星期 (Day)</label>
                  <select value={condForm.dayOfWeek} onChange={e => setCondForm({...condForm, dayOfWeek: e.target.value})}>
                    <option value="">全部</option>
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
                    <option value="">全部</option>
                    {[...Array(14)].map((_, i) => (<option key={i+1} value={i+1}>第 {i+1} 節</option>))}
                  </select>
                </div>
              </div>
              <div className="form-group">
                <label>科目名稱 (Course Title)</label>
                <input type="text" placeholder="請輸入關鍵字..." value={condForm.keyword} onChange={e => setCondForm({...condForm, keyword: e.target.value})} />
              </div>
              <div className="form-group">
                <label>開課教師姓名 (Instructor)</label>
                <input type="text" placeholder="請輸入姓名..." value={condForm.instructor} onChange={e => setCondForm({...condForm, instructor: e.target.value})} />
              </div>
              <div className="form-group">
                <label>授課語言 (Language)</label>
                <select value={condForm.language} onChange={e => setCondForm({...condForm, language: e.target.value})}>
                  <option value="">全部</option>
                  <option value="中文 (Chinese)">中文 (Chinese)</option>
                  <option value="English">English</option>
                </select>
              </div>
              <div className="form-group search-gened-row">
                <label className="search-gened-label">
                  <input type="checkbox" checked={condForm.isGenEd} onChange={e => setCondForm({...condForm, isGenEd: e.target.checked})} />
                  只看通識課程
                </label>
              </div>
              <div className="form-group">
                <label>課程描述 (Description)</label>
                <input type="text" placeholder="請輸入關鍵字..." value={condForm.description} onChange={e => setCondForm({...condForm, description: e.target.value})} />
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
                background: 'var(--bg-card-hover)', border: '1px solid var(--border-color)', cursor: 'pointer', 
                color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', justifyContent: 'center',
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

          {resultError && <div className="search-action-notice error" role="alert">{resultError}</div>}
          
          {showingWatchlist && watchlistLoading ? (
            <div className="no-results" role="status">正在載入關注課程…</div>
          ) : isSearching && displayCourses.length === 0 ? (
            <div className="no-results" role="status">正在搜尋課程…</div>
          ) : displayCourses.length === 0 && !resultError ? (
            <div className="no-results" style={{ color: 'var(--text-secondary)' }}>
              {emptyMessage}
            </div>
          ) : displayCourses.length > 0 ? (
            <CourseActionsProvider>
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
                  <CourseActions key={actionReset} course={course} />
                </div>
                ))}
              </div>
            </CourseActionsProvider>
          ) : null}
        </div>
      </div>

      <CourseDetailModal
        course={detailCourse}
        onClose={() => setDetailCourse(null)}
      />
    </div>
  );
}
