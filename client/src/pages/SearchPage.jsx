import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/useAuth';
import { useTheme } from '../contexts/useTheme';
import { useSchedule } from '../contexts/useSchedule';
import { coursesAPI } from '../services/api';
import { 
  Calendar, Search, LayoutDashboard, Settings, Moon, Sun, 
  Clock, MapPin, User, Building, Plus, Check, RotateCcw, AlertCircle, Heart, X
} from 'lucide-react';
import '../App.css';

// ----------------------------------------------------------------------
// 子元件：依系所查詢表單 (DepartmentSearchForm)
// ----------------------------------------------------------------------
const DepartmentSearchForm = ({ form, setForm, onSubmit, onReset, isLoading }) => (
  <form className="search-form" onSubmit={onSubmit}>
    <div className="form-group">
      <label htmlFor="dept-department">系所 (Department)</label>
      <select id="dept-department" value={form.department} onChange={e => setForm({...form, department: e.target.value})}>
        <option value="">全部 (All)</option>
        <option value="資訊工程學系">資訊工程學系</option>
        <option value="電機工程學系">電機工程學系</option>
        <option value="企業管理學系">企業管理學系</option>
      </select>
    </div>
    <div className="form-group">
      <label htmlFor="dept-grade">年級 (Grade)</label>
      <select id="dept-grade" value={form.grade} onChange={e => setForm({...form, grade: e.target.value})}>
        <option value="">全部 (All)</option>
        <option value="1">大一</option>
        <option value="2">大二</option>
        <option value="3">大三</option>
        <option value="4">大四</option>
      </select>
    </div>
    <div className="form-group">
      <label htmlFor="dept-class">班級 (Class)</label>
      <select id="dept-class" value={form.classStr} onChange={e => setForm({...form, classStr: e.target.value})}>
        <option value="">全部 (All)</option>
        <option value="A">甲班</option>
        <option value="B">乙班</option>
      </select>
    </div>
    <div className="form-group">
      <label htmlFor="dept-category">修別 (Category)</label>
      <select id="dept-category" value={form.category} onChange={e => setForm({...form, category: e.target.value})}>
        <option value="">全部 (All)</option>
        <option value="必修">必修 (Required)</option>
        <option value="選修">選修 (Elective)</option>
      </select>
    </div>
    <div className="form-group">
      <label htmlFor="dept-keyword">課程關鍵字</label>
      <input 
        id="dept-keyword"
        type="text" 
        placeholder="輸入課名或老師..." 
        value={form.keyword}
        onChange={e => setForm({...form, keyword: e.target.value})}
      />
    </div>
    <div className="form-actions" style={{ display: 'flex', gap: '8px' }}>
      <button type="submit" className="search-submit-btn" disabled={isLoading} style={{ flex: 1 }}>
        {isLoading ? '搜尋中...' : '開始搜尋'}
      </button>
      <button type="button" className="nav-btn" onClick={onReset} disabled={isLoading} style={{ padding: '0 12px', background: 'var(--bg-secondary)' }}>
        <RotateCcw size={18} />
      </button>
    </div>
  </form>
);

