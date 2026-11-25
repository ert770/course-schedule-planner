import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../contexts/useAuth';
import { useSchedule } from '../contexts/useSchedule';
import { formatCourseTime } from '../utils/courseTime';
import { coursesAPI, graduationAPI } from '../services/api';
import { getUserIdentity } from '../utils/userIdentity';
import { AlertTriangle, Lightbulb, ChevronDown, ChevronUp } from 'lucide-react';

import TopNav from '../components/Layout/TopNav';
import CourseActions, { CourseActionsProvider } from '../components/CourseCard/CourseActions';
import CourseDetailModal from '../components/CourseCard/CourseDetailModal';

// `GET /api/graduation/:studentId` 的學分類別 key 對應中文標題。
const CREDIT_CATEGORY_LABELS = {
  required: '本系必修',
  elective: '本系選修',
  general: '通識',
  external: '外系選修',
  unspecified: '自由選修',
};

export default function GraduationPage() {
  const { user } = useAuth();
  const userIdentity = getUserIdentity(user);
  const { watchlist } = useSchedule();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  
  // 記錄每個學分卡片的展開狀態（控制向下展開）
  const [expandedCategories, setExpandedCategories] = useState({});

  const [watchlistCourses, setWatchlistCourses] = useState([]);
  const [watchlistUnavailable, setWatchlistUnavailable] = useState(0);

  useEffect(() => {
    let cancelled = false;
    Promise.allSettled(watchlist.map(id => coursesAPI.getDetail(id))).then(results => {
      if (cancelled) return;
      setWatchlistCourses(results.flatMap(result => result.status === 'fulfilled' ? [result.value] : []));
      setWatchlistUnavailable(results.filter(result => result.status === 'rejected').length);
    });
    return () => { cancelled = true; };
  }, [watchlist]);

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
      <CourseActionsProvider>

      {/* Main content - 雙欄儀表板佈局 */}
      <div className="graduation-content" style={{ padding: '24px 32px', maxWidth: '1600px', width: '100%', margin: '0 auto', boxSizing: 'border-box' }}>
        
        {/* Left Column: Credit overview & Gaps & Watchlist */}
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

              {/* Gap cards grid - 左右雙欄獨立排列 */}
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
              我的關注課程
            </h3>
            <p className="grad-watchlist-desc" style={{ fontSize: '0.88rem', color: 'var(--text-secondary, #64748b)', margin: '0 0 16px 0' }}>
              可查看詳情、取消關注或加入課表
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
              {watchlist.length === 0 && <p>目前沒有關注課程。</p>}
              {watchlistUnavailable > 0 && watchlist.length > 0 && <p role="status">有 {watchlistUnavailable} 門關注課程暫時無法載入。</p>}
              {watchlistCourses.filter(course => watchlist.includes(String(course.id ?? course.sectionId))).map(course => (
                <div key={course.id ?? course.sectionId} className="grad-watchlist-item">
                  <div className="grad-watchlist-name">{course.name}</div>
                  <div className="grad-watchlist-meta">{course.category} / {course.credits} 學分 ({course.code}) - {formatCourseTime(course)}</div>
                  <div className="grad-course-controls">
                    <button type="button" className="course-card-action grad-course-detail" onClick={() => setSelectedCourse(course)}>
                      詳情
                    </button>
                    <CourseActions course={course} />
                  </div>
                </div>
              ))}
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
                  const course = rec.course;
                  const sectionId = Number(course?.id ?? course?.sectionId);
                  const hasSection = Number.isSafeInteger(sectionId) && sectionId > 0;

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
                      {hasSection && (
                        <div className="grad-course-controls">
                          <button type="button" className="course-card-action grad-course-detail" onClick={() => setSelectedCourse(course)}>
                            查看詳情
                          </button>
                          <CourseActions course={course} />
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>

      </div>

      </CourseActionsProvider>

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
