// Roadmap #27：方案切換列。
//
// 後端 `generateSchedule()` 一直都算出全部方案（`result.plans`），先前前端只
// 讀 `plans[0]` 的 `planId`，其餘方案的課表、標題、偏好符合度全部被丟棄——
// 使用者因此完全不知道系統其實排了「涼課與高分優先」等其他取向。這裡把
// 被丟棄的東西找回來。

function describeCollapse(diversity) {
  if (!diversity || diversity.collapsed.length === 0) return null;
  // 這份文案與後端 skills/scheduler.js 的 COLLAPSE_REASON_TEXT／COLLAPSE_DETAIL_TEXT 對齊
  // （warnings 走後端那份，這裡走 planDiversity）。前後端不共用程式碼，改一邊時兩邊都要改。
  const reasonText = {
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
    infeasible: '限制組合下沒有可行解',
  };
  // 2026-09-20：no-signal 太籠統。後端會附 detail，說得出更準的話就優先用 detail——
  // 「已經做不到更好」和「資料分不出差別」對使用者是兩件事。
  const detailText = {
    'threshold-unreachable': '綜合方案已達目前課程資料可改善的界線，無法再產生有意義的主軸改善',
  };
  const details = diversity.collapsed
    .map(item => {
      const text = detailText[item.detail]
        || reasonText[item.reason] || item.reason || '未產生不同組合';
      return `${item.title}：${text}`;
    })
    .join('；');
  return `${details}。目前提供 ${diversity.distinctPlans} 種方案。`
    + `可競爭的課程共 ${diversity.competablePoolSize} 門。`;
}

export default function PlanSwitcher({ plans = [], selectedPlanId, recommendedPlanId, planDiversity, onSelectPlan }) {
  // 沒有方案資料（例如從已存課表載回，不屬於任何一次推薦）時不顯示——
  // 沒有東西可以切換。
  if (!Array.isArray(plans) || plans.length === 0) return null;

  const collapseMessage = describeCollapse(planDiversity);
  const requestedVariants = planDiversity?.requestedVariants ?? plans.length;

  return (
    <div className="plan-switcher" id="plan-switcher">
      {plans.length > 1 ? (
        <div className="plan-switcher-tabs" role="tablist" aria-label="排課方案">
          {plans.map(plan => (
            <button
              key={plan.id}
              type="button"
              role="tab"
              aria-selected={plan.id === selectedPlanId}
              className={`plan-switcher-tab${plan.id === selectedPlanId ? ' active' : ''}`}
              onClick={() => onSelectPlan?.(plan.id)}
            >
              <span className="plan-switcher-tab-title">{plan.title}</span>
              <span className="plan-switcher-tab-meta">
                {plan.schedule.length} 門課・{plan.totalCredits} 學分
                {plan.planId === recommendedPlanId ? '（主推）' : ''}
              </span>
            </button>
          ))}
        </div>
      ) : (
        // 誠實顯示「今天只有這一個方案」，不是留白讓使用者以為系統只想得出一種。
        <p className="plan-switcher-single-note">
          目前只有 1 個方案可以顯示{requestedVariants > 1 ? `（原本嘗試 ${requestedVariants} 種取向）` : ''}。
        </p>
      )}

      {collapseMessage && (
        <p className="plan-switcher-collapse-note">{collapseMessage}</p>
      )}
    </div>
  );
}
