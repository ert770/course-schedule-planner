import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, BookOpenCheck, Check, Loader2 } from 'lucide-react';
import PreferenceJourneySteps, { PreferenceBackButton } from '../components/Layout/PreferenceJourneySteps';
import { useAuth } from '../contexts/useAuth';
import { getUserIdentity } from '../utils/userIdentity';
import { interactionsAPI, interestExplorationAPI } from '../services/api';
import {
  getInterestExplorationState,
  saveInterestExplorationState,
} from '../services/interestExplorationState';
import { hasPersonalizationConsent, newUuid } from '../services/interactionLog';
import './InterestExplorationPage.css';

// 建立英文標籤到中文的翻譯字典
const tagTranslationDict = {
  'Imperative languages': '指令式語言',
  'Functional languages': '函數式語言',
  'Logical languages': '邏輯式語言',
  'Object-Oriented languages': '物件導向語言',
  'Object-Oriented': '物件導向',
  'Programming Languages': '程式語言',
  'Algorithms': '演算法',
  'Data Structures': '資料結構',
  'Machine Learning': '機器學習',
  'Deep Learning': '深度學習',
  'Artificial Intelligence': '人工智慧',
  'Cloud Computing': '雲端運算',
  'Cybersecurity': '資訊安全',
  'Software Engineering': '軟體工程',
  'Computer Networks': '電腦網路',
  'Database Systems': '資料庫系統',
  'Operating Systems': '作業系統',
  'Web Development': '網頁開發'
};

const translateTag = (tagName) => {
  return tagTranslationDict[tagName] || tagName;
};

function CourseChoice({ card, selected, disabled, onClick }) {
  return (
    <button type="button" className={`interest-course-card${selected ? ' selected' : ''}`}
      aria-pressed={selected} disabled={disabled} onClick={onClick}>
      <span className="interest-course-card-topline">
        <span>{card.category || '選修課程'}</span>
        <span className="interest-course-check" aria-hidden="true">{selected && <Check size={16} />}</span>
      </span>
      <strong className="interest-course-name">{card.name}</strong>
      {card.description && <span className="interest-course-description">{card.description}</span>}
      <span className="interest-course-tags">
        {card.representativeTags.map(tag => (
          <span className="interest-course-tag" key={tag.canonicalTagId}>{translateTag(tag.canonicalName)}</span>
        ))}
      </span>
    </button>
  );
}

function feedbackEvent(card, pending) {
  return {
    eventType: 'interest_exploration_feedback',
    requestId: pending.requestId,
    actionId: pending.actions[card.courseCode],
    course: { catalogCourseCode: card.courseCode, sectionId: card.sectionId },
    term: card.term,
    source: 'exploration',
    interestFeedback: {
      response: 'paired_interested',
      canonicalTagIds: card.representativeTags.map(tag => tag.canonicalTagId),
    },
    versionSnapshot: { recommendationReasonVersion: null },
  };
}

