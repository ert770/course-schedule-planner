import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, BookOpenCheck, Check, Compass, Loader2, Sparkles } from 'lucide-react';
import { useAuth } from '../contexts/useAuth';
import { getUserIdentity } from '../utils/userIdentity';
import { interactionsAPI, interestExplorationAPI, profileAPI } from '../services/api';
import {
  getInterestExplorationState,
  saveInterestExplorationState,
} from '../services/interestExplorationState';
import { hasPersonalizationConsent, newUuid } from '../services/interactionLog';
import './InterestExplorationPage.css';

function arrangeSavedDeck(cards, courseCodes) {
  if (!courseCodes?.length) return cards;
  const byCode = new Map(cards.map(card => [card.courseCode, card]));
  const saved = courseCodes.map(code => byCode.get(code)).filter(Boolean);
  const savedCodes = new Set(saved.map(card => card.courseCode));
  return [...saved, ...cards.filter(card => !savedCodes.has(card.courseCode))];
}

function courseTime(card) {
  return card.schedule || '時間資料尚未提供';
}

export default function InterestExplorationPage() {
  const navigate = useNavigate();
  const { user, privacyStatus } = useAuth();
  const identity = getUserIdentity(user);
  const consented = hasPersonalizationConsent(privacyStatus);
  const [cards, setCards] = useState([]);
  const [profile, setProfile] = useState(null);
  const [targetTerm, setTargetTerm] = useState(null);
  const [categoryPrompts, setCategoryPrompts] = useState([]);
  const [clarifiedCategoryIds, setClarifiedCategoryIds] = useState([]);
  const [selectedSubcategoryIds, setSelectedSubcategoryIds] = useState(new Set());
  const [currentIndex, setCurrentIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [negativeMode, setNegativeMode] = useState(false);
  const [selectedTagIds, setSelectedTagIds] = useState(new Set());
  const pendingEvent = useRef(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([interestExplorationAPI.getCards(), profileAPI.get()])
      .then(([result, savedProfile]) => {
        if (cancelled) return;
        const savedState = getInterestExplorationState(identity);
        if (savedState.status === 'completed' || savedState.status === 'skipped') {
          navigate('/schedule', { replace: true });
          return;
        }
        const deck = arrangeSavedDeck(result.cards || [], savedState.courseCodes);
        setCards(deck);
        setProfile(savedProfile);
        setTargetTerm(result.term ?? null);
        const unansweredPrompts = (result.categoryPrompts || []).filter(prompt => (
          !savedState.clarifiedCategoryIds.includes(prompt.mainCategoryId)
        ));
        setCategoryPrompts(unansweredPrompts);
        setClarifiedCategoryIds(savedState.clarifiedCategoryIds);
        setCurrentIndex(Math.min(savedState.currentIndex, deck.length));
        saveInterestExplorationState(identity, {
          status: 'in_progress',
          currentIndex: Math.min(savedState.currentIndex, deck.length),
          courseCodes: deck.map(card => card.courseCode),
          clarifiedCategoryIds: savedState.clarifiedCategoryIds,
        });
      })
      .catch(err => setError(err.message || '無法載入初始探索課程。'))
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [identity, navigate]);

  const card = cards[currentIndex] ?? null;
  const topics = useMemo(() => [
    ...(profile?.interests ?? []),
    ...(profile?.preferredKeywords ?? []),
  ].filter((value, index, list) => list.indexOf(value) === index), [profile]);

  const saveCategoryClarification = async (includeSelected = true) => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const selectedNames = includeSelected ? categoryPrompts.flatMap(prompt => prompt.subcategories
        .filter(item => selectedSubcategoryIds.has(item.id))
        .map(item => item.name)) : [];
      let nextDeck = cards;
      if (selectedNames.length > 0) {
        const existingInterests = Array.isArray(profile?.interests) ? profile.interests : [];
        const response = await profileAPI.update({
          interests: [...new Set([...existingInterests, ...selectedNames])],
        });
        setProfile(response.preferences ?? profile);
        const refreshed = await interestExplorationAPI.getCards();
        nextDeck = arrangeSavedDeck(refreshed.cards || [], []);
        setCards(nextDeck);
      }
      const nextClarified = [...new Set([
        ...clarifiedCategoryIds,
        ...categoryPrompts.map(prompt => prompt.mainCategoryId),
      ])];
      setClarifiedCategoryIds(nextClarified);
      setCategoryPrompts([]);
      setSelectedSubcategoryIds(new Set());
      setCurrentIndex(0);
      saveInterestExplorationState(identity, {
        status: 'in_progress',
        currentIndex: 0,
        courseCodes: nextDeck.map(item => item.courseCode),
        clarifiedCategoryIds: nextClarified,
      });
    } catch (err) {
      setError(err.message || '保存主題方向失敗，請重試。');
    } finally {
      setBusy(false);
    }
  };

  const finish = (status) => {
    saveInterestExplorationState(identity, {
      status,
      currentIndex,
      courseCodes: cards.map(item => item.courseCode),
    });
    navigate('/schedule', { replace: true });
  };

  const advance = (nextNotice = '') => {
    const nextIndex = currentIndex + 1;
    setNegativeMode(false);
    setSelectedTagIds(new Set());
    setError('');
    setNotice(nextNotice);
    pendingEvent.current = null;
    if (nextIndex >= cards.length) {
      saveInterestExplorationState(identity, {
        status: 'completed',
        currentIndex: nextIndex,
        courseCodes: cards.map(item => item.courseCode),
      });
      navigate('/schedule', { replace: true });
      return;
    }
    setCurrentIndex(nextIndex);
    saveInterestExplorationState(identity, {
      status: 'in_progress',
      currentIndex: nextIndex,
      courseCodes: cards.map(item => item.courseCode),
    });
  };

  const sendFeedback = async (response, canonicalTagIds = []) => {
    if (!card || busy) return;
    if (response === 'not_interested' && canonicalTagIds.length === 0) {
      setError('請選出至少一個你不感興趣的課程標籤。');
      return;
    }

    if (!consented) {
      setNotice('這次不會保存你的回饋；你仍可完成探索並開始排課。');
      advance();
      return;
    }

    const actionKey = `${card.courseCode}:${response}:${[...canonicalTagIds].sort().join(',')}`;
    if (pendingEvent.current?.key !== actionKey) {
      pendingEvent.current = {
        key: actionKey,
        event: {
          eventType: 'interest_exploration_feedback',
          requestId: newUuid(),
          actionId: newUuid(),
          course: { catalogCourseCode: card.courseCode, sectionId: card.sectionId },
          term: card.term,
          source: 'exploration',
          interestFeedback: { response, canonicalTagIds },
          versionSnapshot: { recommendationReasonVersion: null },
        },
      };
    }

    setBusy(true);
    setError('');
    let responseNotice = '';
    try {
      const result = await interactionsAPI.record([pendingEvent.current.event]);
      if (result.recorded) {
        const eventResult = result.results?.[0];
        if (!eventResult || ['rejected', 'conflict'].includes(eventResult.status)) {
          throw new Error(eventResult?.errors?.join('；') || '回饋未能保存，請重試。');
        }
      } else {
        responseNotice = '個人化學習同意狀態已變更，這次回饋沒有保存。';
      }
      advance(responseNotice);
    } catch (err) {
      setError(`${err.message || '回饋保存失敗。'} 可重試，或略過這張卡片繼續。`);
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return <main className="interest-exploration-page"><div className="interest-exploration-loading"><Loader2 className="spin-animation" />正在準備探索課程…</div></main>;
  }

  return (
    <main className="interest-exploration-page">
      <section className="interest-exploration-shell" aria-labelledby="interest-exploration-title">
        <header className="interest-exploration-header">
          <div className="interest-exploration-icon"><Compass size={23} /></div>
          <p className="interest-exploration-eyebrow">排課前的短探索</p>
          <h1 id="interest-exploration-title">先看看哪些課程主題吸引你</h1>
          <p className="interest-exploration-intro">
            這些是真實開課資料中的選修課。每張卡片可回饋、先了解或略過；不會影響必修與其他排課條件。
          </p>
          {targetTerm && <p className="interest-exploration-term">探索學期：{targetTerm.academicYear} 學年度{targetTerm.semester}</p>}
        </header>

        {topics.length > 0 && (
          <div className="interest-exploration-topics">
            <span>你設定的方向</span>
            <div>{topics.map(topic => <span className="interest-topic-chip" key={topic}>{topic}</span>)}</div>
          </div>
        )}
        {profile?.preferredTrack && (
          <div className="interest-exploration-track">
            主要修課路徑（作為選卡情境）：<strong>{profile.preferredTrack}</strong>
          </div>
        )}

        {!consented && (
          <div className="interest-exploration-consent" role="status">
            你尚未同意「個人化學習」。仍可完成探索，但回饋不會保存到標籤興趣檔案。
          </div>
        )}

        {error && <div className="interest-exploration-error" role="alert">{error}</div>}
        {notice && <div className="interest-exploration-notice" role="status">{notice}</div>}

        {categoryPrompts.length > 0 ? (
          <section className="interest-category-prompt" aria-labelledby="interest-category-prompt-title">
            <div className="interest-category-prompt-heading">
              <Sparkles size={19} />
              <div>
                <h2 id="interest-category-prompt-title">你想先接觸哪些面向？</h2>
                <p>你選了較廣的主題。選幾個想了解的子分類，或先保留廣泛方向開始探索。</p>
              </div>
            </div>
            {categoryPrompts.map(prompt => (
              <div className="interest-category-prompt-group" key={prompt.mainCategoryId}>
                <h3>{prompt.mainCategory}</h3>
                <div className="interest-negative-tags">
                  {prompt.subcategories.map(item => {
                    const selected = selectedSubcategoryIds.has(item.id);
                    return (
                      <button
                        type="button"
                        key={item.id}
                        className={selected ? 'selected' : ''}
                        aria-pressed={selected}
                        onClick={() => setSelectedSubcategoryIds(previous => {
                          const next = new Set(previous);
                          if (next.has(item.id)) next.delete(item.id);
                          else next.add(item.id);
                          return next;
                        })}
                      >
                        {selected && <Check size={14} />}{item.name}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
            <div className="interest-card-actions">
              <button type="button" className="interest-button secondary" onClick={() => saveCategoryClarification(false)} disabled={busy}>
                {busy ? '保存中…' : '先保留廣泛方向'}
              </button>
              <button type="button" className="interest-button positive" onClick={saveCategoryClarification} disabled={busy}>
                {busy ? '保存中…' : '保存選擇並看課程'} <ArrowRight size={17} />
              </button>
            </div>
          </section>
        ) : card ? (
          <>
            <div className="interest-exploration-progress" aria-label={`第 ${currentIndex + 1} 張，共 ${cards.length} 張`}>
              <div><span>探索進度</span><strong>{currentIndex + 1} / {cards.length}</strong></div>
              <div className="interest-exploration-progress-track"><span style={{ width: `${((currentIndex + 1) / cards.length) * 100}%` }} /></div>
            </div>

            <article className="interest-course-card">
              <div className="interest-course-card-topline">
                <span>{card.category || '選修課程'}</span>
                <span>{card.courseCode}</span>
              </div>
              <h2>{card.name}</h2>
              <div className="interest-course-meta">
                <span>{card.department || '開課單位未提供'}</span>
                <span>{card.credits} 學分</span>
                <span>{card.instructor || '教師資料未提供'}</span>
                <span>{courseTime(card)}</span>
                {card.track && <span>修課路徑：{card.track}</span>}
              </div>
              <div className="interest-course-tags" aria-label="這門課的可學習主題標籤">
                {card.tags.map(tag => (
                  <span className="interest-course-tag" key={tag.canonicalTagId}>
                    <strong>{tag.canonicalName}</strong>
                    {tag.categoryPaths[0]?.subcategory && <small>{tag.categoryPaths[0].subcategory}</small>}
                  </span>
                ))}
              </div>

              {negativeMode ? (
                <div className="interest-negative-prompt">
                  <h3>哪些主題不符合你的興趣？</h3>
                  <p>只會把你勾選的標籤記為負向回饋。</p>
                  <div className="interest-negative-tags">
                    {card.tags.map(tag => {
                      const selected = selectedTagIds.has(tag.canonicalTagId);
                      return (
                        <button
                          type="button"
                          key={tag.canonicalTagId}
                          className={selected ? 'selected' : ''}
                          aria-pressed={selected}
                          onClick={() => setSelectedTagIds(previous => {
                            const next = new Set(previous);
                            if (next.has(tag.canonicalTagId)) next.delete(tag.canonicalTagId);
                            else next.add(tag.canonicalTagId);
                            return next;
                          })}
                        >
                          {selected && <Check size={14} />}{tag.canonicalName}
                        </button>
                      );
                    })}
                  </div>
                  <div className="interest-card-actions">
                    <button type="button" className="interest-button secondary" onClick={() => setNegativeMode(false)} disabled={busy}>返回</button>
                    <button type="button" className="interest-button negative" onClick={() => sendFeedback('not_interested', [...selectedTagIds])} disabled={busy || selectedTagIds.size === 0}>
                      {busy ? '保存中…' : '確認並繼續'}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="interest-card-actions">
                  <button type="button" className="interest-button positive" onClick={() => sendFeedback('interested')} disabled={busy}>
                    <Sparkles size={17} />有興趣
                  </button>
                  <button type="button" className="interest-button negative" onClick={() => setNegativeMode(true)} disabled={busy}>沒興趣</button>
                  <button type="button" className="interest-button secondary" onClick={() => sendFeedback('learn_more')} disabled={busy}>想先了解</button>
                  <button type="button" className="interest-button skip-card" onClick={advance} disabled={busy}>略過這張</button>
                </div>
              )}
            </article>
          </>
        ) : (
          <div className="interest-exploration-empty">
            <BookOpenCheck size={30} />
            <h2>目前沒有足夠的探索課程</h2>
            <p>系統沒有找到符合你修課範圍、當學期與標籤資格的非必修課程。你可以直接開始排課。</p>
            <button type="button" className="interest-button positive" onClick={() => finish('completed')}>
              直接開始排課 <ArrowRight size={17} />
            </button>
          </div>
        )}

        <footer className="interest-exploration-footer">
          <span>離開後會保留目前進度，之後可從偏好設定重新探索。</span>
          <button type="button" onClick={() => finish('skipped')}>略過探索，直接排課</button>
        </footer>
      </section>
    </main>
  );
}