// ----------------------------------------------------------------------
// 子元件：依條件查詢表單 (ConditionSearchForm)
// ----------------------------------------------------------------------
const ConditionSearchForm = ({ form, setForm, onSubmit, onReset, isLoading }) => (
  <form className="search-form" onSubmit={onSubmit}>
    <div className="form-group">
      <label htmlFor="cond-code">選課代號 (Course ID)</label>
      <input 
        id="cond-code"
        type="text" 
        placeholder="[請輸入代號]" 
        value={form.code}
        onChange={e => setForm({...form, code: e.target.value})}
      />
    </div>
    <div className="form-row">
      <div className="form-group">
        <label htmlFor="cond-day">星期 (Day)</label>
        <select id="cond-day" value={form.dayOfWeek} onChange={e => setForm({...form, dayOfWeek: e.target.value})}>
          <option value="">全部 (All)</option>
          <option value="1">星期一</option>
          <option value="2">星期二</option>
          <option value="3">星期三</option>
          <option value="4">星期四</option>
          <option value="5">星期五</option>
        </select>
      </div>
      <div className="form-group">
        <label htmlFor="cond-period">節次 (Period)</label>
        <select id="cond-period" value={form.period} onChange={e => setForm({...form, period: e.target.value})}>
          <option value="">全部 (All)</option>
          {[...Array(14)].map((_, i) => (
            <option key={i+1} value={i+1}>第 {i+1} 節</option>
          ))}
        </select>
      </div>
    </div>
    <div className="form-group">
      <label htmlFor="cond-keyword">科目名稱 (Course Title)</label>
      <input 
        id="cond-keyword"
        type="text" 
        placeholder="[請輸入關鍵字]" 
        value={form.keyword}
        onChange={e => setForm({...form, keyword: e.target.value})}
      />
    </div>
    <div className="form-group">
      <label htmlFor="cond-instructor">開課教師姓名 (Instructor)</label>
      <input 
        id="cond-instructor"
        type="text" 
        placeholder="[請輸入姓名]" 
        value={form.instructor}
        onChange={e => setForm({...form, instructor: e.target.value})}
      />
    </div>
    <div className="form-group">
      <label htmlFor="cond-language">授課語言 (Language)</label>
      {/* 🌟 修復處：加入「全部」選項，避免預設送出中文條件過濾掉沒有語言標籤的課 */}
      <select id="cond-language" value={form.language} onChange={e => setForm({...form, language: e.target.value})}>
        <option value="">全部 (All)</option>
        <option value="中文 (Chinese)">中文 (Chinese)</option>
        <option value="English">English</option>
      </select>
    </div>
    <div className="form-group checkbox-group">
      <label htmlFor="cond-gened">
        <input 
          id="cond-gened"
          type="checkbox" 
          checked={form.isGenEd}
          onChange={e => setForm({...form, isGenEd: e.target.checked})}
        />
        特定科目類別: 通識課程 (GenEd)
      </label>
    </div>
    <div className="form-group">
      <label htmlFor="cond-desc">課程描述 (Description)</label>
      <input 
        id="cond-desc"
        type="text" 
        placeholder="[請輸入關鍵字]" 
        value={form.description}
        onChange={e => setForm({...form, description: e.target.value})}
      />
    </div>
    <div className="form-actions" style={{ display: 'flex', gap: '8px' }}>
      <button type="submit" className="search-submit-btn" disabled={isLoading} style={{ flex: 1 }}>
        {isLoading ? '搜尋中...' : '開始搜尋'}
      </button>
      <button type="button" className="nav-btn" onClick={onReset} disabled={isLoading} style={{ padding: '0 12px', background: 'var(--bg-secondary)' }}>
        <RotateCcw size={18} />
      </button>
    </div>
  </form>
);