export default function InterestExplorationPage() {
  const navigate = useNavigate();
  const { user, privacyStatus } = useAuth();
  const identity = getUserIdentity(user);
  const consented = hasPersonalizationConsent(privacyStatus);
  const [pairs, setPairs] = useState([]);
  const [targetTerm, setTargetTerm] = useState(null);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [selected, setSelected] = useState([]);
  const [pending, setPending] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [loadFailed, setLoadFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const submitting = useRef(false);

  useEffect(() => {
    let cancelled = false;
    interestExplorationAPI.getCards()
      .then(result => {
        if (cancelled) return;
        const saved = getInterestExplorationState(identity);
        if (saved.status === 'completed' || saved.status === 'skipped') {
          navigate('/', { replace: true });
          return;
        }
        const term = result.term ?? null;
        const termKey = term ? `${term.academicYear}:${term.semester}` : '';
        // Keep the shown course pairs stable even when feedback changes the candidate ranking.
        const resume = termKey && termKey === saved.termKey && saved.pairs.length > 0;
        const deck = resume ? saved.pairs : (result.pairs ?? []);
        const index = resume ? Math.min(saved.currentIndex, deck.length) : 0;
        const recovery = resume ? saved.pending : null;
        setPairs(deck);
        setTargetTerm(term);
        setCurrentIndex(index);
        setPending(recovery);
        setSelected(Object.keys(recovery?.actions ?? {}));
        saveInterestExplorationState(identity, {
          status: 'in_progress', termKey, pairs: deck, currentIndex: index, pending: recovery,
        });
      })
      .catch(() => { if (!cancelled) setLoadFailed(true); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [identity, navigate, loadAttempt]);

  const pair = pairs[currentIndex];

  const finish = status => {
    saveInterestExplorationState(identity, { status, pending: null });
    navigate('/', { replace: true });
  };

  const advance = (nextNotice = '') => {
    const nextIndex = currentIndex + 1;
    const complete = nextIndex >= pairs.length;
    saveInterestExplorationState(identity, {
      status: complete ? 'completed' : 'in_progress', currentIndex: nextIndex, pending: null,
    });
    if (complete) {
      navigate('/', { replace: true });
      return;
    }
    setCurrentIndex(nextIndex);
    setSelected([]);
    setPending(null);
    setError('');
    setNotice(nextNotice);
  };

  const submitSelection = async () => {
    if (!pair || selected.length === 0 || submitting.current) return;
    if (!consented) {
      advance();
      return;
    }
    const chosen = pair.filter(card => selected.includes(card.courseCode));
    if (chosen.length === 0) return;
    const batch = pending ?? {
      requestId: newUuid(),
      actions: Object.fromEntries(chosen.map(card => [card.courseCode, newUuid()])),
    };
    // Persist the IDs before sending so retries after a partial response or reload use the same IDs.
    saveInterestExplorationState(identity, { pending: batch });
    setPending(batch);
    submitting.current = true;
    setBusy(true);
    setError('');
    try {
      const events = chosen.map(card => feedbackEvent(card, batch));
      const result = await interactionsAPI.record(events);
      if (result.recorded === false) {
        advance('這題的回饋沒有保存。');
        return;
      }
      for (const event of events) {
        const outcome = result.results?.find(item => item.actionId === event.actionId);
        if (!outcome || !['append', 'duplicate'].includes(outcome.status)) {
          throw new Error(outcome?.errors?.join('；') || '回饋未能保存。');
        }
      }
      advance();
    } catch (err) {
      setError(`${err.message || '回饋保存失敗。'} 請重試。已保存的選擇不會重複計分。`);
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  };

  const toggle = courseCode => setSelected(previous => previous.includes(courseCode)
    ? previous.filter(code => code !== courseCode) : [...previous, courseCode]);

  if (loading) {
    return <main className="interest-exploration-page"><div className="interest-exploration-loading"><Loader2 className="spin-animation" />正在準備探索課程…</div></main>;
  }

  return (
    <main className="interest-exploration-page">
      <section className="interest-exploration-shell" aria-labelledby="interest-exploration-title">
        <PreferenceBackButton onClick={() => { if (!busy) navigate('/setup'); }}>返回偏好設定</PreferenceBackButton>
        <PreferenceJourneySteps current={3} exploration />
        <header className="preference-page-header">
          <h1 id="interest-exploration-title">探索你可能想修的課</h1>
          <p>點選你想接觸的課程內容。每題可以選一張、兩張，或先略過。</p>
          {targetTerm && <p className="interest-exploration-term">探索學期：{targetTerm.academicYear} 學年度{targetTerm.semester}</p>}
        </header>

        {!consented && (
          <div className="interest-exploration-consent" role="status">
            你尚未同意「個人化學習」。你仍可完成探索，這次的選擇不會寫入興趣檔案。
          </div>
        )}
        {error && <div className="interest-exploration-error" role="alert">{error}</div>}
        {notice && <div className="interest-exploration-notice" role="status">{notice}</div>}

        {loadFailed ? (
          <section className="interest-exploration-empty" aria-labelledby="interest-load-error">
            <h2 id="interest-load-error">目前無法載入探索課程</h2>
            <p>你可以重新載入，或直接前往課表。</p>
            <button type="button" className="interest-button positive" onClick={() => {
              setLoadFailed(false);
              setLoading(true);
              setLoadAttempt(previous => previous + 1);
            }}>重新載入</button>
          </section>
        ) : pair ? (
          <>
            <div className="interest-exploration-progress" aria-label={`第 ${currentIndex + 1} 題，共 ${pairs.length} 題`}>
              <div><span>探索進度</span><strong>{currentIndex + 1} / {pairs.length}</strong></div>
              <div className="interest-exploration-progress-track"><span style={{ width: `${((currentIndex + 1) / pairs.length) * 100}%` }} /></div>
            </div>
            <h2 className="interest-pair-question" id="interest-pair-question">你想接觸哪些課程內容？</h2>
            <div className="interest-course-pair" role="group" aria-labelledby="interest-pair-question">
              {pair.map(card => (
                <CourseChoice key={card.courseCode} card={card} selected={selected.includes(card.courseCode)}
                  disabled={busy || Boolean(pending)} onClick={() => toggle(card.courseCode)} />
              ))}
            </div>
            <div className="interest-card-actions">
              <button type="button" className="interest-button secondary" onClick={() => advance()}
                disabled={busy || Boolean(pending)}>這題先略過</button>
              <button type="button" className="interest-button positive" onClick={submitSelection}
                disabled={busy || selected.length === 0}>
                {busy ? '保存中…' : pending ? '重試保存' : currentIndex + 1 < pairs.length ? '下一題' : '完成探索'} <ArrowRight size={17} />
              </button>
            </div>
          </>
        ) : (
          <div className="interest-exploration-empty">
            <BookOpenCheck size={30} />
            <h2>目前沒有足夠的探索課程</h2>
            <p>當學期還沒有兩門符合修課資格且有可用主題的選修課。你可以直接開始排課。</p>
            <button type="button" className="interest-button positive" onClick={() => finish('completed')}>
              直接開始排課 <ArrowRight size={17} />
            </button>
          </div>
        )}

        <footer className="interest-exploration-footer">
          <span>稍後再做也可以。返回偏好設定會保留目前進度。</span>
          <button type="button" disabled={busy} onClick={() => finish('skipped')}>
            {currentIndex > 0 ? '結束探索，前往課表' : '略過探索，前往課表'}
          </button>
        </footer>
      </section>
    </main>
  );
}
