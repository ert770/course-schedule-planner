import { Sparkles } from 'lucide-react';

export default function PlanSwitcher({ plans, selectedPlanId, recommendedPlanId, onSelectPlan }) {
  // 如果沒有方案，或只有 1 個方案，就不需要顯示切換器
  if (!plans || plans.length <= 1) return null;

  return (
    <div style={{ display: 'flex', justifyContent: 'center', margin: '12px 0 20px 0' }}>
      <div 
        style={{
          display: 'inline-flex',
          background: '#f8fafc', // 非常淡的灰底
          padding: '6px',
          borderRadius: '999px', // 完美的膠囊圓角
          gap: '4px',
          border: '1px solid #e2e8f0',
          boxShadow: 'inset 0 1px 2px rgba(0, 0, 0, 0.02)'
        }}
      >
        {plans.map(plan => {
          const isSelected = plan.id === selectedPlanId;
          // 判斷是否為主推方案
          const isRecommended = plan.planId === recommendedPlanId;

          return (
            <button
              key={plan.id}
              onClick={() => onSelectPlan(plan.id)}
              style={{
                padding: '8px 20px',
                borderRadius: '999px',
                border: 'none',
                background: isSelected ? '#ffffff' : 'transparent',
                color: isSelected ? '#3b82f6' : '#64748b',
                fontWeight: isSelected ? '700' : '500',
                fontSize: '0.9rem',
                cursor: 'pointer',
                boxShadow: isSelected ? '0 2px 8px rgba(0, 0, 0, 0.08)' : 'none',
                transition: 'all 0.2s ease',
                display: 'flex',
                alignItems: 'center',
                gap: '6px'
              }}
              onMouseOver={(e) => { if (!isSelected) e.currentTarget.style.color = '#3b82f6' }}
              onMouseOut={(e) => { if (!isSelected) e.currentTarget.style.color = '#64748b' }}
              title={isRecommended ? '系統綜合評估的主推方案' : `切換至${plan.title}`}
            >
              {/* 如果是主推方案，加上一個精緻的星星小圖示 */}
              {isRecommended && (
                <Sparkles 
                  size={16} 
                  style={{ 
                    color: isSelected ? '#3b82f6' : '#fbbf24',
                    transition: 'color 0.2s ease'
                  }} 
                />
              )}
              {plan.title}
            </button>
          );
        })}
      </div>
    </div>
  );
}