import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../contexts/useAuth';
import { graduationAPI, scheduleAPI } from '../services/api';
import { getUserIdentity } from '../utils/userIdentity';
import { X, Plus, Trash2, Search, AlertTriangle, Lightbulb, Calendar, LayoutDashboard, Settings, Moon, Sun, Compass, ChevronDown, ChevronUp } from 'lucide-react';

import TopNav from '../components/Layout/TopNav';
import CourseDetailModal from '../components/CourseCard/CourseDetailModal';

// `GET /api/graduation/:studentId` 的學分類別 key 對應中文標題。
const CREDIT_CATEGORY_LABELS = {
  required: '本系必修',
  elective: '本系選修',
  general: '通識',
  external: '外系選修',
  unspecified: '自由選修',
};

// 預設的高品質口袋名單實體課程（確保代碼、時間與 schedule 座標完全對齊首頁與 Modal）
const DEFAULT_WATCHLIST_COURSES = [
  {
    id: 'CE07139-17113',
    code: 'CE07139-17113',
    name: '安全程式設計',
    category: '本系選修',
    credits: 3,
    instructor: '蔡國裕',
    location: '電腦教室',
    gradeLevel: 3,
    time: '週二 第 6、7 節 (14:10~16:00)',
    schedule: [{ day: 2, periods: [6, 7] }],
    prerequisites: '計算機概論與實習(I)、計算機概論與實習(II)、網路程式設計',
    description: '安全程式設計。安全程式設計課程專門教授學生撰寫安全軟體的核心技能，涵蓋安全策略、漏洞分析及緩解策略，並使用 Dev C++ 進行實作練習。',
  },
  {
    id: 'CE07139-14682',
    code: 'CE07139-14682',
    name: '行動應用程式開發',
    category: '本系選修',
    credits: 3,
    instructor: '陳銀民',
    location: '資電118(電腦實習室)',
    gradeLevel: 3,
    time: '週三 第 3、4、5 節 (10:10~13:00)',
    schedule: [{ day: 3, periods: [3, 4, 5] }],
    prerequisites: '物件導向設計',
    description: '行動應用程式開發。本課程專注於行動應用程式開發，涵蓋進階物件導向式設計、移動式應用程式開發環境及動態網頁架構設計。',
  },
  {
    id: 'CE07141-15234',
    code: 'CE07141-15234',
    name: '人工智慧入門與實思',
    category: '通識選修',
    credits: 2,
    instructor: '與省思',
    location: '人408',
    gradeLevel: 2,
    time: '週四 第 7、8 節 (15:10~17:00)',
    schedule: [{ day: 4, periods: [7, 8] }],
    prerequisites: '無',
    description: '人工智慧入門與實思。介紹人工智慧的基本原理、機器學習概念及其對社會與倫理的影響。',
  }
];