// ----------------------------------------------------------------------
// 主元件：SearchPage
// ----------------------------------------------------------------------
export default function SearchPage() {
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();
  
  // 🌟 引入 removeCourse
  const { schedule, addCourse, removeCourse, watchlist, toggleWatchlist } = useSchedule();
  
  const [activeTab, setActiveTab] = useState('dept'); // dept, cond, watchlist
  const [searchResults, setSearchResults] = useState([]);
  const [isSearching, setIsSearching] = useState(false);
  const [detailCourse, setDetailCourse] = useState(null);
  const [showUserMenu, setShowUserMenu] = useState(false);
  
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  // 🌟 修復處：language 預設改為空字串
  const initialDeptForm = { department: '', grade: '', classStr: '', category: '', keyword: '' };
  const initialCondForm = { code: '', dayOfWeek: '', period: '', keyword: '', instructor: '', language: '', isGenEd: false, description: '' };

  const [deptForm, setDeptForm] = useState(initialDeptForm);
  const [condForm, setCondForm] = useState(initialCondForm);

  const hasValidSearchCriteria = (formObj) => {
    return Object.entries(formObj).some(([key, value]) => {
      if (key === 'language' || key === 'isGenEd') return false; 
      return value !== null && value !== '';
    });
  };

  const handleDeptSearch = async (e) => {
    e.preventDefault();
    setErrorMsg(''); setSuccessMsg('');
    if (!hasValidSearchCriteria(deptForm)) {
      setErrorMsg('請至少設定一項搜尋條件');
      return;
    }
    setIsSearching(true);
    try {
      const filters = Object.fromEntries(
        Object.entries({
          department: deptForm.department,
          keyword: deptForm.keyword,
          category: deptForm.category
        }).filter(([_, v]) => v !== null && v !== '')
      );
      const data = await coursesAPI.search(filters);
      setSearchResults(data.courses || []);
    } catch (err) {
      setErrorMsg('搜尋失敗，請檢查網路連線。');
    } finally {
      setIsSearching(false);
    }
  };

  const handleCondSearch = async (e) => {
    e.preventDefault();
    setErrorMsg(''); setSuccessMsg('');
    if (!hasValidSearchCriteria(condForm)) {
      setErrorMsg('請至少設定一項搜尋條件');
      return;
    }
    setIsSearching(true);
    try {
      const filters = Object.fromEntries(
        Object.entries({
          code: condForm.code,
          keyword: condForm.keyword || condForm.description,
          instructor: condForm.instructor,
          dayOfWeek: condForm.dayOfWeek ? parseInt(condForm.dayOfWeek) : null,
          period: condForm.period,
          category: condForm.isGenEd ? '通識' : null,
          language: condForm.language
        }).filter(([_, v]) => v !== null && v !== '')
      );
      const data = await coursesAPI.search(filters);
      setSearchResults(data.courses || []);
    } catch (err) {
      setErrorMsg('搜尋失敗，請檢查網路連線。');
    } finally {
      setIsSearching(false);
    }
  };

  const handleToggleCourse = (course, e) => {
    if (e) e.stopPropagation(); 
    setErrorMsg(''); setSuccessMsg('');
    
    // 🌟 動態判斷：如果在課表中，就移除；不在課表中，就加入
    const isAdded = schedule.some(c => c.id === course.id);
    
    if (isAdded) {
      removeCourse(course.id);
      setSuccessMsg(`已將【${course.name}】從課表移除`);
      setTimeout(() => setSuccessMsg(''), 3000);
    } else {
      const result = addCourse(course);
      if (result.success) {
        setSuccessMsg(result.message);
        setTimeout(() => setSuccessMsg(''), 3000);
      } else {
        setErrorMsg(result.message);
      }
    }
  };

  // 🌟 動態決定右側要顯示搜尋結果，還是關注清單
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
            {/* 🌟 新增：我的關注清單 Tab */}
            <button className={`search-tab ${activeTab === 'watchlist' ? 'active' : ''}`} onClick={() => { setActiveTab('watchlist'); setErrorMsg(''); setSuccessMsg(''); }}>
              ❤️ 我的關注
            </button>
          </div>

          {activeTab === 'dept' && (
            <DepartmentSearchForm form={deptForm} setForm={setDeptForm} onSubmit={handleDeptSearch} onReset={() => setDeptForm(initialDeptForm)} isLoading={isSearching} />
          )}
          {activeTab === 'cond' && (
            <ConditionSearchForm form={condForm} setForm={setCondForm} onSubmit={handleCondSearch} onReset={() => setCondForm(initialCondForm)} isLoading={isSearching} />
          )}
          
          {/* 關注清單專屬的左側說明 */}
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

          {displayCourses.length === 0 ? (
            <div className="no-results" style={{ color: 'var(--text-secondary)' }}>
              {activeTab === 'watchlist' ? '您目前尚未關注任何課程，趕快去搜尋並點擊愛心收藏吧！' : '請設定條件並開始搜尋'}
            </div>
          ) : (
            <div className="results-grid">
              {displayCourses.map(course => {
                const isAdded = schedule.some(c => c.id === course.id);
                const isWatched = watchlist.some(c => c.id === course.id);
                const dayString = ['一','二','三','四','五','六','日'][course.dayOfWeek - 1] || '未定';

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
                      <p style={{ display: 'flex', alignItems: 'center', gap: '6px' }}><Clock size={14}/> 週{dayString} 第{course.startPeriod}-{course.endPeriod}節</p>
                      <p style={{ display: 'flex', alignItems: 'center', gap: '6px' }}><MapPin size={14}/> {course.location}</p>
                    </div>
                    <div className="course-card-footer" style={{ marginTop: '12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div>
                        <span className="tag">{course.category}</span>
                        <span className="tag" style={{ marginLeft: '4px' }}>{course.credits} 學分</span>
                      </div>
                      
                      {/* 🌟 變成動態：加選 / 取消加選 */}
                      <button 
                        onClick={(e) => handleToggleCourse(course, e)}
                        style={{
                          display: 'flex', alignItems: 'center', gap: '4px', padding: '6px 10px',
                          borderRadius: '6px', cursor: 'pointer', fontWeight: '500', transition: 'all 0.2s',
                          backgroundColor: isAdded ? '#fee2e2' : '#3b82f6', 
                          color: isAdded ? '#ef4444' : '#fff',
                          border: isAdded ? '1px solid #fca5a5' : '1px solid #3b82f6'
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
