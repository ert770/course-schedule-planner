// Roadmap #10 任務 4：系外與通識探索。
//
// 從一門修過、喜歡的課出發，列出課程說明最相近的系外選修與通識，每個系所／通識領域
// 只出一門（Pardos & Jiang 2020）。這份清單不影響自動排課，只是讓使用者看見平常不會
// 被排進來的課；要不要加入課表由使用者自己決定。
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Calendar, Compass, LayoutDashboard, Moon, Plus, Search, Settings, Sun } from 'lucide-react';
import { useAuth } from '../contexts/useAuth';
import { useTheme } from '../contexts/useTheme';
import { useSchedule } from '../contexts/useSchedule';
import { useClickOutside } from '../hooks/useClickOutside';
import { explorationAPI } from '../services/api';
import { EXPLORATION_SOURCE } from '../services/selectionSource';
import CourseDetailModal from '../components/CourseCard/CourseDetailModal';
import { formatCourseTime } from '../utils/courseTime';
import '../App.css';

// 認列狀態的文字。通過機械條件不等於已確認可抵畢業學分，所以不寫「可計入畢業學分」。
const RECOGNITION_TEXT = {
  'needs-office-confirmation': '符合系外選修條件，仍須向系辦確認是否認列',
  unchecked: '尚無法判定是否認列為系外選修，請向系辦確認',
};

const EMPTY_REASON_TEXT = {
  'no-course-history': '目前沒有你的修課紀錄，無法從已修課程出發探索。',
  'no-available-favorite': '你修過的課在課程資料中都查不到說明，暫時無法當作探索起點。',
};

