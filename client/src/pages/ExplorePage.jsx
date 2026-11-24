// Roadmap #10 任務 4：系外與通識探索。
//
// 從一門修過、喜歡的課出發，列出課程說明最相近的系外選修與通識，每個系所／通識領域
// 只出一門（Pardos & Jiang 2020）。這份清單不影響自動排課，只是讓使用者看見平常不會
// 被排進來的課；要不要加入課表由使用者自己決定。
//
// 另有「依你的修課與興趣」模式（預設）：以標籤空間使用者向量（修過的非必修課、收藏、加選、
// 表示有興趣）排序，卡片附上共同主題與最接近的那門課當理由。需同意個人化學習。
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Calendar, Compass, LayoutDashboard, Moon, Plus, Search, Settings, Sun } from 'lucide-react';
import { useSchedule } from '../contexts/useSchedule';
import { useAuth } from '../contexts/useAuth';
import { getUserIdentity } from '../utils/userIdentity';
import { explorationAPI } from '../services/api';
import { EXPLORATION_SOURCE } from '../services/selectionSource';
import CourseDetailModal from '../components/CourseCard/CourseDetailModal';
import { formatCourseTime } from '../utils/courseTime';
import '../App.css';

import TopNav from '../components/Layout/TopNav';
// 認列狀態的文字。通過機械條件不等於已確認可抵畢業學分，所以不寫「可計入畢業學分」。
const RECOGNITION_TEXT = {
  'needs-office-confirmation': '符合系外選修條件，仍須向系辦確認是否認列',
  unchecked: '尚無法判定是否認列為系外選修，請向系辦確認',
};

const EMPTY_REASON_TEXT = {
  'no-course-history': '目前沒有你的修課紀錄，無法從已修課程出發探索。',
  'no-available-favorite': '你修過的課目前都沒有可比較的課程資料，暫時無法當作探索起點。',
  'no-personalization-consent': '你尚未同意「個人化學習」，所以無法依你的修課與興趣推薦。可以到隱私設定開啟，或改用「從一門課出發」。',
  'no-profile-signal': '目前還沒有可用的選修、通識修課紀錄或興趣紀錄（必修不列入）。可以先收藏或加選幾門課，或改用「從一門課出發」。',
  'exploration-vectors-unavailable': '課程內容的比較資料尚未準備好，暫時無法從一門課出發探索。',
  'exploration-vectors-invalid': '課程內容的比較資料需要更新，暫時無法從一門課出發探索。',
  'favorite-no-course-vector': '這門課目前沒有可比較的課程資料，請換一門課。',
};

// 起點下拉選單中，不可用的課後面加的說明。
const FAVORITE_UNAVAILABLE_TEXT = {
  'no-course-vector': '（尚未建立比較資料）',
};

// 記住這位使用者上次的探索方式與起點（只存在這台瀏覽器；讀不到時用預設值）。
const exploreStateKey = identity => `fcu:${identity}:explore`;
function readExploreState(identity) {
  if (!identity) return {};
  try {
    return JSON.parse(localStorage.getItem(exploreStateKey(identity)) || '{}') || {};
  } catch {
    return {};
  }
}
function writeExploreState(identity, state) {
  if (!identity) return;
  try {
    localStorage.setItem(exploreStateKey(identity), JSON.stringify(state));
  } catch {
    // 私密模式或停用網站資料時無法保存，下次就用預設值。
  }
}

// 0～1 的相近程度顯示成百分比，沒有可比資料時不顯示。
const percent = value => (typeof value === 'number' ? `${Math.round(value * 100)}%` : null);

// 推薦理由中「最接近的證據」的來源。
const EVIDENCE_SOURCE_TEXT = {
  history: '修過',
  course_favorited: '收藏',
  interest_exploration_feedback: '表示有興趣',
  course_selected: '加選過',
  recommendation_accepted: '加選過',
  course_viewed: '看過',
  course_rated: '給過高分',
};

const MODE = { PROFILE: 'profile', FAVORITE: 'favorite' };

