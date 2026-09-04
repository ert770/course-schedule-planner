import { useMemo, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { scheduleAPI } from '../../services/api';

// Roadmap #27：逐項比較 + counterfactual（「取消這個偏好會怎樣」）。
//
// **界線**：demo 帳號實測今天的 2 個方案在課數、學分、天數、早八、空堂、
// 偏好符合度、評價涵蓋率上**全部相同**，只差 2 門課；counterfactual 的答案
// 目前也全部是「不會改變」。這個元件的職責就是把這個事實講清楚——比較表
// 排出六個一樣的數字看起來豐富，實際上什麼也沒告訴使用者，那是裝飾。
// 有差異的項目才強調，沒差異的收起來，而且要一句話講出「哪幾項完全相同」。

const METRICS = [
  { key: 'scheduledCourseCount', label: '課數', path: m => m.scheduledCourseCount },
  { key: 'totalCredits', label: '學分', path: m => m.totalCredits },
  { key: 'usedDays', label: '上課天數', path: m => m.usedDays },
  { key: 'morningCourses', label: '早八課', path: m => m.morningCourses },
  { key: 'gapPeriods', label: '空堂節數', path: m => m.gapPeriods },
  { key: 'preferenceScore', label: '偏好符合度', path: m => m.preferenceScore, format: v => (v == null ? '—' : `${Math.round(v * 100)}%`) },
  { key: 'reviewRatio', label: '評價涵蓋率', path: m => m.reviewCoverage?.ratio ?? null, format: v => (v == null ? '—' : `${Math.round(v * 100)}%`) },
];

function courseKey(course) {
  return String(course.sectionId ?? course.id);
}

// 兩個方案的課程集合差異——只比課程集合，不比排序，與後端 `uniquePlans()`
// 判斷「兩個方案是否相同」用的是同一個標準。
function diffCourses(baseCourses, otherCourses) {
  const baseIds = new Set(baseCourses.map(courseKey));
  const otherIds = new Set(otherCourses.map(courseKey));
  return {
    removed: baseCourses.filter(c => !otherIds.has(courseKey(c))),
    added: otherCourses.filter(c => !baseIds.has(courseKey(c))),
  };
}

function valuesEqual(values) {
  const rounded = values.map(v => (typeof v === 'number' ? Number(v.toFixed(4)) : v));
  return new Set(rounded.map(v => JSON.stringify(v))).size <= 1;
}

const CF_STATUS_TEXT = {
  changed: null, // 用 removed/added 直接呈現，不需要額外文字
  unchanged: '取消這個偏好，課表不會改變',
  'not-applicable': '你目前沒有開啟這項偏好',
};

export default function PlanComparison({ plans = [], constraints = {}, courseIds = [], filters = {}, surface }) {
  const [showCounterfactual, setShowCounterfactual] = useState(false);
  const [cfState, setCfState] = useState({ status: 'idle', data: null, error: null });

  const comparableRows = useMemo(() => {
    if (plans.length < 2) return [];
    return METRICS.map(metric => {
      const values = plans.map(plan => metric.path(plan.planMetrics || {}));
      return { ...metric, values, identical: valuesEqual(values) };
    });
  }, [plans]);

  const differingRows = comparableRows.filter(row => !row.identical);
  const identicalRows = comparableRows.filter(row => row.identical);

  const courseDiffs = useMemo(() => {
    if (plans.length < 2) return [];
    const base = plans[0];
    return plans.slice(1).map(plan => ({
      plan,
      diff: diffCourses(base.schedule, plan.schedule),
    }));
  }, [plans]);

  if (plans.length < 2) return null;

  async function loadCounterfactual() {
    setShowCounterfactual(true);
    if (cfState.status === 'success' || cfState.status === 'loading') return;
    setCfState({ status: 'loading', data: null, error: null });
    try {
      const data = await scheduleAPI.counterfactual({ courseIds, filters, constraints, surface });
      setCfState({ status: 'success', data, error: null });
    } catch (err) {
      setCfState({ status: 'error', data: null, error: err.message });
    }
  }

  return (
    <div className="plan-comparison" id="plan-comparison">
      <h3 className="plan-comparison-title">方案比較</h3>

      {differingRows.length === 0 ? (
        <p className="plan-comparison-summary">
          這 {plans.length} 個方案在課數、學分、上課天數、早八、空堂、偏好符合度、
          評價涵蓋率上<strong>完全相同</strong>，差別只在課程本身。
        </p>
      ) : (
        <>
          {identicalRows.length > 0 && (
            <p className="plan-comparison-summary">
              {identicalRows.map(row => row.label).join('、')}在各方案間相同；
              真正有差異的項目如下：
            </p>
          )}
          <div className="plan-comparison-table-wrapper">
            <table className="plan-comparison-table">
              <thead>
                <tr>
                  <th>項目</th>
                  {plans.map(plan => <th key={plan.id}>{plan.title}</th>)}
                </tr>
              </thead>
              <tbody>
                {differingRows.map(row => (
                  <tr key={row.key}>
                    <td>{row.label}</td>
                    {row.values.map((v, i) => (
                      <td key={plans[i].id}>{row.format ? row.format(v) : v}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <div className="plan-comparison-course-diffs">
        {courseDiffs.map(({ plan, diff }) => (
          (diff.added.length > 0 || diff.removed.length > 0) && (
            <p key={plan.id} className="plan-comparison-course-diff">
              <strong>{plan.title}</strong> 相對主推方案：
              {diff.removed.length > 0 && (
                <span className="plan-comparison-diff-removed">
                  {' '}少了 {diff.removed.map(c => c.name).join('、')}
                </span>
              )}
              {diff.added.length > 0 && (
                <span className="plan-comparison-diff-added">
                  {' '}多了 {diff.added.map(c => c.name).join('、')}
                </span>
              )}
            </p>
          )
        ))}
      </div>

      {!showCounterfactual ? (
        <button type="button" className="action-btn secondary plan-comparison-cf-toggle" onClick={loadCounterfactual}>
          如果取消某個偏好，課表會怎麼變？
        </button>
      ) : (
        <div className="plan-comparison-counterfactual" id="plan-counterfactual">
          {cfState.status === 'loading' && (
            <p className="plan-comparison-cf-loading"><Loader2 size={14} className="spin-animation" /> 計算中...</p>
          )}
          {cfState.status === 'error' && (
            <p className="plan-comparison-cf-error">無法計算：{cfState.error}</p>
          )}
          {cfState.status === 'success' && (
            <ul className="plan-comparison-cf-list">
              {cfState.data.counterfactuals.map(item => (
                <li key={item.preferenceId} className={`plan-comparison-cf-item cf-${item.status}`}>
                  <strong>{item.label}</strong>
                  {item.status === 'changed' ? (
                    <span>
                      {item.removed.length > 0 && ` 少了 ${item.removed.map(c => c.name).join('、')}`}
                      {item.added.length > 0 && ` 多了 ${item.added.map(c => c.name).join('、')}`}
                    </span>
                  ) : (
                    <span> {CF_STATUS_TEXT[item.status]}{item.reason ? `——${item.reason}` : ''}</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