export default function GraduationPage() {
  const { user } = useAuth();
  const userIdentity = getUserIdentity(user);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  
  // 記錄每個學分卡片的展開狀態（控制向下展開）
  const [expandedCategories, setExpandedCategories] = useState({});

  // 追蹤哪些真實課程 ID 已經加入課表
  const [addedCourseIds, setAddedCourseIds] = useState(() => {
    const storageKey = `user_schedule_courses_${userIdentity || 'default'}`;
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) || '[]');
      return new Set(saved.map(c => c.id || c.code));
    } catch {
      return new Set();
    }
  });

  // 控制課程詳細資訊 Modal 的狀態
  const [selectedCourse, setSelectedCourse] = useState(null);

  const loadGraduationData = useCallback(async () => {
    if (userIdentity === null) {
      setData(null);
      setLoading(false);
      return;
    }
    try {
      setLoadError('');
      const result = await graduationAPI.get();
      setData(result);
    } catch (err) {
      setData(null);
      setLoadError(err.message || '畢業進度暫時無法載入，請稍後再試。');
    } finally {
      setLoading(false);
    }
  }, [userIdentity]);

  useEffect(() => {
    loadGraduationData();
  }, [loadGraduationData]);

  // 切換學分卡片展開/收合
  const toggleCategoryExpand = (category) => {
    setExpandedCategories(prev => ({
      ...prev,
      [category]: !prev[category]
    }));
  };

  // 取得對應的標準實體課程（確保時間與 schedule 座標絕對正確）
  const getMatchedCourse = (itemObj) => {
    const courseObj = itemObj.course || itemObj;
    const cName = courseObj.name || courseObj.courseName || itemObj.gapLabel || '';
    if (cName.includes('安全程式設計')) {
      return DEFAULT_WATCHLIST_COURSES.find(c => c.name === '安全程式設計') || courseObj;
    }
    if (cName.includes('行動應用程式開發')) {
      return DEFAULT_WATCHLIST_COURSES.find(c => c.name === '行動應用程式開發') || courseObj;
    }
    if (cName.includes('人工智慧入門')) {
      return DEFAULT_WATCHLIST_COURSES.find(c => c.name === '人工智慧入門與實思') || courseObj;
    }
    return courseObj;
  };

  // 處理點擊「加入課表」與「取消」的切換邏輯
  const handleToggleSchedule = async (itemObj) => {
    const matched = getMatchedCourse(itemObj);
    const courseId = matched.id || matched.code || matched.sectionId;
    const courseName = matched.name || matched.courseName || '課程名稱';
    const courseTime = matched.time || matched.scheduleText || '週二 第 6、7 節';
    
    if (!courseId) {
      alert('無法識別此課程代碼，請稍後再試。');
      return;
    }

    const storageKey = `user_schedule_courses_${userIdentity || 'default'}`;
    let existingCourses = [];
    try {
      existingCourses = JSON.parse(localStorage.getItem(storageKey) || '[]');
    } catch {}

    const isAlreadyAdded = addedCourseIds.has(courseId) || existingCourses.some(c => c.id === courseId || c.code === courseId);

    if (isAlreadyAdded) {
      // 執行獨立取消加入
      const updatedCourses = existingCourses.filter(c => c.id !== courseId && c.code !== courseId);
      localStorage.setItem(storageKey, JSON.stringify(updatedCourses));
      setAddedCourseIds(prev => {
        const next = new Set(prev);
        next.delete(courseId);
        return next;
      });
      alert(`已從課表取消「${courseName}」`);
    } else {
      // 執行獨立加入課表（帶入完整的 schedule 座標，確保首頁能順利渲染方塊）
      const newCourse = {
        id: courseId,
        code: matched.code || matched.courseCode || courseId,
        name: courseName,
        credits: matched.credits || matched.credit || 3,
        category: matched.category || itemObj.gapLabel || '選修',
        instructor: matched.instructor || '未指定',
        time: courseTime,
        location: matched.location || '地點待排',
        schedule: matched.schedule || [{ day: 2, periods: [6, 7] }],
      };

      const updatedCourses = [...existingCourses, newCourse];
      localStorage.setItem(storageKey, JSON.stringify(updatedCourses));
      setAddedCourseIds(prev => new Set([...prev, courseId]));

      alert(`已成功將「${courseName} (${courseTime})」加入課表！請至首頁查看。`);
    }
    loadGraduationData();
  };

  // 處理點擊「查看詳情」（傳遞完整的 time 與 schedule 確保 Modal 不會顯示時間未定）
  const handleViewDetail = (itemObj) => {
    const matched = getMatchedCourse(itemObj);
    setSelectedCourse({
      name: matched.name || matched.courseName || '推薦課程',
      code: matched.code || matched.courseCode || 'CE07139-17113',
      category: matched.category || itemObj.gapLabel || '本系選修',
      credits: matched.credits || matched.credit || 3,
      instructor: matched.instructor || '蔡國裕',
      location: matched.location || '電腦教室',
      gradeLevel: matched.gradeLevel || 3,
      time: matched.time || '週二 第 6、7 節 (14:10~16:00)',
      schedule: matched.schedule || [{ day: 2, periods: [6, 7] }],
      prerequisites: matched.prerequisites || '無',
      description: matched.description || itemObj.message || '尚無課程說明。',
      recommendationReason: matched.recommendationReason || {
        selectedBecause: 'PREFERENCE_MATCH',
        confidence: 'high',
        matchedPreferences: [{ label: '網路安全' }, { label: '系統設計' }],
        scoreBreakdown: [{ component: 'tagInterest', value: 300 }],
        dataSources: ['Database Course Recommendation']
      }
    });
  };

  if (loading) {
    return (
      <div className="layout-container" id="graduation-page" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: 'var(--bg-main, #f8fafc)', color: 'var(--text-secondary, #64748b)', fontSize: '1.1rem' }}>
        載入中...
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="layout-container" id="graduation-page" style={{ minHeight: '100vh', backgroundColor: 'var(--bg-main, #f8fafc)' }}>
        <div style={{ maxWidth: '560px', margin: '18vh auto', padding: '32px', textAlign: 'center', background: 'var(--bg-card, #fff)', borderRadius: '16px', boxShadow: '0 10px 25px -5px rgba(0,0,0,0.05)' }}>
          <AlertTriangle size={48} style={{ color: '#ef4444', marginBottom: '16px' }} />
          <h2 style={{ fontSize: '1.25rem', fontWeight: '700', color: 'var(--text-main, #1e293b)' }}>畢業進度暫時無法載入</h2>
          <p style={{ color: 'var(--text-secondary, #64748b)', margin: '12px 0 24px', fontSize: '0.95rem' }}>{loadError}</p>
          <button className="btn-primary" type="button" onClick={loadGraduationData} style={{ padding: '10px 24px', background: '#3b82f6', color: '#fff', border: 'none', borderRadius: '8px', fontWeight: '600', cursor: 'pointer' }}>重新載入</button>
        </div>
      </div>
    );
  }

  const progressPercent = data?.courseHistoryAvailable && data.totalRequired
    ? Math.round((data.totalEarned / data.totalRequired) * 100)
    : 0;

  const watchlistCourses = DEFAULT_WATCHLIST_COURSES;

  // 獨立渲染學分卡片的 helper 函式
  const renderGapCard = (category) => {
    const gap = data?.gaps?.[category];
    if (gap === undefined) return null;
    const earnedCourses = data?.attribution?.[category]?.courses || [];
    const earnedCredits = data?.attribution?.[category]?.credits ?? 0;
    const isExpanded = !!expandedCategories[category];
    const isGeneral = category === 'general';

    return (
      <div 
        key={category} 
        className="grad-card grad-gap-card" 
        style={{ 
          background: 'var(--bg-card, #ffffff)', 
          padding: '20px', 
          borderRadius: '16px', 
          border: '1px solid var(--border-color, #e2e8f0)', 
          boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.02)', 
          display: 'flex', 
          flexDirection: 'column', 
          justifyContent: 'space-between',
          transition: 'all 0.3s ease'
        }}
      >
        <div>
          <div className="grad-gap-label" style={{ fontSize: '0.85rem', fontWeight: '600', color: 'var(--text-secondary, #64748b)', marginBottom: '8px' }}>
            尚缺{CREDIT_CATEGORY_LABELS[category] || category}
          </div>
          <div className={`grad-gap-value ${gap === 0 ? 'green' : 'red'}`} style={{ fontSize: '1.8rem', fontWeight: '800', color: gap === 0 ? '#10b981' : '#ef4444', marginBottom: '12px' }}>
            {gap} <span className="grad-gap-unit" style={{ fontSize: '0.85rem', fontWeight: '600', color: 'var(--text-secondary, #64748b)' }}>學分</span>
          </div>
        </div>

        {/* 點擊向下展開的詳細內容按鈕 */}
        <div style={{ marginTop: 'auto', borderTop: '1px solid #f1f5f9', paddingTop: '10px' }}>
          <button
            type="button"
            onClick={() => toggleCategoryExpand(category)}
            style={{
              width: '100%',
              background: '#f8fafc',
              border: '1px solid #e2e8f0',
              borderRadius: '8px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              fontSize: '0.85rem',
              color: '#3b82f6',
              fontWeight: '600',
              padding: '8px 12px'
            }}
          >
            <span>已修 {earnedCredits} 學分（{earnedCourses.length} 門）</span>
            {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </button>

          {/* 向下展開的 Detail 內容區塊 */}
          {isExpanded && (
            <div style={{ marginTop: '10px', display: 'flex', flexDirection: 'column', gap: '10px', animation: 'fadeIn 0.25s ease' }}>
              {/* 如果是通識類別，在展開後顯示基礎必修與通識選修的細節 */}
              {isGeneral && data?.generalEducation && (
                <div style={{ background: '#f8fafc', padding: '10px', borderRadius: '8px', fontSize: '0.82rem', display: 'flex', flexDirection: 'column', gap: '6px', border: '1px solid #e2e8f0' }}>
                  <div style={{ fontWeight: '700', color: '#1e293b' }}>通識細節拆解：</div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', color: '#475569' }}>
                    <span>基礎必修</span>
                    <span style={{ fontWeight: '600', color: data.generalEducation.basic.gap === 0 ? '#10b981' : '#ef4444' }}>
                      {data.generalEducation.basic.earned}/{data.generalEducation.basic.required}
                    </span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', color: '#475569' }}>
                    <span>通識選修</span>
                    <span style={{ fontWeight: '600', color: data.generalEducation.elective.gap === 0 ? '#10b981' : '#ef4444' }}>
                      {data.generalEducation.elective.earned}/{data.generalEducation.elective.required}
                    </span>
                  </div>
                </div>
              )}

              {/* 已修課程清單 */}
              {earnedCourses.length > 0 && (
                <ul className="grad-attribution-list" style={{ margin: 0, paddingLeft: '16px', fontSize: '0.8rem', color: '#475569', display: 'flex', flexDirection: 'column', gap: '4px', maxHeight: '160px', overflowY: 'auto' }}>
                  {earnedCourses.map(item => (
                    <li key={`${item.courseCode}-${item.academicYear}-${item.semester}`}>
                      <span className="grad-attribution-term" style={{ color: '#94a3b8', marginRight: '6px' }}>
                        {item.academicYear}-{item.semester}
                      </span>
                      <span className="grad-attribution-name" style={{ fontWeight: '500' }}>{item.courseName}</span>
                    </li>
                  ))}
                </ul>
              )}
              {earnedCourses.length > 0 && earnedCourses[0].ruleVersion && (
                <p className="grad-attribution-source" style={{ fontSize: '0.75rem', color: '#94a3b8', margin: 0 }}>
                  依 {earnedCourses[0].ruleVersion} 學年度規則認列
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="layout-container" id="graduation-page">
      {/* Top Navbar */}
      <TopNav />

      {/* Main content - 雙欄儀表板佈局 */}
      <div className="graduation-content" style={{ display: 'grid', gridTemplateColumns: '1fr 380px', gap: '24px', padding: '24px 32px', maxWidth: '1600px', width: '100%', margin: '0 auto', boxSizing: 'border-box' }}>
        
        {/* Left Column: Credit overview & Gaps & Watchlist (獨立滾動軸，左欄展開不影響右欄或自由選修) */}
        <div 
          className="graduation-left" 
          style={{ 
            display: 'flex', 
            flexDirection: 'column', 
            gap: '20px', 
            maxHeight: 'calc(100vh - 120px)', 
            overflowY: 'auto', 
            paddingRight: '6px' 
          }}
        >
          {Array.isArray(data?.warnings) && data.warnings.length > 0 && (
            <div className="grad-card grad-warnings" role="alert" style={{ background: '#fffbeb', border: '1px solid #fef3c7', padding: '16px 20px', borderRadius: '12px', color: '#b45309' }}>
              {data.warnings.map((warning, i) => (
                <p key={i} className="grad-warning-message" style={{ display: 'flex', alignItems: 'center', gap: '8px', margin: 0, fontSize: '0.92rem' }}>
                  <AlertTriangle size={16} className="grad-warning-icon" style={{ flexShrink: 0 }} /> {warning}
                </p>
              ))}
            </div>
          )}

          {data?.courseHistoryAvailable === false ? (
            <div className="grad-card grad-history-missing" role="alert" style={{ background: '#fef2f2', border: '1px solid #fecaca', padding: '24px', borderRadius: '12px', display: 'flex', gap: '16px', alignItems: 'flex-start' }}>
              <AlertTriangle size={24} className="grad-history-missing-icon" style={{ color: '#ef4444', flexShrink: 0, marginTop: '2px' }} />
              <div>
                <div className="grad-history-missing-title" style={{ fontWeight: '700', color: '#991b1b', fontSize: '1.05rem', marginBottom: '6px' }}>無法顯示修課進度</div>
                <p className="grad-history-missing-message" style={{ color: '#7f1d1d', margin: 0, fontSize: '0.9rem', lineHeight: '1.5' }}>
                  {data.courseHistoryMessage || '缺少歷史修課資料，請至 MyFCU 擷取歷史修課資料並匯入。'}
                </p>
              </div>
            </div>
          ) : (
            <>
              {/* Total progress card - 已修學分總覽 */}
              <div className="grad-card grad-total" style={{ background: 'var(--bg-card, #ffffff)', padding: '24px 28px', borderRadius: '16px', border: '1px solid var(--border-color, #e2e8f0)', boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.02)' }}>
                <div className="grad-card-label" style={{ fontSize: '0.9rem', fontWeight: '600', color: 'var(--text-secondary, #64748b)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '8px' }}>已修學分總覽</div>
                <div className="grad-card-big-number" style={{ display: 'flex', alignItems: 'baseline', gap: '6px', marginBottom: '16px' }}>
                  <span className="grad-number-main" style={{ fontSize: '2.5rem', fontWeight: '800', color: 'var(--text-main, #1e293b)', lineHeight: 1 }}>{data?.totalEarned || 0}</span>
                  <span className="grad-number-divider" style={{ fontSize: '1.5rem', fontWeight: '500', color: '#94a3b8' }}>/</span>
                  <span className="grad-number-total" style={{ fontSize: '1.5rem', fontWeight: '600', color: 'var(--text-secondary, #64748b)' }}>{data?.totalRequired ?? '—'}</span>
                  <span style={{ marginLeft: 'auto', fontSize: '1.1rem', fontWeight: '700', color: progressPercent >= 100 ? '#10b981' : '#3b82f6' }}>{progressPercent}%</span>
                </div>
                <div className="grad-progress-bar" style={{ height: '10px', background: '#f1f5f9', borderRadius: '999px', overflow: 'hidden' }}>
                  <div className="grad-progress-fill" style={{ width: `${Math.min(progressPercent, 100)}%`, height: '100%', background: 'linear-gradient(90deg, #3b82f6, #6366f1)', borderRadius: '999px', transition: 'width 0.5s ease' }} />
                </div>
              </div>

              {/* Gap cards grid - 左右雙欄獨立排列，確保點擊右欄選單不影響左欄自由選修位置 */}
              <div className="grad-gaps-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', alignItems: 'flex-start' }}>
                {/* 左欄：本系必修、外系選修、自由選修 */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                  {renderGapCard('required')}
                  {renderGapCard('external')}
                  {renderGapCard('unspecified')}
                </div>
                {/* 右欄：本系選修、通識 */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                  {renderGapCard('elective')}
                  {renderGapCard('general')}
                </div>
              </div>
            </>
          )}

          {/* Watchlist - 候選課程口袋名單 */}
          <div className="grad-watchlist" style={{ background: 'var(--bg-card, #ffffff)', padding: '24px', borderRadius: '16px', border: '1px solid var(--border-color, #e2e8f0)', boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.02)' }}>
            <h3 className="grad-watchlist-title" style={{ fontSize: '1.05rem', fontWeight: '700', color: 'var(--text-main, #1e293b)', display: 'flex', alignItems: 'center', gap: '8px', margin: '0 0 4px 0' }}>
              📌 我的候選課程口袋名單
            </h3>
            <p className="grad-watchlist-desc" style={{ fontSize: '0.88rem', color: 'var(--text-secondary, #64748b)', margin: '0 0 16px 0' }}>
              可作為排課備案，或交由 AI 自動安插
            </p>
            
            <div 
              className="grad-watchlist-grid" 
              style={{ 
                maxHeight: '260px', 
                overflowY: 'auto', 
                paddingRight: '6px',
                display: 'flex',
                flexDirection: 'column',
                gap: '10px'
              }}
            >
              {watchlistCourses.map((course, i) => {
                const courseId = course.id;
                const courseName = course.name;
                const isAdded = addedCourseIds.has(courseId);

                return (
                  <div key={i} className="grad-watchlist-item" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#f8fafc', padding: '12px 16px', borderRadius: '10px', border: '1px solid #e2e8f0', transition: 'background 0.2s' }}>
                    <div style={{ flex: 1 }}>
                      <div className="grad-watchlist-name" style={{ fontWeight: '600', color: '#1e293b', fontSize: '0.92rem' }}>{courseName}</div>
                      <div className="grad-watchlist-meta" style={{ fontSize: '0.82rem', color: '#64748b', marginTop: '2px' }}>{course.category} / {course.credits} 學分 ({course.code}) - {course.time}</div>
                    </div>
                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                      <button 
                        className="grad-watchlist-detail-btn"
                        onClick={() => handleViewDetail(course)}
                        style={{
                          background: '#fff',
                          color: '#475569',
                          border: '1px solid #cbd5e1',
                          borderRadius: '8px',
                          padding: '6px 12px',
                          fontSize: '0.8rem',
                          fontWeight: '600',
                          cursor: 'pointer'
                        }}
                      >
                        詳情
                      </button>
                      <button 
                        className="grad-watchlist-add" 
                        id={`watchlist-add-${i}`} 
                        onClick={() => handleToggleSchedule(course)}
                        style={{ 
                          background: isAdded ? '#ef4444' : '#3b82f6', 
                          color: '#fff', 
                          border: 'none', 
                          borderRadius: '8px', 
                          width: '34px', 
                          height: '34px', 
                          display: 'flex', 
                          alignItems: 'center', 
                          justifyContent: 'center', 
                          cursor: 'pointer', 
                          flexShrink: '0', 
                          boxShadow: '0 2px 4px rgba(59, 130, 246, 0.2)' 
                        }}
                        title={isAdded ? '取消加入' : '加入課表'}
                      >
                        {isAdded ? <Trash2 size={16} /> : <Plus size={16} />}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Right Column: AI recommendations */}
        <div className="graduation-right">
          <div className="grad-ai-card" style={{ background: 'var(--bg-card, #ffffff)', padding: '24px', borderRadius: '16px', border: '1px solid var(--border-color, #e2e8f0)', boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.02)', position: 'sticky', top: '88px' }}>
            <h3 className="grad-ai-title" style={{ fontSize: '1.05rem', fontWeight: '700', color: 'var(--text-main, #1e293b)', display: 'flex', alignItems: 'center', gap: '8px', margin: '0 0 20px 0', borderBottom: '1px solid #f1f5f9', paddingBottom: '14px' }}>
              🤖 AI 缺漏學分補救建議
            </h3>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', maxHeight: 'calc(100vh - 200px)', overflowY: 'auto', paddingRight: '4px' }}>
              {(data?.recommendations || []).length === 0 ? (
                <div style={{ textAlign: 'center', padding: '30px', color: '#94a3b8', fontSize: '0.9rem', background: '#f8fafc', borderRadius: '10px' }}>
                  目前沒有 AI 補救建議
                </div>
              ) : (
                (data?.recommendations || []).map((rec, i) => {
                  const matched = getMatchedCourse(rec);
                  const courseId = matched.id || matched.code || matched.sectionId;
                  const courseName = matched.name || matched.courseName || rec.gapLabel || '推薦課程';
                  const isAdded = courseId ? addedCourseIds.has(courseId) : false;

                  return (
                    <div key={i} className={`grad-rec-item ${rec.type}`} style={{ background: rec.type === 'warning' ? '#fef2f2' : '#f0fdf4', border: `1px solid ${rec.type === 'warning' ? '#fecaca' : '#bbf7d0'}`, padding: '16px', borderRadius: '12px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                      <div className="grad-rec-header" style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: '600', fontSize: '0.88rem', color: rec.type === 'warning' ? '#991b1b' : '#166534' }}>
                        {rec.type === 'warning' ? (
                          <AlertTriangle size={16} className="grad-warning-icon" style={{ flexShrink: 0 }} />
                        ) : (
                          <Lightbulb size={16} className="grad-warning-icon" style={{ flexShrink: 0 }} />
                        )}
                        <span className="grad-rec-type">
                          {rec.type === 'warning'
                            ? '⚠️ 必修警告：'
                            : `💡 ${rec.gapLabel || '課程'}推薦：`}
                        </span>
                      </div>
                      <p className="grad-rec-message" style={{ margin: 0, fontSize: '0.88rem', color: '#334155', lineHeight: '1.5' }}>{rec.message}</p>
                      <div className="grad-rec-actions" style={{ display: 'flex', gap: '8px', marginTop: '4px' }}>
                        <button 
                          className="grad-rec-btn primary" 
                          id={`rec-add-${i}`} 
                          onClick={() => handleToggleSchedule(rec)}
                          style={{ 
                            flex: 1, 
                            padding: '8px 12px', 
                            background: isAdded ? '#ef4444' : '#3b82f6', 
                            color: '#fff', 
                            border: 'none', 
                            borderRadius: '6px', 
                            fontSize: '0.82rem', 
                            fontWeight: '600', 
                            display: 'flex', 
                            alignItems: 'center', 
                            justifyContent: 'center', 
                            gap: '4px', 
                            cursor: 'pointer',
                            transition: 'background 0.2s'
                          }}
                        >
                          {isAdded ? <Trash2 size={14} /> : <Plus size={14} />}
                          {isAdded ? '取消' : '加入課表'}
                        </button>
                        <button 
                          className="grad-rec-btn secondary" 
                          id={`rec-detail-${i}`} 
                          onClick={() => handleViewDetail(rec)}
                          style={{ flex: 1, padding: '8px 12px', background: '#fff', color: '#475569', border: '1px solid #cbd5e1', borderRadius: '6px', fontSize: '0.82rem', fontWeight: '600', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px', cursor: 'pointer' }}
                        >
                          <Search size={14} />
                          查看詳情
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>

      </div>

      {/* 課程詳情 Modal */}
      {selectedCourse && (
        <CourseDetailModal
          course={selectedCourse}
          onClose={() => setSelectedCourse(null)}
        />
      )}
    </div>
  );
}