function ProfileReasons({ reasons }) {
  if (!reasons) return null;
  const tags = reasons.tags.map(tag => (
    tag.viaNeighbor ? `${tag.courseTag}（近似你的「${tag.userTag}」）` : tag.courseTag
  ));
  const evidence = reasons.closestEvidence;
  return (
    <p className="explore-shared-terms">
      {tags.length > 0 && <>共同主題：{tags.join('、')}</>}
      {evidence?.name && (
        <>{tags.length > 0 ? '。' : ''}和你{EVIDENCE_SOURCE_TEXT[evidence.source] || '互動過'}的「{evidence.name}」相近</>
      )}
    </p>
  );
}

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
      {item.semanticMatch ? (
        <p className="explore-shared-terms">
          與「{favoriteName}」相近：
          {[
            ['課名', item.semanticMatch.parts?.name],
            ['課程說明', item.semanticMatch.parts?.description],
            ['主題', item.semanticMatch.parts?.topic],
          ].filter(([, value]) => percent(value)).map(([label, value]) => `${label} ${percent(value)}`).join('、')}。
          {item.semanticMatch.commonTags?.length > 0 && <>兩門課都有的主題：{item.semanticMatch.commonTags.join('、')}。</>}
        </p>
      ) : item.reasons && <ProfileReasons reasons={item.reasons} />}
      <div className="explore-sections">
        <p className="explore-sections-title">本學期可選的班次</p>
        {item.sections.map(section => (
          <div key={section.id} className="explore-section-row">
            <div className="explore-section-info">
              <span>班級：{section.department}｜老師：{section.instructor || '未定'}</span>
              <span className="explore-section-time">時間：{formatCourseTime(section)}</span>
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
  const { schedule, validating, addCourse } = useSchedule();
  const { user } = useAuth();
  const identity = getUserIdentity(user);

  const [data, setData] = useState(null);
  // 上次的探索方式與起點：換頁或重新整理後保留，不必重新選。
  const [mode, setMode] = useState(() => (readExploreState(identity).mode === MODE.FAVORITE ? MODE.FAVORITE : MODE.PROFILE));
  const [favoriteCode, setFavoriteCode] = useState(() => readExploreState(identity).favoriteCode || '');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState(null);
  const [detailCourse, setDetailCourse] = useState(null);
  useEffect(() => {
    let cancelled = false;
    explorationAPI.get(favoriteCode || undefined, mode)
      .then(result => {
        if (cancelled) return;
        setData(result);
        setLoading(false);
      })
      .catch(err => {
        if (cancelled) return;
        // 記住的起點已不在選單（例如修課紀錄更新、實習課已移除）：改用預設起點重新載入。
        if (err.code === 'FAVORITE_NOT_IN_HISTORY' && favoriteCode) {
          setFavoriteCode('');
          return;
        }
        setError(err.message || '載入探索清單失敗，請稍後再試。');
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [favoriteCode, mode]);

  useEffect(() => {
    writeExploreState(identity, { mode, favoriteCode });
  }, [identity, mode, favoriteCode]);

  // 切換探索方式：與換起點相同，載入狀態在事件處理裡設定。
  const handleModeChange = (nextMode) => {
    if (nextMode === mode) return;
    setLoading(true);
    setError('');
    setNotice(null);
    setData(null);
    setMode(nextMode);
  };

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

  const profileMode = mode === MODE.PROFILE;
  const favorite = data?.favorite ?? null;
  const hasStart = profileMode ? Boolean(data && !data.emptyReason) : Boolean(favorite);
  const startName = profileMode ? '你的修課與興趣' : '起點';
  const cardProps = {
    favoriteName: favorite?.name ?? '',
    schedule,
    validating,
    onAdd: handleAdd,
    onOpenDetail: setDetailCourse,
  };

  return (
    <div className="layout-container" id="explore-page">
      <TopNav active="explore" />

      <div className="explore-content">
        <div className="explore-intro">
          <h2>探索系外與通識</h2>
          <div className="explore-mode-switch" role="tablist" aria-label="探索方式">
            <button
              type="button"
              role="tab"
              aria-selected={profileMode}
              className={`explore-mode-btn${profileMode ? ' active' : ''}`}
              onClick={() => handleModeChange(MODE.PROFILE)}
            >
              依你的修課與興趣
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={!profileMode}
              className={`explore-mode-btn${profileMode ? '' : ' active'}`}
              onClick={() => handleModeChange(MODE.FAVORITE)}
            >
              從一門課出發
            </button>
          </div>
          <p>
            {profileMode
              ? '依你修過的選修、通識、系外課，以及收藏、加選、表示有興趣的課，比對課程的主題標籤，找出其他系所與通識裡主題相近的課（必修不列入）。'
              : '挑一門你修過、喜歡的課，系統會分別比對課名、課程說明與課程主題，找出其他系所與通識裡相近的課。不夠相近的課不會列出來，所以有時會少於 5 門，甚至沒有。體育、國防、班級活動等不計入畢業學分的課與實習課不列入。'}
            每個系所或通識領域只列一門，讓你看到平常不會注意到的選擇。這份清單不會改變自動排課的結果。
          </p>

          {!profileMode && data?.favorites?.length > 0 && (
            <label className="explore-favorite">
              <span>從這門課出發</span>
              <select
                className="input-field"
                value={favoriteCode || favorite?.courseCode || ''}
                onChange={event => handleFavoriteChange(event.target.value)}
                disabled={loading}
              >
                {data.favorites.map(item => (
                  <option key={item.courseCode} value={item.courseCode} disabled={!item.available}>
                    {item.name}{item.available ? '' : (FAVORITE_UNAVAILABLE_TEXT[item.reason] ?? '（無法當起點）')}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>

        {notice && (
          <div className={`search-action-notice ${notice.type}`}>{notice.message}</div>
        )}
        {error && <div className="search-action-notice error">{error}</div>}

        {loading ? (
          <div className="no-results">{profileMode ? '正在比對你的修課與興趣…' : '正在比對課名、課程說明與主題…'}</div>
        ) : data && !hasStart ? (
          <div className="no-results">
            {EMPTY_REASON_TEXT[data.emptyReason] || '目前沒有可用的探索起點。'}
            {profileMode && (
              <div className="explore-empty-actions">
                <button type="button" className="course-card-action" onClick={() => handleModeChange(MODE.FAVORITE)}>
                  改用「從一門課出發」
                </button>
                {data.emptyReason === 'no-personalization-consent' && (
                  <button type="button" className="course-card-action" onClick={() => navigate('/privacy')}>
                    前往隱私設定
                  </button>
                )}
              </div>
            )}
          </div>
        ) : data ? (
          <>
            <ExploreGroup
              title="跨系探索"
              hint={`每個系所只列與${startName}最相近的一門。系外選修是否認列為畢業學分，仍須向系辦確認。`}
              group={data.outside}
              emptyText={profileMode
                ? '本學期沒有與你的修課與興趣主題相同、且你可以修的系外選修。'
                : '本學期找不到和這門課夠相近的系外選修。可以換一門課試試。'}
              {...cardProps}
            />
            <ExploreGroup
              title="通識探索"
              hint={data.general.diversification === 'domain'
                ? `每個通識領域只列與${startName}最相近的一門。`
                : `依與${startName}的相近程度排列。`}
              group={data.general}
              emptyText={profileMode
                ? '本學期沒有與你的修課與興趣主題相同、且你可以修的通識課。'
                : '本學期找不到和這門課夠相近的通識課。可以換一門課試試。'}
              {...cardProps}
            />
            <p className="explore-method-note">
              {profileMode
                ? '相近程度是比對課程的主題標籤算出來的；每門課至少和你有一個完全相同的主題（上課工具、上課方式不算），不代表課程內容相同，也不代表你一定會喜歡。'
                : '相近程度是分別比對課名、課程說明、課程主題，三者平均達 55% 以上才列出；本學期沒開的已修課只比課名。相近不代表你一定會喜歡。'}
            </p>
          </>
        ) : null}
      </div>

      <CourseDetailModal course={detailCourse} onClose={() => setDetailCourse(null)} />
    </div>
  );
}
