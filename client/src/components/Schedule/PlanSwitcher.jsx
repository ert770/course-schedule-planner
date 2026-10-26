import { useState } from 'react';
import { Sparkles, ChevronDown, ChevronUp } from 'lucide-react';

// Roadmap #27：方案切換列。
//
// 2026-10-26：不論排出 1 個或多個方案，都顯示方案按鈕與方案說明。PR #27 改成「只有 1 個方案就整列不顯示」，
// 使用者因此看不出系統其實嘗試了幾種取向、為什麼最後只剩一個。
//
// 其他取向沒產生時的原因文案，與後端 skills/scheduler.js 的 COLLAPSE_REASON_TEXT／COLLAPSE_DETAIL_TEXT 對齊；
// 前後端不共用程式碼，改一邊時兩邊都要改。
const REASON_TEXT = {
  'no-signal': '候選課缺少可區分的資料',
  'insufficient-difference': '無法在品質下限內換進、換出至少兩門課',
  'credit-parity-infeasible': '無法維持綜合方案的學分',
  'axis-threshold-infeasible': '無法達到主軸改善門檻',
  'hierarchy-parity-infeasible': '無法維持與綜合方案相同的本系／跨年級／系外課程結構',
  'graduation-category-infeasible': '無法維持綜合方案的選修／通識／系外門數',
  'rating-coverage-infeasible': '有評價的課不足，無法在維持評價涵蓋下提高主軸表現',
  'quality-floor': '換課後品質會低於綜合方案的 87%',
  'combined-constraints': '學分、品質、換課與主軸門檻無法同時滿足',
  'solver-time-limit': '單次求解時間不足',
  'solver-budget-exceeded': '求解時間已達本次上限',
  'solver-unavailable': '求解器目前無法使用',
  'same-course-combination': '排出來的課程組合與其他方案相同',
  'candidate-check-failed': '產生的候選未通過課表規則檢查',
  'selection-error': '方案挑選步驟發生錯誤',
  infeasible: '限制組合下沒有可行解',
};

// no-signal 的細分原因（後端 axis signal 檢查的 detail），說得出更準的話就優先用。
const DETAIL_TEXT = {
  'threshold-unreachable': '綜合方案已達目前課程資料可改善的界線',
  'single-day': '綜合方案只用到一天，已經不能更集中',
  'fixed-days-blocked': '必修與固定的課已分布在這些天，無法再減少上課天數',
  'flat-scores': '候選課在這個面向的分數都一樣，分不出差別',
  'no-interest-keywords': '還沒有設定感興趣的方向',
  'no-easiness-baseline': '缺少評價資料，無法判斷課程輕鬆或挑戰',
  'insufficient-rating': '有評價的候選課太少',
};

function collapseReason(item) {
  if (item.detail === 'too-similar-to-selected') {
    const names = (item.conflictsWith || []).map(other => `「${other.title}」`).join('');
    return `和${names || '其他方案'}只差不到兩門課，幾乎相同`;
  }
  return DETAIL_TEXT[item.detail] || REASON_TEXT[item.reason] || REASON_TEXT['same-course-combination'];
}

const EXPLANATION_KEY = 'fcu_plan_explanation_open';

function readExplanationOpen() {
  try {
    return localStorage.getItem(EXPLANATION_KEY) !== 'false';
  } catch {
    return true;
  }
}

