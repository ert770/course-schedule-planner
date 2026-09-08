// Roadmap #27：方案切換列。
//
// 後端 `generateSchedule()` 一直都算出全部方案（`result.plans`），先前前端只
// 讀 `plans[0]` 的 `planId`，其餘方案的課表、標題、偏好符合度全部被丟棄——
// 使用者因此完全不知道系統其實排了「涼課與高分優先」等其他取向。這裡把
// 被丟棄的東西找回來。

function describeCollapse(diversity) {
  if (!diversity || diversity.collapsed.length === 0) return null;
  const titles = diversity.collapsed.map(item => item.title).join('、');
  return `${titles}排出的課表與其他方案相同，已合併，目前提供 `
    + `${diversity.distinctPlans} 種方案。可競爭的課程共 ${diversity.competablePoolSize} 門。`
    + (diversity.reason === 'same-course-combination'
      ? '本次調整取捨仍得到相同組合，不能僅憑重複結果判定是候選池不足。'
      : '這些取向未產生不同的課程組合。');
}

export default function PlanSwitcher({ plans = [], selectedPlanId, planDiversity, onSelectPlan }) {
  // 沒有方案資料（例如從已存課表載回，不屬於任何一次推薦）時不顯示——
  // 沒有東西可以切換。
  if (!Array.isArray(plans) || plans.length === 0) return null;

  const collapseMessage = describeCollapse(planDiversity);
  const requestedVariants = planDiversity?.requestedVariants ?? plans.length;

  return (
    <div className="plan-switcher" id="plan-switcher">
      {plans.length > 1 ? (
        <div className="plan-switcher-tabs" role="tablist" aria-label="排課方案">
          {plans.map((plan, index) => (
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
                {index === 0 ? '（主推）' : ''}
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
