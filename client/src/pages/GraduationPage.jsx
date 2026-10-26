import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../contexts/useAuth';
import { graduationAPI } from '../services/api';
import { getUserIdentity } from '../utils/userIdentity';
import { X, Plus, Search, AlertTriangle, Lightbulb, Calendar, LayoutDashboard, Settings, Moon, Sun, Compass } from 'lucide-react';

import TopNav from '../components/Layout/TopNav';
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
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
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

  return (
    <div className="layout-container" id="graduation-page">
      {/* Top Navbar */}
      <TopNav />

      {/* Main content - 雙欄儀表板佈局 */}
      <div className="graduation-content" style={{ display: 'grid', gridTemplateColumns: '1fr 380px', gap: '24px', padding: '24px 32px', maxWidth: '1600px', width: '100%', margin: '0 auto', boxSizing: 'border-box' }}>
        
        {/* Left Column: Credit overview & Gaps & Watchlist */}
        <div className="graduation-left" style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
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

              {/* Gap cards grid - 各項缺口分類 */}
              <div className="grad-gaps-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '16px' }}>
                {Object.entries(data?.gaps || {}).map(([category, gap]) => {
                  const earnedCourses = data?.attribution?.[category]?.courses || [];
                  const earnedCredits = data?.attribution?.[category]?.credits ?? 0;
                  return (
                    <div key={category} className="grad-card grad-gap-card" style={{ background: 'var(--bg-card, #ffffff)', padding: '20px', borderRadius: '16px', border: '1px solid var(--border-color, #e2e8f0)', boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.02)', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
                      <div>
                        <div className="grad-gap-label" style={{ fontSize: '0.85rem', fontWeight: '600', color: 'var(--text-secondary, #64748b)', marginBottom: '8px' }}>尚缺{CREDIT_CATEGORY_LABELS[category] || category}</div>
                        <div className={`grad-gap-value ${gap === 0 ? 'green' : 'red'}`} style={{ fontSize: '1.8rem', fontWeight: '800', color: gap === 0 ? '#10b981' : '#ef4444', marginBottom: '12px' }}>
                          {gap} <span className="grad-gap-unit" style={{ fontSize: '0.85rem', fontWeight: '600', color: 'var(--text-secondary, #64748b)' }}>學分</span>
                        </div>
                        {category === 'general' && data?.generalEducation && (
                          <div className="grad-gap-split" style={{ background: '#f8fafc', padding: '10px', borderRadius: '8px', marginBottom: '12px', fontSize: '0.85rem', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                            <div className="grad-gap-split-row" style={{ display: 'flex', justifyContent: 'space-between', color: '#475569' }}>
                              <span>基礎必修</span>
                              <span style={{ fontWeight: '600', color: data.generalEducation.basic.gap === 0 ? '#10b981' : '#ef4444' }}>
                                {data.generalEducation.basic.earned}/{data.generalEducation.basic.required}
                              </span>
                            </div>
                            <div className="grad-gap-split-row" style={{ display: 'flex', justifyContent: 'space-between', color: '#475569' }}>
                              <span>通識選修</span>
                              <span style={{ fontWeight: '600', color: data.generalEducation.elective.gap === 0 ? '#10b981' : '#ef4444' }}>
                                {data.generalEducation.elective.earned}/{data.generalEducation.elective.required}
                              </span>
                            </div>
                          </div>
                        )}
                      </div>
                      {earnedCourses.length > 0 && (
                        <details className="grad-attribution" style={{ marginTop: 'auto', borderTop: '1px solid #f1f5f9', paddingTop: '10px' }}>
                          <summary className="grad-attribution-summary" style={{ fontSize: '0.85rem', color: '#3b82f6', cursor: 'pointer', fontWeight: '600' }}>
                            已修 {earnedCredits} 學分（{earnedCourses.length} 門）
                          </summary>
                          <ul className="grad-attribution-list" style={{ margin: '8px 0 0 0', paddingLeft: '16px', fontSize: '0.8rem', color: '#475569', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                            {earnedCourses.map(item => (
                              <li key={`${item.courseCode}-${item.academicYear}-${item.semester}`}>
                                <span className="grad-attribution-term" style={{ color: '#94a3b8', marginRight: '6px' }}>
                                  {item.academicYear}-{item.semester}
                                </span>
                                <span className="grad-attribution-name" style={{ fontWeight: '500' }}>{item.courseName}</span>
                              </li>
                            ))}
                          </ul>
                          <p className="grad-attribution-source" style={{ fontSize: '0.75rem', color: '#94a3b8', margin: '6px 0 0 0' }}>
                            依 {earnedCourses[0].ruleVersion || '—'} 學年度規則認列
                          </p>
                        </details>
                      )}
                    </div>
                  );
                })}
              </div>
            </>
          )}

          {/* Watchlist - 支援上下捲動的口袋名單容器 */}
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
              {(data?.watchlist || []).length === 0 ? (
                <div style={{ textAlign: 'center', padding: '30px', color: '#94a3b8', fontSize: '0.9rem', background: '#f8fafc', borderRadius: '10px' }}>
                  目前沒有候選課程口袋名單
                </div>
              ) : (
                (data?.watchlist || []).map((course, i) => (
                  <div key={i} className="grad-watchlist-item" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#f8fafc', padding: '12px 16px', borderRadius: '10px', border: '1px solid #e2e8f0', transition: 'background 0.2s' }}>
                    <div>
                      <div className="grad-watchlist-name" style={{ fontWeight: '600', color: '#1e293b', fontSize: '0.92rem' }}>{course.name}</div>
                      <div className="grad-watchlist-meta" style={{ fontSize: '0.82rem', color: '#64748b', marginTop: '2px' }}>{course.category} / {course.credits} 學分</div>
                    </div>
                    <button className="grad-watchlist-add" id={`watchlist-add-${i}`} style={{ background: '#3b82f6', color: '#fff', border: 'none', borderRadius: '8px', width: '34px', height: '34px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: '0', boxShadow: '0 2px 4px rgba(59, 130, 246, 0.2)' }}>
                      <Plus size={16} />
                    </button>
                  </div>
                ))
              )}
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
                (data?.recommendations || []).map((rec, i) => (
                  <div key={i} className={`grad-rec-item ${rec.type}`} style={{ background: rec.type === 'warning' ? '#fef2f2' : '#f0fdf4', border: `1px solid ${rec.type === 'warning' ? '#fecaca' : '#bbf7d0'}`, padding: '16px', borderRadius: '12px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    <div className="grad-rec-header" style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: '600', fontSize: '0.88rem', color: rec.type === 'warning' ? '#991b1b' : '#166534' }}>
                      {rec.type === 'warning' ? (
                        <AlertTriangle size={16} className="rec-icon warning" style={{ flexShrink: 0 }} />
                      ) : (
                        <Lightbulb size={16} className="rec-icon suggestion" style={{ flexShrink: 0 }} />
                      )}
                      <span className="grad-rec-type">
                        {rec.type === 'warning'
                          ? '⚠️ 必修警告：'
                          : `💡 ${rec.gapLabel || '課程'}推薦：`}
                      </span>
                    </div>
                    <p className="grad-rec-message" style={{ margin: 0, fontSize: '0.88rem', color: '#334155', lineHeight: '1.5' }}>{rec.message}</p>
                    <div className="grad-rec-actions" style={{ display: 'flex', gap: '8px', marginTop: '4px' }}>
                      <button className="grad-rec-btn primary" id={`rec-add-${i}`} style={{ flex: 1, padding: '8px 12px', background: '#3b82f6', color: '#fff', border: 'none', borderRadius: '6px', fontSize: '0.82rem', fontWeight: '600', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px', cursor: 'pointer' }}>
                        <Plus size={14} />
                        加入課表
                      </button>
                      <button className="grad-rec-btn secondary" id={`rec-detail-${i}`} style={{ flex: 1, padding: '8px 12px', background: '#fff', color: '#475569', border: '1px solid #cbd5e1', borderRadius: '6px', fontSize: '0.82rem', fontWeight: '600', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px', cursor: 'pointer' }}>
                        <Search size={14} />
                        查看詳情
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}