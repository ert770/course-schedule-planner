import { X, Award } from 'lucide-react';

const SKILLS = [
  { name: '資訊與網路安全', category: '核心資安', keyword: '安全' },
  { name: '程式設計與實作', category: '軟體工程', keyword: '程式' },
  { name: '資料庫系統', category: '資料科學', keyword: '資料庫' },
  { name: '人工智慧與機器學習', category: '前瞻科技', keyword: '人工智慧' },
  { name: '演算法與數學邏輯', category: '理論基礎', keyword: '微積分' },
];

function findMatchingCourses(schedule, keyword) {
  return (Array.isArray(schedule) ? schedule : []).filter(course => {
    const text = String(course?.name || '') + ' ' + String(course?.description || '');
    return text.includes(keyword);
  });
}

export default function SkillTreeModal({ isOpen, onClose, schedule }) {
  if (!isOpen) return null;

  return (
    <div role="presentation" onClick={onClose} style={{
      position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh',
      backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1100
    }}>
      <div role="dialog" aria-modal="true" aria-labelledby="skill-tree-title" onClick={event => event.stopPropagation()} style={{
        backgroundColor: '#ffffff', width: '600px', maxWidth: '90vw',
        borderRadius: '16px', boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1)', overflow: 'hidden', display: 'flex', flexDirection: 'column'
      }}>
        <div style={{ padding: '20px 24px', borderBottom: '1px solid #e5e7eb', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Award size={22} style={{ color: '#3b82f6' }} />
            <h2 id="skill-tree-title" style={{ fontSize: '1.2rem', fontWeight: '700', margin: 0, color: '#1e293b' }}>本學期課表中的課程主題</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="關閉" style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#6b7280' }}>
            <X size={20} />
          </button>
        </div>

        <div style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '16px', maxHeight: '70vh', overflowY: 'auto' }}>
          <p style={{ fontSize: '0.85rem', color: '#64748b', margin: 0, lineHeight: '1.5' }}>
            以下只依目前課表的課名與課程說明比對關鍵字，不代表能力程度，也不包含歷年修課成績。
          </p>

          {SKILLS.map(skill => {
            const matches = findMatchingCourses(schedule, skill.keyword);
            return (
              <section key={skill.keyword} style={{ padding: '14px', borderRadius: '10px', background: '#f8fafc', border: '1px solid #e2e8f0' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', alignItems: 'center', marginBottom: '8px' }}>
                  <div>
                    <span style={{ fontSize: '0.75rem', fontWeight: '600', color: '#3b82f6', background: '#eff6ff', padding: '2px 8px', borderRadius: '6px' }}>{skill.category}</span>
                    <h3 style={{ fontSize: '0.95rem', fontWeight: '700', margin: '6px 0 0', color: '#1e293b' }}>{skill.name}</h3>
                  </div>
                  <span style={{ fontSize: '0.85rem', fontWeight: '600', color: '#334155', whiteSpace: 'nowrap' }}>{matches.length} 門命中</span>
                </div>
                {matches.length > 0 ? (
                  <ul style={{ margin: '8px 0 0', paddingLeft: '22px', color: '#475569', fontSize: '0.85rem', lineHeight: '1.6' }}>
                    {matches.map(course => <li key={course.id || course.code || course.name}>{course.name}</li>)}
                  </ul>
                ) : (
                  <p style={{ margin: '8px 0 0', color: '#64748b', fontSize: '0.85rem' }}>目前課表沒有符合「{skill.keyword}」的課程名稱或說明。</p>
                )}
              </section>
            );
          })}
        </div>

        <div style={{ padding: '16px 24px', borderTop: '1px solid #e5e7eb', display: 'flex', justifyContent: 'flex-end', backgroundColor: '#f8fafc' }}>
          <button type="button" onClick={onClose} style={{ padding: '8px 16px', borderRadius: '8px', background: '#3b82f6', color: '#fff', border: 'none', fontWeight: '600', cursor: 'pointer' }}>
            關閉視窗
          </button>
        </div>
      </div>
    </div>
  );
}