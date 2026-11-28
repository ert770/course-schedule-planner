import { useEffect, useState } from 'react';
import { authAPI } from '../../services/api';

const GRADE_CHAR = { 1: '一', 2: '二', 3: '三', 4: '四', 5: '五' };

// 修改系所、年級、班級。選項與班級組法與註冊頁相同，後端以同一套規則檢查
// （server/src/data/studentScopeValidation.js）。
export default function StudentScopeEditor({ initial, onApply, onCancel }) {
  const [options, setOptions] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [draft, setDraft] = useState({ department: initial.department, gradeLevel: initial.gradeLevel, prefix: '', suffix: '' });

  useEffect(() => {
    let active = true;
    authAPI.registerOptions()
      .then(data => {
        if (!active) return;
        setOptions(data);
        // 目前的班級若是「簡稱＋年級＋甲～丁」，帶入簡稱與班別，只改其中一項時不必全部重選。
        const prefixes = data.abbreviations?.[initial.department] ?? [];
        const match = /^(.+)[一二三四五]([甲乙丙丁])$/.exec(initial.className || '');
        const known = match && prefixes.includes(match[1]);
        setDraft(prev => ({
          ...prev,
          prefix: known ? match[1] : (prefixes.length === 1 ? prefixes[0] : ''),
          suffix: known ? match[2] : '',
        }));
      })
      .catch(() => { if (active) setLoadError('無法載入系所選項，請稍後再試。'); });
    return () => { active = false; };
  }, [initial.department, initial.className]);

  const prefixes = options?.abbreviations?.[draft.department] ?? [];
  const suffixes = draft.gradeLevel === '1' ? ['甲', '乙', '丙'] : ['甲', '乙', '丙', '丁'];
  const gradeChar = GRADE_CHAR[draft.gradeLevel];
  const className = draft.prefix && gradeChar && draft.suffix ? draft.prefix + gradeChar + draft.suffix : '';

  const changeDepartment = (department) => {
    const next = options?.abbreviations?.[department] ?? [];
    setDraft(prev => ({ ...prev, department, prefix: next.length === 1 ? next[0] : '', suffix: '' }));
  };
  const changeGrade = (gradeLevel) => setDraft(prev => ({
    ...prev, gradeLevel, suffix: gradeLevel === '1' && prev.suffix === '丁' ? '' : prev.suffix,
  }));

  if (loadError) return <p className="schedule-notice error" role="alert">{loadError}</p>;
  if (!options) return <p role="status">正在載入系所選項…</p>;

  return (
    <div className="setup-scope-editor" style={{ display: 'grid', gap: '12px', marginTop: '12px' }}>
      <label className="setup-scope-field" style={{ display: 'grid', gap: '4px', fontSize: '0.85rem' }}>系所
        <select className="input-field" value={draft.department} onChange={e => changeDepartment(e.target.value)}>
          <option value="">請選擇系所</option>
          {options.departments.map(item => <option key={item}>{item}</option>)}
        </select>
      </label>
      <label className="setup-scope-field" style={{ display: 'grid', gap: '4px', fontSize: '0.85rem' }}>年級
        <select className="input-field" value={draft.gradeLevel} onChange={e => changeGrade(e.target.value)}>
          <option value="">請選擇年級</option>
          {[1, 2, 3, 4, 5].map(grade => <option key={grade} value={String(grade)}>{grade} 年級</option>)}
        </select>
      </label>
      {prefixes.length > 1 && (
        <label className="setup-scope-field" style={{ display: 'grid', gap: '4px', fontSize: '0.85rem' }}>班級系所簡稱
          <select className="input-field" value={draft.prefix} onChange={e => setDraft(prev => ({ ...prev, prefix: e.target.value, suffix: '' }))}>
            <option value="">請選擇班級系所簡稱</option>
            {prefixes.map(item => <option key={item} value={item}>{item}</option>)}
          </select>
        </label>
      )}
      <label className="setup-scope-field" style={{ display: 'grid', gap: '4px', fontSize: '0.85rem' }}>班級
        <select className="input-field" value={draft.suffix} disabled={!draft.prefix || !gradeChar}
          onChange={e => setDraft(prev => ({ ...prev, suffix: e.target.value }))}>
          <option value="">請選擇班級</option>
          {suffixes.map(item => <option key={item} value={item}>{draft.prefix}{gradeChar}{item}</option>)}
        </select>
      </label>
      <div style={{ display: 'flex', gap: '8px' }}>
        <button type="button" className="course-card-action primary" disabled={!draft.department || !className}
          onClick={() => onApply({ department: draft.department, gradeLevel: draft.gradeLevel, className })}>
          套用
        </button>
        <button type="button" className="course-card-action" onClick={onCancel}>取消</button>
      </div>
    </div>
  );
}
