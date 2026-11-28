import { useEffect, useState } from 'react';
import { scheduleAPI } from '../../services/api';

const courseId = course => String(course?.id ?? course?.sectionId ?? '');

// 課程格的「備選」：列出可以直接換上的課（只顯示課名，依排課分數排序），點一下就換。
export default function AlternativesDialog({ course, schedule, onSwap, onClose }) {
  const [state, setState] = useState({ loading: true, alternatives: [], error: '' });
  const [swapping, setSwapping] = useState(null);
  const currentIds = schedule.map(courseId).join(',');
  const sectionId = courseId(course);

  useEffect(() => {
    let cancelled = false;
    scheduleAPI.alternatives(sectionId, currentIds)
      .then(data => {
        if (!cancelled) setState({ loading: false, alternatives: data.alternatives ?? [], error: '' });
      })
      .catch(err => {
        if (!cancelled) setState({ loading: false, alternatives: [], error: err.message || '無法查詢備選課程。' });
      });
    return () => { cancelled = true; };
    // 只在打開時查一次；換課成功後視窗就關閉。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sectionId]);

  const choose = async item => {
    setSwapping(item.sectionId);
    const result = await onSwap({ removeSectionId: Number(sectionId), addCourse: item.course });
    setSwapping(null);
    if (result?.success) onClose();
    else setState(current => ({ ...current, error: result?.message || '換課失敗，課表沒有更動。' }));
  };

  return (
    <div className="alternatives-overlay" role="presentation" onClick={onClose}>
      <div className="alternatives-dialog" role="dialog" aria-modal="true" aria-label={`${course.name}的備選課程`}
        onClick={event => event.stopPropagation()}>
        <div className="alternatives-header">
          <h3>「{course.name}」的備選</h3>
          <button type="button" className="alternatives-close" aria-label="關閉" onClick={onClose}>✕</button>
        </div>
        {state.error && <p className="error-text" role="alert">{state.error}</p>}
        {state.loading && <p role="status">正在查詢可以替換的課程…</p>}
        {!state.loading && !state.error && state.alternatives.length === 0 && (
          <p>目前沒有可以直接替換的課程。</p>
        )}
        <ul className="alternatives-list">
          {state.alternatives.map(item => (
            <li key={item.sectionId}>
              <button type="button" disabled={swapping !== null} onClick={() => choose(item)}>
                {swapping === item.sectionId ? '替換中…' : item.name}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
