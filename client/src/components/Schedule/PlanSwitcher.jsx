import { ChevronDown, Info, Sparkles } from 'lucide-react';

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
  // 興趣導向方案排不出更符合興趣的課表，而綜合方案已有興趣命中（2026-11-23 使用者要求）。
  'base-already-best-interest': '綜合方案已經是最符合你興趣的組合，再排一份只會是重複的課表',
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

export default function PlanSwitcher({ plans = [], selectedPlanId, recommendedPlanId, planDiversity, onSelectPlan }) {
  if (plans.length === 0) return null;

  const selected = plans.find(plan => plan.id === selectedPlanId) ?? plans[0];
  const collapsed = Array.isArray(planDiversity?.collapsed) ? planDiversity.collapsed : [];
  const requested = planDiversity?.requestedVariants ?? plans.length;
  const multiplePlans = plans.length > 1;

  return (
    <div className="plan-switcher" id="plan-switcher">
      {multiplePlans ? (
        <>
          <button type="button" className="schedule-plan-button schedule-plan-picker"
            popoverTarget="schedule-plan-options" aria-label={`切換方案，目前為${selected.title}`}>
            <span>{selected.title}</span>
            <ChevronDown size={16} aria-hidden="true" />
          </button>
          <div id="schedule-plan-options" className="schedule-plan-popover schedule-plan-options" popover="auto"
            role="group" aria-label="可切換的課表方案">
            {plans.map(plan => (
              <button key={plan.id} type="button" className="schedule-plan-option"
                aria-current={plan.id === selected.id ? 'true' : undefined}
                popoverTarget="schedule-plan-options" popoverTargetAction="hide"
                onClick={() => onSelectPlan?.(plan.id)}>
                <span>
                  {plan.planId === recommendedPlanId && <Sparkles size={15} aria-label="系統主推" />}
                  {plan.title}
                </span>
                <small>{plan.schedule?.length ?? plan.courseCount ?? 0} 門・{plan.totalCredits} 學分</small>
              </button>
            ))}
          </div>
        </>
      ) : <span className="schedule-plan-name">{selected.title}</span>}

      <button type="button" className="schedule-plan-button" popoverTarget="plan-explanation">
        <Info size={16} aria-hidden="true" />
        方案說明
      </button>
      <section id="plan-explanation" className="schedule-plan-popover" popover="auto" aria-labelledby="plan-explanation-title">
        <h3 id="plan-explanation-title">方案說明</h3>
        <p>
          {selected.description || '依照你的偏好與畢業需求排出的課表。'}
          {multiplePlans && selected.planId === recommendedPlanId ? '（系統主推）' : ''}
        </p>
        {collapsed.length > 0 && (
          <>
            <p>{multiplePlans
              ? `另有 ${collapsed.length} 種取向沒有排出內容不同的課表。`
              : `系統嘗試了 ${requested} 種取向，這次只產生 1 個方案。`}</p>
            <details>
              <summary>為什麼？</summary>
              <ul>
                {collapsed.map(item => <li key={item.variantId}>{item.title}：{collapseReason(item)}</li>)}
              </ul>
            </details>
          </>
        )}
      </section>
    </div>
  );
}
