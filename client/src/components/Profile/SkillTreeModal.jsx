import { X, Award, TrendingUp } from 'lucide-react';

export default function SkillTreeModal({ isOpen, onClose, schedule }) {
  if (!isOpen) return null;

  const calculateLevel = (keyword) => {
    const count = schedule.filter(c => c.name.includes(keyword) || (c.description && c.description.includes(keyword))).length;
    if (count >= 2) return { level: 'Lv.5 / 精通', width: '100%', color: '#10b981' };
    if (count === 1) return { level: 'Lv.4 / 熟練', width: '80%', color: '#3b82f6' };
    return { level: 'Lv.3 / 基礎', width: '60%', color: '#f59e0b' };
  };

  const skills = [
    { name: '資訊與網路安全', category: '核心資安', ...calculateLevel('安全') },
    { name: '程式設計與實作', category: '軟體工程', ...calculateLevel('程式') },
    { name: '資料庫系統', category: '資料科學', ...calculateLevel('資料庫') },
    { name: '人工智慧與機器學習', category: '前瞻科技', ...calculateLevel('人工智慧') },
    { name: '演算法與數學邏輯', category: '理論基礎', ...calculateLevel('微積分') },
  ];

  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh',
      backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1100
    }}>
      <div style={{
        backgroundColor: '#ffffff', width: '600px', maxWidth: '90vw',
        borderRadius: '16px', boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1)', overflow: 'hidden', display: 'flex', flexDirection: 'column'
      }}>
        <div style={{ padding: '20px 24px', borderBottom: '1px solid #e5e7eb', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Award size={22} style={{ color: '#3b82f6' }} />
            <h2 style={{ fontSize: '1.2rem', fontWeight: '700', margin: 0, color: '#1e293b' }}>個人專業技能樹與學習進度</h2>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#6b7280' }}>
            <X size={20} />
          </button>
        </div>

        <div style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '20px', maxHeight: '70vh', overflowY: 'auto' }}>
          <p style={{ fontSize: '0.85rem', color: '#64748b', margin: 0 }}>
            基於歷年修課紀錄與當前排課（共 {schedule.length} 門課）動態生成的學科能力分佈，協助演算法為您推薦最適配的發展方向。
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {skills.map((skill, index) => (
              <div key={index} style={{ padding: '14px', borderRadius: '10px', background: '#f8fafc', border: '1px solid #e2e8f0' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                  <div>
                    <span style={{ fontSize: '0.75rem', fontWeight: '600', color: '#3b82f6', background: '#eff6ff', padding: '2px 8px', borderRadius: '6px' }}>{skill.category}</span>
                    <h4 style={{ fontSize: '0.95rem', fontWeight: '700', margin: '4px 0 0 0', color: '#1e293b' }}>{skill.name}</h4>
                  </div>
                  <span style={{ fontSize: '0.85rem', fontWeight: '600', color: skill.color }}>{skill.level}</span>
                </div>
                <div style={{ width: '100%', height: '8px', backgroundColor: '#e2e8f0', borderRadius: '4px', overflow: 'hidden' }}>
                  <div style={{ width: skill.width, height: '100%', backgroundColor: skill.color, borderRadius: '4px', transition: 'width 0.4s ease' }} />
                </div>
              </div>
            ))}
          </div>

          <div style={{ padding: '14px', borderRadius: '10px', background: '#eff6ff', border: '1px solid #bfdbfe', display: 'flex', alignItems: 'center', gap: '12px' }}>
            <TrendingUp size={24} style={{ color: '#1d4ed8' }} />
            <div style={{ fontSize: '0.85rem', color: '#1e40af' }}>
              <strong>整體能力指數：84 / 100 分</strong><br />
              您的技能分佈偏向實務應用型軟體開發，系統將持續為您推薦具前瞻性的資安與 AI 課程。
            </div>
          </div>
        </div>

        <div style={{ padding: '16px 24px', borderTop: '1px solid #e5e7eb', display: 'flex', justifyContent: 'flex-end', backgroundColor: '#f8fafc' }}>
          <button onClick={onClose} style={{ padding: '8px 16px', borderRadius: '8px', background: '#3b82f6', color: '#fff', border: 'none', fontWeight: '600', cursor: 'pointer' }}>
            關閉視窗
          </button>
        </div>
      </div>
    </div>
  );
}