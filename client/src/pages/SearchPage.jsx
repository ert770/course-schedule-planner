import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/useAuth';
import { useTheme } from '../contexts/useTheme';
import { coursesAPI } from '../services/api';
import { Calendar, Search, LayoutDashboard, Settings, Moon, Sun, X } from 'lucide-react';
import '../App.css'; // Reuse some layout styles

export default function SearchPage() {
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();
  
  const [activeTab, setActiveTab] = useState('dept');
  const [searchResults, setSearchResults] = useState([]);
  const [isSearching, setIsSearching] = useState(false);
  const [detailCourse, setDetailCourse] = useState(null);
  const [showUserMenu, setShowUserMenu] = useState(false);

  // Form states for Tab 1
  const [deptForm, setDeptForm] = useState({
    department: '',
    grade: '',
    classStr: '',
    category: '', // 新增：必修/選修/通識
    keyword: ''
  });

  // Form states for Tab 2
  const [condForm, setCondForm] = useState({
    code: '',
    dayOfWeek: '',
    period: '',
    keyword: '',
    instructor: '',
    language: '中文 (Chinese)',
    isGenEd: false,
    description: ''
  });

  const handleDeptSearch = async (e) => {
    e.preventDefault();
    setIsSearching(true);
    try {
      const filters = {
        department: deptForm.department,
        keyword: deptForm.keyword,
        category: deptForm.category
      };
      
      // Clean up empty filters
      Object.keys(filters).forEach(k => {
        if (!filters[k]) delete filters[k];
      });

      // Mock API call to our backend search
      const data = await coursesAPI.search(filters);
      setSearchResults(data.courses || []);
    } catch (err) {
      console.error(err);
    } finally {
      setIsSearching(false);
    }
  };

  const handleCondSearch = async (e) => {
    e.preventDefault();
    setIsSearching(true);
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
      // Clean up null/empty
      Object.keys(filters).forEach(k => {
        if (filters[k] === null || filters[k] === '') delete filters[k];
      });

      const data = await coursesAPI.search(filters);
      setSearchResults(data.courses || []);
    } catch (err) {
      console.error(err);
    } finally {
      setIsSearching(false);
    }
  };

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
          </div>

          {activeTab === 'dept' && (
            <form className="search-form" onSubmit={handleDeptSearch}>
              <div className="form-group">
                <label>系所 (Department)</label>
                <select value={deptForm.department} onChange={e => setDeptForm({...deptForm, department: e.target.value})}>
                  <option value="">全部 (All)</option>
                  <option value="資訊工程學系">資訊工程學系</option>
                  <option value="電機工程學系">電機工程學系</option>
                  <option value="企業管理學系">企業管理學系</option>
                </select>
              </div>
              <div className="form-group">
                <label>年級 (Grade)</label>
                <select value={deptForm.grade} onChange={e => setDeptForm({...deptForm, grade: e.target.value})}>
                  <option value="">全部 (All)</option>
                  <option value="1">大一</option>
                  <option value="2">大二</option>
                  <option value="3">大三</option>
                  <option value="4">大四</option>
                </select>
              </div>
              <div className="form-group">
                <label>班級 (Class)</label>
                <select value={deptForm.classStr} onChange={e => setDeptForm({...deptForm, classStr: e.target.value})}>
                  <option value="">全部 (All)</option>
                  <option value="A">甲班</option>
                  <option value="B">乙班</option>
                </select>
              </div>
              <div className="form-group">
                <label>修別 (Category)</label>
                <select value={deptForm.category} onChange={e => setDeptForm({...deptForm, category: e.target.value})}>
                  <option value="">全部 (All)</option>
                  <option value="必修">必修 (Required)</option>
                  <option value="選修">選修 (Elective)</option>
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
              <button type="submit" className="search-submit-btn" disabled={isSearching}>
                {isSearching ? '搜尋中...' : '開始搜尋'}
              </button>
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
                  特定科目類別: 通識課程 (GenEd)
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

              <button type="submit" className="search-submit-btn" disabled={isSearching}>
                {isSearching ? '搜尋中...' : '開始搜尋'}
              </button>
            </form>
          )}
        </div>

        <div className="search-results-area">
          <div className="results-header">
            <h3>搜尋結果 ({searchResults.length} 筆)</h3>
          </div>
          {searchResults.length === 0 ? (
            <div className="no-results">請設定條件並開始搜尋</div>
          ) : (
            <div className="results-grid">
              {searchResults.map(course => (
                <div key={course.id} className="course-card" onClick={() => setDetailCourse(course)}>
                  <div className="course-card-header">
                    <h4>{course.name}</h4>
                    <span className="course-code">{course.code}</span>
                  </div>
                  <div className="course-card-body">
                    <p>👨‍🏫 {course.instructor} | 🏢 {course.department}</p>
                    <p>⏰ 週{'一二三四五'[course.dayOfWeek-1]} 第{course.startPeriod}-{course.endPeriod}節</p>
                    <p>📍 {course.location}</p>
                  </div>
                  <div className="course-card-footer">
                    <span className="tag">{course.category}</span>
                    <span className="tag">{course.credits} 學分</span>
                  </div>
                </div>
              ))}
            </div>
          )}
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