function ExploreCard({ item, favoriteName, schedule, validating, onAdd, onOpenDetail }) {
  const inSchedule = section => schedule.some(course => String(course.id) === String(section.id));
  const domainLabel = item.recognition?.status === 'general-education'
    ? (item.recognition.domain || '不分領域')
    : item.unit;

  return (
    <div className="course-card explore-card">
      <div className="course-card-header">
        <h4>{item.name}</h4>
        <span className="course-code">{item.courseCode}</span>
      </div>
      <div className="course-card-footer">
        <span className="tag">{domainLabel}</span>
        <span className="tag">{item.credits} 學分</span>
        {RECOGNITION_TEXT[item.recognition?.status] && (
          <span className="tag">{RECOGNITION_TEXT[item.recognition.status]}</span>
        )}
      </div>
      {item.sharedTerms.length > 0 && (
        <p className="explore-shared-terms">
          與「{favoriteName}」的課程說明都出現：{item.sharedTerms.join('、')}
        </p>
      )}
      <div className="explore-sections">
        {item.sections.map(section => (
          <div key={section.id} className="explore-section-row">
            <div className="explore-section-info">
              <span>{section.department}・{section.instructor || '教師未定'}</span>
              <span className="explore-section-time">{formatCourseTime(section)}</span>
            </div>
            <div className="explore-section-actions">
              <button type="button" className="course-card-action" onClick={() => onOpenDetail(section)}>
                詳情
              </button>
              <button
                type="button"
                className="course-card-action primary"
                disabled={validating || inSchedule(section)}
                onClick={() => onAdd(section)}
              >
                {inSchedule(section) ? '已在課表' : <><Plus size={15} /> 加入課表</>}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ExploreGroup({ title, hint, group, emptyText, ...cardProps }) {
  return (
    <section className="explore-group">
      <h3>{title}</h3>
      <p className="explore-group-hint">{hint}</p>
      {group.items.length === 0 ? (
        <div className="no-results explore-empty">{emptyText}</div>
      ) : (
        <div className="results-grid">
          {group.items.map(item => <ExploreCard key={item.courseCode} item={item} {...cardProps} />)}
        </div>
      )}
    </section>
  );
}

export default function ExplorePage() {
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const { schedule, validating, addCourse } = useSchedule();

  const [data, setData] = useState(null);
  const [favoriteCode, setFavoriteCode] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState(null);
  const [detailCourse, setDetailCourse] = useState(null);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const userMenuRef = useRef(null);

  useClickOutside(userMenuRef, () => setShowUserMenu(false), showUserMenu);

  useEffect(() => {
    let cancelled = false;
    explorationAPI.get(favoriteCode || undefined)
      .then(result => { if (!cancelled) setData(result); })
      .catch(err => { if (!cancelled) setError(err.message || '載入探索清單失敗，請稍後再試。'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [favoriteCode]);

  // 換起點：載入狀態在這裡設定，而不是在 effect 裡同步 setState。
  const handleFavoriteChange = (courseCode) => {
    setLoading(true);
    setError('');
    setNotice(null);
    setFavoriteCode(courseCode);
  };

  const handleAdd = async (section) => {
    setNotice(null);
    // 從探索清單加入的課，事件來源記為 exploration。
    const result = await addCourse(section, { source: EXPLORATION_SOURCE });
    setNotice(result.success
      ? { type: 'success', message: `已將「${section.name}」加入課表。` }
      : { type: 'error', message: result.message || '無法加入課表。' });
  };

  const favorite = data?.favorite ?? null;
  const cardProps = {
    favoriteName: favorite?.name ?? '',
    schedule,
    validating,
    onAdd: handleAdd,
    onOpenDetail: setDetailCourse,
  };

  return (
    <div className="layout-container" id="explore-page">
      <header className="top-nav">
        <div className="nav-brand">
          <Calendar size={20} className="nav-icon" />
          <span>課表規劃助手</span>
        </div>
        <div className="nav-links">
          <button className="nav-btn" onClick={() => navigate('/')}><LayoutDashboard size={16}/> 首頁</button>
          <button className="nav-btn" onClick={() => navigate('/schedule')}><Calendar size={16}/> 排課</button>
          <button className="nav-btn" onClick={() => navigate('/search')}><Search size={16}/> 尋找課程</button>
          <button className="nav-btn active"><Compass size={16}/> 探索</button>
        </div>
        <div className="nav-actions">
          <div className="nav-user" ref={userMenuRef} onClick={() => setShowUserMenu(!showUserMenu)}>
            <div className="avatar">{(user?.name || '同')[0]}</div>
            <span>{user?.name || '同學'}</span>
            {showUserMenu && (
              <div className="user-dropdown-menu">
                <button className="user-dropdown-item" onClick={() => navigate('/setup')}>
                  <Settings size={16} style={{ marginRight: '8px' }} /> 個人資料設定
                </button>
                <button className="user-dropdown-item" onClick={() => navigate('/graduation')}>
                  <Settings size={16} style={{ marginRight: '8px' }} /> 畢業學分進度
                </button>
                <button className="user-dropdown-item" onClick={toggleTheme}>
                  {theme === 'dark'
                    ? <Sun size={16} style={{ marginRight: '8px' }} />
                    : <Moon size={16} style={{ marginRight: '8px' }} />} 切換主題
                </button>
                <div style={{ height: '1px', background: 'var(--border-color)', margin: '4px 0' }}></div>
                <button className="user-dropdown-item" onClick={logout}>登出 (Logout)</button>
              </div>
            )}
          </div>
        </div>
      </header>

      <div className="explore-content">
        <div className="explore-intro">
          <h2>探索系外與通識</h2>
          <p>
            挑一門你修過、喜歡的課，系統會比對課程說明的文字，找出其他系所與通識裡內容相近的課。
            每個系所或通識領域只列一門，讓你看到平常不會注意到的選擇。這份清單不會改變自動排課的結果。
          </p>

          {data && data.favorites.length > 0 && (
            <label className="explore-favorite">
              <span>從這門課出發</span>
              <select
                className="input-field"
                value={favorite?.courseCode ?? ''}
                onChange={event => handleFavoriteChange(event.target.value)}
                disabled={loading}
              >
                {data.favorites.map(item => (
                  <option key={item.courseCode} value={item.courseCode} disabled={!item.available}>
                    {item.name}{item.available ? '' : '（課程資料中沒有這門課的說明）'}
                  </option>
                ))}
              </select>
            </label>
          )}
          {favorite?.source === 'system-default' && (
            <p className="explore-note">系統先以你成績最高的本系課「{favorite.name}」當起點，可自行更換。</p>
          )}
        </div>

        {notice && (
          <div className={`search-action-notice ${notice.type}`}>{notice.message}</div>
        )}
        {error && <div className="search-action-notice error">{error}</div>}

        {loading ? (
          <div className="no-results">正在比對課程說明…</div>
        ) : data && !favorite ? (
          <div className="no-results">{EMPTY_REASON_TEXT[data.emptyReason] || '目前沒有可用的探索起點。'}</div>
        ) : data ? (
          <>
            <ExploreGroup
              title="跨系探索"
              hint="每個系所只列與起點最相近的一門。系外選修是否認列為畢業學分，仍須向系辦確認。"
              group={data.outside}
              emptyText="本學期沒有與這門課說明相近、且你可以修的系外選修。"
              {...cardProps}
            />
            <ExploreGroup
              title="通識探索"
              hint={data.general.diversification === 'domain'
                ? '每個通識領域只列與起點最相近的一門。'
                : '依與起點的相近程度排列。'}
              group={data.general}
              emptyText="本學期沒有與這門課說明相近、且你可以修的通識課。"
              {...cardProps}
            />
            <p className="explore-method-note">
              相近程度是比對課程說明的字面用詞算出來的，不代表課程內容相同，也不代表你一定會喜歡。
            </p>
          </>
        ) : null}
      </div>

      <CourseDetailModal course={detailCourse} onClose={() => setDetailCourse(null)} />
    </div>
  );
}
