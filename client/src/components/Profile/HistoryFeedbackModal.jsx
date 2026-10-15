// 協同過濾與 User Embedding 構想階段 5：歷史修課回饋視窗。
//
// 列出使用者已通過的選修、通識、系外選修（必修不列），每門課選「喜歡／普通／不喜歡」。
// 修過不等於喜歡：歷史修課預設只是弱訊號，這裡讓使用者把它換成明確的喜好。
// 回答以 history_course_feedback 事件寫入；伺服器另驗證課號確實在本人修課紀錄中。
//
// mode="initial"：排課主頁自動跳出，只處理還沒回答過的課。「儲存」與「稍後再說」都會把
//   這批課記下來（稍後再說＝全部普通），同一批課不再自動跳出。
// mode="edit"：從個人設定打開，列出全部課，送出有改變的回答與從沒回答過的課。
import { useMemo, useState } from 'react';
import { X } from 'lucide-react';
import { interactionsAPI } from '../../services/api';
import { newUuid } from '../../services/interactionLog';

const OPTIONS = [
  { value: 'liked', label: '喜歡' },
  { value: 'neutral', label: '普通' },
  { value: 'disliked', label: '不喜歡' },
];
const COLLAPSE_THRESHOLD = 15;
const VISIBLE_GROUPS_WHEN_COLLAPSED = 2;
const MAX_EVENTS_PER_REQUEST = 50;

function semesterLabel(group) {
  if (!group.academicYear) return '學期不明';
  return `${group.academicYear} 學年度${group.semester === 2 ? '下' : '上'}學期`;
}

export default function HistoryFeedbackModal({ data, mode = 'initial', onClose, onSaved }) {
  const groups = useMemo(() => (data?.groups ?? [])
    .map(group => ({
      ...group,
      courses: mode === 'initial' ? group.courses.filter(course => course.response === null) : group.courses,
    }))
    .filter(group => group.courses.length > 0), [data, mode]);
  const allCourses = groups.flatMap(group => group.courses);
  const [choices, setChoices] = useState(() => Object.fromEntries(
    allCourses.map(course => [course.courseCode, course.response ?? 'neutral'])
  ));
  const [showAll, setShowAll] = useState(allCourses.length <= COLLAPSE_THRESHOLD);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  if (!data || allCourses.length === 0) return null;
  const visibleGroups = showAll ? groups : groups.slice(0, VISIBLE_GROUPS_WHEN_COLLAPSED);
  const hiddenCount = groups.slice(VISIBLE_GROUPS_WHEN_COLLAPSED).reduce((sum, group) => sum + group.courses.length, 0);

  const submit = async (useNeutralForAll) => {
    // 編輯模式送出有改變的回答，以及從沒回答過的課（維持「普通」也要記下，否則排課主頁會再問一次）。
    const targets = allCourses.filter(course => (
      mode === 'initial'
      || course.response === null
      || (choices[course.courseCode] ?? 'neutral') !== course.response
    ));
    if (targets.length === 0) { onClose(); return; }
    const events = targets.map(course => ({
      eventType: 'history_course_feedback',
      requestId: newUuid(),
      actionId: newUuid(),
      course: { catalogCourseCode: course.courseCode, sectionId: course.sectionId },
      term: data.term,
      source: 'history_review',
      interestFeedback: { response: useNeutralForAll ? 'neutral' : (choices[course.courseCode] ?? 'neutral'), canonicalTagIds: [] },
      versionSnapshot: { recommendationReasonVersion: null },
    }));
    setBusy(true);
    setError('');
    try {
      let saved = 0;
      for (let start = 0; start < events.length; start += MAX_EVENTS_PER_REQUEST) {
        const result = await interactionsAPI.record(events.slice(start, start + MAX_EVENTS_PER_REQUEST));
        if (!result.recorded) throw new Error('個人化學習同意狀態已變更，回答沒有保存。');
        const failed = (result.results ?? []).filter(item => ['rejected', 'conflict'].includes(item.status));
        if (failed.length > 0) throw new Error(failed[0].errors?.join('；') || '部分回答未能保存，請重試。');
        saved += result.results?.length ?? 0;
      }
      onSaved?.({ saved, skipped: useNeutralForAll });
      onClose();
    } catch (err) {
      setError(err.message || '回答保存失敗，請稍後再試。');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="history-feedback-backdrop" role="dialog" aria-modal="true" aria-labelledby="history-feedback-title">
      <div className="history-feedback-dialog">
        <div className="history-feedback-header">
          <div>
            <h3 id="history-feedback-title">你修過的這些課，覺得如何？</h3>
            <p>你的回答會用來推薦主題相近的選修與通識，必修不受影響。之後可以到「個人資料設定」的「我修過的課」修改。</p>
          </div>
          <button type="button" className="history-feedback-close" aria-label="關閉" onClick={onClose} disabled={busy}>
            <X size={18} />
          </button>
        </div>

        <div className="history-feedback-body">
          {visibleGroups.map(group => (
            <section key={`${group.academicYear}-${group.semester}`} className="history-feedback-group">
              <h4>{semesterLabel(group)}</h4>
              {group.courses.map(course => (
                <div key={course.courseCode} className="history-feedback-row">
                  <span className="history-feedback-name">{course.name}</span>
                  <div className="history-feedback-options" role="radiogroup" aria-label={`${course.name} 的喜好`}>
                    {OPTIONS.map(option => (
                      <button
                        key={option.value}
                        type="button"
                        role="radio"
                        aria-checked={choices[course.courseCode] === option.value}
                        className={`history-feedback-option${choices[course.courseCode] === option.value ? ' active' : ''} ${option.value}`}
                        onClick={() => setChoices(prev => ({ ...prev, [course.courseCode]: option.value }))}
                        disabled={busy}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </section>
          ))}
          {!showAll && hiddenCount > 0 && (
            <button type="button" className="history-feedback-more" onClick={() => setShowAll(true)}>
              顯示更早的課（{hiddenCount} 門）
            </button>
          )}
          {error && <div className="search-action-notice error">{error}</div>}
        </div>

        <div className="history-feedback-footer">
          {mode === 'initial' ? (
            <button type="button" className="course-card-action" onClick={() => submit(true)} disabled={busy}>
              稍後再說（全部當作普通）
            </button>
          ) : (
            <button type="button" className="course-card-action" onClick={onClose} disabled={busy}>取消</button>
          )}
          <button type="button" className="course-card-action primary" onClick={() => submit(false)} disabled={busy}>
            {busy ? '儲存中…' : '儲存'}
          </button>
        </div>
      </div>
    </div>
  );
}