export default function PlanSwitcher({ plans = [], selectedPlanId, recommendedPlanId, planDiversity, onSelectPlan }) {
  // 方案說明可以收合；記住使用者上次的選擇（只是介面偏好，讀不到就預設展開）。
  const [explanationOpen, setExplanationOpen] = useState(readExplanationOpen);
  const toggleExplanation = () => {
    setExplanationOpen(prev => {
      try { localStorage.setItem(EXPLANATION_KEY, String(!prev)); } catch { /* 瀏覽器不允許儲存時只影響這次 */ }
      return !prev;
    });
  };

  // 沒有方案資料（例如從已存課表載回，不屬於任何一次推薦）時不顯示——沒有東西可以選。
  if (!Array.isArray(plans) || plans.length === 0) return null;

  const selected = plans.find(plan => plan.id === selectedPlanId) ?? plans[0];
  const collapsed = Array.isArray(planDiversity?.collapsed) ? planDiversity.collapsed : [];
  const requested = planDiversity?.requestedVariants ?? plans.length;

  return (
    <div className="plan-switcher" id="plan-switcher" style={{ margin: '12px 0 16px' }}>
      <div style={{ display: 'flex', justifyContent: 'center' }}>
        <div
          role="tablist"
          aria-label="排課方案"
          style={{
            display: 'inline-flex', flexWrap: 'wrap', justifyContent: 'center', gap: '4px', padding: '6px',
            background: '#f8fafc', borderRadius: '999px', border: '1px solid #e2e8f0',
          }}
        >
          {plans.map(plan => {
            const isSelected = plan.id === selected.id;
            const isRecommended = plan.planId === recommendedPlanId;
            return (
              <button
                key={plan.id}
                type="button"
                role="tab"
                aria-selected={isSelected}
                id={`plan-tab-${plan.id}`}
                onClick={() => onSelectPlan?.(plan.id)}
                title={isRecommended ? '系統綜合評估的主推方案' : `切換至${plan.title}`}
                style={{
                  padding: '8px 18px', borderRadius: '999px', border: 'none', cursor: 'pointer',
                  background: isSelected ? '#ffffff' : 'transparent',
                  color: isSelected ? '#3b82f6' : '#64748b',
                  fontWeight: isSelected ? 700 : 500, fontSize: '0.9rem',
                  boxShadow: isSelected ? '0 2px 8px rgba(0, 0, 0, 0.08)' : 'none',
                  display: 'flex', alignItems: 'center', gap: '6px',
                }}
              >
                {isRecommended && <Sparkles size={15} style={{ color: isSelected ? '#3b82f6' : '#fbbf24' }} />}
                <span>{plan.title}</span>
                <span style={{ fontSize: '0.75rem', fontWeight: 500, color: '#94a3b8' }}>
                  {plan.schedule?.length ?? plan.courseCount ?? 0} 門・{plan.totalCredits} 學分
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div
        className="plan-explanation"
        id="plan-explanation"
        style={{
          margin: '10px auto 0', maxWidth: '720px', padding: '10px 14px', borderRadius: '10px',
          background: '#f8fafc', border: '1px solid #e2e8f0', fontSize: '0.85rem', color: '#475569', lineHeight: 1.6,
        }}
      >
        <button
          type="button"
          onClick={toggleExplanation}
          aria-expanded={explanationOpen}
          aria-controls="plan-explanation-body"
          style={{
            display: 'flex', alignItems: 'center', gap: '6px', width: '100%', padding: 0,
            background: 'none', border: 'none', cursor: 'pointer', color: '#1e293b', fontWeight: 700, fontSize: '0.85rem',
          }}
        >
          方案說明
          {explanationOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </button>
        {explanationOpen && (
          <div id="plan-explanation-body" style={{ marginTop: '4px' }}>
            <div>
              {selected.description || '依照你的偏好與畢業需求排出的課表。'}
              {selected.planId === recommendedPlanId && plans.length > 1 ? '（系統主推）' : ''}
            </div>
            {collapsed.length > 0 && (
              <div style={{ marginTop: '4px' }}>
                {plans.length === 1
                  ? `這次只產生 1 個方案：系統嘗試了 ${requested} 種取向，其他 ${collapsed.length} 種沒有排出內容不同的課表。`
                  : `另有 ${collapsed.length} 種取向沒有排出內容不同的課表。`}
                <details style={{ marginTop: '2px' }}>
                  <summary style={{ cursor: 'pointer', color: '#3b82f6' }}>為什麼？</summary>
                  <ul style={{ margin: '4px 0 0', paddingLeft: '20px' }}>
                    {collapsed.map(item => (
                      <li key={item.variantId}>{item.title}：{collapseReason(item)}</li>
                    ))}
                  </ul>
                </details>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
