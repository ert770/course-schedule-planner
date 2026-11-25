import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, Heart, Plus, X } from 'lucide-react';
import { useSchedule } from '../../contexts/useSchedule';
import RemoveReasonDialog from '../Schedule/RemoveReasonDialog';

const WatchActionContext = createContext(null);
const BUTTON_FEEDBACK_MS = 1400;
const INLINE_FEEDBACK_MS = 3000;
const INLINE_FEEDBACK_FADE_MS = 200;

export function CourseActionsProvider({ children }) {
  const { toggleWatchlist } = useSchedule();
  const pendingRef = useRef(false);
  const [watchingId, setWatchingId] = useState(null);

  const updateWatchlist = async (course, id) => {
    if (pendingRef.current) return null;
    pendingRef.current = true;
    setWatchingId(id);
    try {
      return await toggleWatchlist(course);
    } finally {
      pendingRef.current = false;
      setWatchingId(null);
    }
  };

  return <WatchActionContext.Provider value={{ watchingId, updateWatchlist }}>{children}</WatchActionContext.Provider>;
}

export default function CourseActions({ course, source }) {
  const { schedule, watchlist, validating, addCourse, removeCourse, personalizationEnabled } = useSchedule();
  const { watchingId, updateWatchlist } = useContext(WatchActionContext);
  const [feedback, setFeedback] = useState({});
  const [showRemoval, setShowRemoval] = useState(false);
  const [adding, setAdding] = useState(false);
  const timers = useRef(new Map());
  const id = String(course.id ?? course.sectionId);
  const watched = watchlist.includes(id);
  const added = schedule.some(item => String(item.id ?? item.sectionId) === id);
  const justAdded = added && feedback.selection?.type === 'added';

  useEffect(() => {
    const activeTimers = timers.current;
    return () => activeTimers.forEach(timer => clearTimeout(timer));
  }, []);

  const showFeedback = (action, next) => {
    clearTimeout(timers.current.get(action));
    timers.current.delete(action);
    setFeedback(current => ({ ...current, [action]: next }));
    if (!next) return;

    const clearFeedback = () => {
      timers.current.delete(action);
      setFeedback(current => ({ ...current, [action]: null }));
    };
    if (next.text) {
      timers.current.set(action, setTimeout(() => {
        setFeedback(current => ({ ...current, [action]: { ...next, fading: true } }));
        timers.current.set(action, setTimeout(clearFeedback, INLINE_FEEDBACK_FADE_MS));
      }, INLINE_FEEDBACK_MS));
    } else {
      timers.current.set(action, setTimeout(clearFeedback, BUTTON_FEEDBACK_MS));
    }
  };

  const handleWatch = async event => {
    event.stopPropagation();
    showFeedback('watch', null);
    const result = await updateWatchlist(course, id);
    if (!result) return;
    showFeedback('watch', result.success
      ? (result.watching ? { type: 'watched' } : null)
      : { type: 'error', text: result.message || '無法更新關注。' });
  };

  const handleSelection = async event => {
    event.stopPropagation();
    if (added) {
      setShowRemoval(true);
      return;
    }

    showFeedback('selection', null);
    setAdding(true);
    try {
      const result = await addCourse(course, { source });
      showFeedback('selection', result.success ? { type: 'added' } : { type: 'error', text: result.message || '無法加入課表。' });
    } finally {
      setAdding(false);
    }
  };

  const confirmRemoval = async feedbackReason => {
    const result = await removeCourse(id, { feedbackReason });
    if (result.success) {
      setShowRemoval(false);
      showFeedback('selection', { type: 'removed', text: '已從課表移除並避開。' });
    }
    return result;
  };

  return (
    <div className="course-actions">
      <div className="course-card-actions">
        <button type="button" className={`course-card-action course-watch-action${watched ? ' active' : ''}`}
          aria-pressed={watched} onClick={handleWatch} disabled={watchingId !== null}>
          <Heart aria-hidden="true" size={15} fill={watched ? 'currentColor' : 'none'}
            className={watched && feedback.watch?.type === 'watched' ? 'course-action-pop' : undefined} />
          {watchingId === id ? '更新中…' : watched ? '已關注' : '關注'}
        </button>
        <button type="button" className={`course-card-action ${justAdded ? 'course-added-action' : added ? 'danger' : 'primary'}`}
          aria-label={justAdded ? '已加入，取消加選' : undefined}
          onClick={handleSelection} disabled={adding || (validating && !added)}>
          {justAdded ? <><Check size={15} aria-hidden="true" className="course-action-pop" /><span role="status">已加入</span></>
            : added ? <><X size={15} aria-hidden="true" /> 取消加選</>
              : <><Plus size={15} aria-hidden="true" /> {adding ? '驗證中…' : '加入課表'}</>}
        </button>
      </div>
      {Object.entries(feedback).filter(([, item]) => item?.text).map(([action, item]) => (
        <p key={action} className={`course-action-feedback ${item.type}${item.fading ? ' fading' : ''}`}
          style={{ '--course-feedback-fade-duration': `${INLINE_FEEDBACK_FADE_MS}ms` }}
          role={item.type === 'error' ? 'alert' : 'status'}>
          {item.text}
        </p>
      ))}
      {showRemoval && createPortal(
        <div onClick={event => event.stopPropagation()}>
          <RemoveReasonDialog course={course} collectReason={personalizationEnabled}
            onCancel={() => setShowRemoval(false)} onConfirm={confirmRemoval} />
        </div>,
        document.body
      )}
    </div>
  );
}
