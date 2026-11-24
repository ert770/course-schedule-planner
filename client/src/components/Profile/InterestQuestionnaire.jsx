// 設定頁「想接觸的課程主題」：課程主題問答 v1（ADR-027）。
//
// 一次一題：本系、通識、系外各一題（A／B／C，可複選、不限數量，可換一組、上一題、這題先略過）。
// 每組作答後緊接著是該組的細項頁（有選方向才有；2026-11-22 使用者要求三組都要追問，規格原本只有一題）。
// 選完方向後進入中沙漏的卡片頁；點卡才顯示小沙漏的具體標籤問答。
// 最後在確認頁逐項移除或撤回，按確認才把結果交給設定頁。
// 選項與文案都由後端提供（`POST /api/profile/interest-questions`）；這裡只記使用者選了哪些 ID。
// 作答邏輯在 `utils/interestQuestionnaireDraft.js`（有單元測試）。
import { useEffect, useMemo, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { profileAPI } from '../../services/api';
import {
  QUESTION_GROUPS,
  allEffectiveDirections,
  buildConfirmDraft,
  directionKey,
  effectiveDirections,
  isDetailStillValid,
  sameDirection,
  savedDirectionsFrom,
  setTopicChecked,
  toggleDirection,
  toggleTopic,
  visibleTopics,
  finalizeSelections,
} from '../../utils/interestQuestionnaireDraft';

const GROUP_LABELS = { department: '本系', generalEducation: '通識', outside: '系外' };
const LETTERS = ['A', 'B', 'C'];
export default function InterestQuestionnaire({ scope, savedSelections = [], savedSummary, confirmLabel, onConfirm }) {
  const scopeReady = Boolean(scope.department && scope.gradeLevel > 0 && scope.className);
  // phase：intro → group／detail（交錯）→ confirm。step 是目前畫面：{ type: 'group', index } 或 { type: 'detail', group }。
  const [phase, setPhase] = useState('intro');
  const [step, setStep] = useState(null);
  // 走過的畫面堆疊：「上一題」一律回到前一個實際看過的畫面（題目或追問），被自動略過的畫面不會進來。
  const [history, setHistory] = useState([]);
  const [summary, setSummary] = useState(null);
  const [answers, setAnswers] = useState({});
  const [working, setWorking] = useState([]);
  const [questions, setQuestions] = useState({});
  // 每組各一題追問（2026-11-22 使用者要求三個大題都要追問）：題目、目前勾選、答案、只有一個細項的方向。
  const [details, setDetails] = useState({});
  const [cardPage, setCardPage] = useState(0);
  const [card, setCard] = useState(null);
  const [detailSelected, setDetailSelected] = useState({});
  const [detailAnswers, setDetailAnswers] = useState({});
  const [checkables, setCheckables] = useState({});
  const [draft, setDraft] = useState(null);
  const [removedKeys, setRemovedKeys] = useState(new Set());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const savedKey = JSON.stringify(savedSelections.map(({ group, categoryId, tagIds }) => [group, categoryId, tagIds]));
  const isAnswering = phase !== 'intro';
  useEffect(() => {
    let cancelled = false;
    if (!isAnswering || !scopeReady || savedSelections.length === 0) {
      setSummary(null);
      return () => { cancelled = true; };
    }
    profileAPI.getInterestQuestion({
      ...scope,
      stage: 'summary',
      selections: savedSelections.map(({ group, categoryId, tagIds }) => ({ group, categoryId, tagIds: tagIds ?? [] })),
    })
      .then(data => { if (!cancelled) setSummary(data); })
      .catch(() => { if (!cancelled) setSummary(null); });
    return () => { cancelled = true; };
    // savedKey 已涵蓋 savedSelections 的內容。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAnswering, savedKey, scope.department, scope.gradeLevel, scope.className, scopeReady]);

  const savedLabels = summary?.scopeReady ? summary : savedSummary;
  const savedDirections = useMemo(() => savedDirectionsFrom(savedSelections, savedLabels), [savedSelections, savedLabels]);
  const savedTopicNames = useMemo(() => new Map((savedLabels?.topics ?? []).map(topic => [topic.tagId, topic.name])), [savedLabels]);

  const request = payload => profileAPI.getInterestQuestion({ ...scope, ...payload });
  const detailDirections = (directions) => directions.map(direction => ({
    group: direction.group,
    categoryId: direction.categoryId,
    hasConfirmedTopics: (savedSelections.find(item => item.group === direction.group
      && item.categoryId === direction.categoryId)?.tagIds ?? []).length > 0,
  }));
  const currentState = (overrides = {}) => ({ answers, detailAnswers, checkables, ...overrides });

  const openConfirm = (state) => {
    const directions = allEffectiveDirections(state.answers, savedDirections);
    // 某組改掉了追問所依據的方向，那一組的追問答案就不算（buildConfirmDraft 也會再檢查一次）。
    const validDetails = Object.values(state.detailAnswers).flat().filter(item => isDetailStillValid(item, directions));
    setDraft(buildConfirmDraft({
      directions,
      savedSelections,
      savedTopicNames,
      details: validDetails,
      checkableTopics: Object.values(state.checkables).flat(),
    }));
    setRemovedKeys(new Set());
    setPhase('confirm');
    setStep(null);
  };

  // 進到某一組的題目；這組沒有合格方向就直接往下走（不留下作答狀態，也不進「上一題」的堆疊）。
  const showGroup = async (index, state) => {
    const key = QUESTION_GROUPS[index];
    setPhase('group');
    setStep({ type: 'group', index });
    setWorking(state.answers[key]?.status === 'answered'
      ? state.answers[key].selected
      : effectiveDirections(key, state.answers, savedDirections));
    if (questions[key]) return;
    setLoading(true);
    setError('');
    try {
      const data = await request({ stage: 'group', group: key, seenOptionIds: [] });
      if (!data.question || data.options.length === 0) {
        await afterGroup(index, state);
        return;
      }
      setQuestions(prev => ({ ...prev, [key]: { ...data, seen: data.options.map(option => option.categoryId) } }));
    } catch (err) {
      setError(err.message || '題目載入失敗，請稍後再試。');
    } finally {
      setLoading(false);
    }
  };

  // 某組的題目（與它的追問）結束之後：下一組，或三組都結束就到確認頁。
  const afterGroup = async (index, state) => {
    if (index < QUESTION_GROUPS.length - 1) await showGroup(index + 1, state);
    else openConfirm(state);
  };

  // 某組的細項頁：後端回傳這組每個已選方向的區塊；沒有任何方向有標籤就往下走。
  const showDetail = async (group, state) => {
    const index = QUESTION_GROUPS.indexOf(group);
    const directions = effectiveDirections(group, state.answers, savedDirections);
    setLoading(true);
    setError('');
    try {
      const data = await request({ stage: 'detail', layout: 'cards', directions: detailDirections(directions) });
      if (!data.question || data.directions.length === 0) {
        await afterGroup(index, state);
        return;
      }
      setDetails(prev => ({ ...prev, [group]: data }));
      setCardPage(0);
      setCard(null);
      // 回到同一組的細項頁時，仍在的方向保留剛才的勾選。
      const previous = state.detailAnswers[group] ?? [];
      setDetailSelected(prev => ({
        ...prev,
        [group]: Object.fromEntries(data.directions.map(block => [
          block.categoryId,
          prev[group]?.[block.categoryId]
            ?? previous.find(answer => answer.target.categoryId === block.categoryId)?.selected
            // 第一次進細項頁：預先勾好已存、而且仍在這個方向裡的標籤。
            ?? (savedSelections.find(item => item.group === group && item.categoryId === block.categoryId)?.tagIds ?? [])
              .filter(tagId => block.tags.some(tag => tag.tagId === tagId)),
        ])),
      }));
      setPhase('detail');
      setStep({ type: 'detail', group });
    } catch (err) {
      setError(err.message || '題目載入失敗，請稍後再試。');
    } finally {
      setLoading(false);
    }
  };

  const loadCardQuestion = async (opened, seenTagIds = []) => {
    setCard(opened);
    setLoading(true);
    setError('');
    try {
      const { group: cardGroup, categoryId } = opened.direction;
      const data = await request({ stage: 'card', direction: { group: cardGroup, categoryId }, seenTagIds });
      setCard({ ...opened, data, second: seenTagIds.length > 0 });
    } catch (err) {
      setError(err.message || '細項載入失敗，請稍後再試。');
    } finally {
      setLoading(false);
    }
  };

  const finishCard = () => {
    const { group, categoryId } = card.direction;
    setDetailSelected(prev => ({ ...prev, [group]: { ...prev[group], [categoryId]: card.selected } }));
    setCard(null);
    setError('');
  };

  const renderCardQuestion = () => (
          <>
            <p className="interest-quiz-hint">{card.direction.title}</p>
            <h4 className="interest-quiz-question">{card.data?.question ?? '你想先接觸哪些主題？'}</h4>
            {loading && <p className="interest-followup-loading" role="status"><Loader2 size={18} className="spin-animation" /> 正在準備細項…</p>}
            {error && <p className="interest-quiz-error" role="alert">{error}</p>}
            {!loading && !error && !card.data?.options.length && <p className="interest-quiz-note">目前沒有可選的具體主題。</p>}
            <div className="interest-quiz-options">
              {!loading && card.data?.options.map((option, index) => (
                <button type="button" key={option.tagId} data-tag={option.tagId}
                  className={`interest-quiz-option${card.selected.includes(option.tagId) ? ' selected' : ''}`}
                  aria-pressed={card.selected.includes(option.tagId)}
                  onClick={() => setCard(prev => ({ ...prev, selected: toggleTopic(prev.selected, option.tagId) }))}>
                  <span className="interest-quiz-letter">{LETTERS[index]}</span>
                  <span className="interest-quiz-option-body">
                    <span className="interest-quiz-option-title">{option.title}</span>
                    {option.description && <span className="interest-quiz-option-desc">{option.description}</span>}
                    {option.title !== option.name && <span className="interest-quiz-option-label">課程主題：{option.name}</span>}
                  </span>
                </button>
              ))}
            </div>
            {card.selected.length > 0 && (
              <div className="interest-quiz-selected">
                已選：
                {card.selected.map(tagId => {
                  const topic = card.data?.options.find(option => option.tagId === tagId)
                    ?? card.shown.find(item => item.tagId === tagId);
                  return <span key={tagId} className="interest-quiz-chip">{topic?.name ?? tagId}
                    <button type="button" aria-label={`移除 ${topic?.name ?? tagId}`}
                      onClick={() => setCard(prev => ({ ...prev, selected: prev.selected.filter(id => id !== tagId) }))}>×</button>
                  </span>;
                })}
              </div>
            )}
            <div className="interest-quiz-actions">
              <button type="button" className="course-card-action" disabled={loading}
                onClick={() => { setCard(null); setError(''); }}>返回方向</button>
              {error && !card.data && <button type="button" className="course-card-action"
                onClick={() => loadCardQuestion(card)}>重試</button>}
              {card.data?.hasMore && !card.second && card.selected.length === 0 && (
                <button type="button" className="course-card-action" disabled={loading}
                  onClick={() => loadCardQuestion({
                    ...card, shown: [...card.shown, ...card.data.options],
                  }, card.data.options.map(option => option.tagId))}>想看其他主題</button>
              )}
              <button type="button" className="course-card-action primary" onClick={finishCard} disabled={loading || !card.data}>
                {card.selected.length ? '完成' : '先保留方向'}
              </button>
            </div>
          </>
  );

  const changeBatch = async () => {
    const group = QUESTION_GROUPS[step.index];
    const current = questions[group];
    setLoading(true);
    setError('');
    try {
      const data = await request({ stage: 'group', group, seenOptionIds: current.seen });
      setQuestions(prev => ({
        ...prev,
        [group]: { ...data, seen: [...current.seen, ...data.options.map(option => option.categoryId)] },
      }));
    } catch (err) {
      setError(err.message || '題目載入失敗，請稍後再試。');
    } finally {
      setLoading(false);
    }
  };

  const answerGroup = async (status) => {
    const group = QUESTION_GROUPS[step.index];
    const nextAnswers = { ...answers, [group]: { status, selected: status === 'answered' ? working : [] } };
    setAnswers(nextAnswers);
    setHistory(prev => [...prev, step]);
    const state = currentState({ answers: nextAnswers });
    // 有選方向才追問；按「這題先略過」的組不追問。
    if (status === 'answered' && working.length > 0) await showDetail(group, state);
    else await afterGroup(step.index, state);
  };

  const answerDetail = async (skipped) => {
    const group = step.group;
    const detail = details[group];
    // 每個方向一筆答案；確認頁只列勾選的標籤（看過但沒勾的不列，避免一次列出幾十個）。
    const nextDetailAnswers = {
      ...detailAnswers,
      [group]: detail.directions.map(block => {
        const selected = skipped ? [] : (detailSelected[group]?.[block.categoryId] ?? []);
        const byId = new Map(block.tags.map(tag => [tag.tagId, tag]));
        return {
          target: { group, categoryId: block.categoryId },
          shown: selected.map(tagId => ({ tagId, name: byId.get(tagId)?.name ?? tagId })),
          selected,
          skipped,
        };
      }),
    };
    setDetailAnswers(nextDetailAnswers);
    setHistory(prev => [...prev, step]);
    await afterGroup(QUESTION_GROUPS.indexOf(group), currentState({ detailAnswers: nextDetailAnswers }));
  };

  // 上一題（確認頁的「返回調整」也是）：回到前一個實際看過的畫面。
  const goBack = () => {
    setError('');
    const previous = history[history.length - 1];
    if (!previous) {
      setPhase('intro');
      return;
    }
    setHistory(history.slice(0, -1));
    if (previous.type === 'group') {
      showGroup(previous.index, currentState());
    } else {
      setCard(null);
      setCardPage(0);
      setPhase('detail');
      setStep(previous);
    }
  };

  const start = () => {
    setAnswers({});
    setHistory([]);
    setDetails({});
    setCardPage(0);
    setCard(null);
    setDetailSelected({});
    setDetailAnswers({});
    setCheckables({});
    setDraft(null);
    showGroup(0, { answers: {}, detailAnswers: {}, checkables: {} });
  };

  const toggleRemoved = (key) => {
    setRemovedKeys(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  if (!scopeReady && savedDirections.length === 0) {
    return <p className="interest-quiz-note">選好班別後會顯示目前候選課程的主題。</p>;
  }

  // ── 開場與目前的主題 ──
  if (phase === 'intro') {
    const topics = (savedSummary?.topics ?? []).filter(topic => !topic.duplicate);
    return (
      <div className="interest-quiz" id="interest-questionnaire">
        <p className="interest-quiz-lead">想先接觸哪些課程主題？選幾個你有興趣的方向，我們會用來推薦課程。現在不確定的可以略過。</p>
        {savedDirections.length > 0 && (
          <div className="interest-quiz-current" id="interest-quiz-current">
            <p><strong>目前的方向</strong></p>
            <ul className="interest-quiz-confirm-list">
              {QUESTION_GROUPS.map(group => {
                const directions = savedDirections.filter(direction => direction.group === group);
                return directions.length > 0 && (
                  <li key={group}><strong>{GROUP_LABELS[group]}</strong> {directions.map(direction => direction.title).join('、')}</li>
                );
              })}
            </ul>
            <p><strong>確認的具體主題</strong></p>
            {topics.length > 0 ? (
              <ul className="interest-quiz-selected" aria-label="已確認的課程主題">
                {topics.map(topic => <li className="interest-quiz-chip" key={topic.tagId}>{topic.name}</li>)}
              </ul>
            ) : <p>尚未確認</p>}
          </div>
        )}
        {!scopeReady && <p className="interest-quiz-note">選好班別後可重新回答課程主題問答。</p>}
        <button type="button" className="course-card-action primary" id="interest-quiz-start" onClick={start} disabled={!scopeReady}>
          {savedDirections.length > 0 ? '重新回答' : '開始回答'}
        </button>
      </div>
    );
  }

  const header = (label) => (
    <div className="interest-quiz-progress" aria-live="polite">{label}</div>
  );

  // ── 三組題目 ──
  if (phase === 'group') {
    const groupIndex = step.index;
    const group = QUESTION_GROUPS[groupIndex];
    const current = questions[group];
    return (
      <div className="interest-quiz" id="interest-questionnaire" data-phase="group" data-group={group}>
        {header(`第 ${groupIndex + 1}／${QUESTION_GROUPS.length} 題・${GROUP_LABELS[group]}`)}
        {loading && !current ? (
          <p className="interest-followup-loading"><Loader2 size={18} className="spin-animation" /> 正在準備題目…</p>
        ) : error && !current ? (
          <p className="interest-quiz-error" role="alert">{error}</p>
        ) : current ? (
          <>
            <h4 className="interest-quiz-question" id="interest-quiz-question">{current.question}</h4>
            <p className="interest-quiz-hint">可以複選。</p>
            <div className="interest-quiz-options">
              {current.options.map((option, index) => {
                const selected = working.some(item => sameDirection(item, { group, ...option }));
                return (
                  <button
                    type="button"
                    key={option.categoryId}
                    className={`interest-quiz-option${selected ? ' selected' : ''}`}
                    aria-pressed={selected}
                    id={`interest-quiz-option-${option.categoryId}`}
                    onClick={() => {
                      setWorking(toggleDirection(working, {
                        group, categoryId: option.categoryId, aliasIds: option.aliasIds ?? [],
                        title: option.title, categoryLabel: option.categoryLabel, level: option.level,
                      }));
                    }}
                  >
                    <span className="interest-quiz-letter">{LETTERS[index]}</span>
                    <span className="interest-quiz-option-body">
                      <span className="interest-quiz-option-title">{option.title}</span>
                      {option.description && <span className="interest-quiz-option-desc">{option.description}</span>}
                      <span className="interest-quiz-option-label">分類：{option.categoryLabel}</span>
                      {/* 代表主題只是說明這個方向包含什麼，選方向不會把它們存成具體主題（ADR-027）。 */}
                      {option.topics?.length > 0 && (
                        <span className="interest-quiz-option-topics">
                          包含主題：{option.topics.join('、')}
                          {option.topicCount > option.topics.length && ` 等 ${option.topicCount} 個`}
                        </span>
                      )}
                    </span>
                  </button>
                );
              })}
            </div>
            {working.length > 0 && (
              <div className="interest-quiz-selected" id="interest-quiz-selected">
                已選：
                {working.map(item => (
                  <span key={item.categoryId} className="interest-quiz-chip">
                    {item.title}
                    <button type="button" aria-label={`移除 ${item.title}`}
                      onClick={() => setWorking(working.filter(other => !sameDirection(other, item)))}>
                      ×
                    </button>
                  </span>
                ))}
              </div>
            )}
            {error && <p className="interest-quiz-error" role="alert">{error}</p>}
            <div className="interest-quiz-actions">
              <button type="button" className="course-card-action" onClick={goBack} disabled={loading}>上一題</button>
              {current.hasMore && (
                <button type="button" className="course-card-action" id="interest-quiz-more" onClick={changeBatch} disabled={loading}>換一組</button>
              )}
              <button type="button" className="course-card-action" id="interest-quiz-skip" onClick={() => answerGroup('skipped')} disabled={loading}>這題先略過</button>
              <button type="button" className="course-card-action primary" id="interest-quiz-next"
                onClick={() => answerGroup('answered')} disabled={loading || working.length === 0}>
                下一題
              </button>
            </div>
          </>
        ) : null}
      </div>
    );
  }

  // 中沙漏只顯示這一組在大沙漏選過的方向。點卡才請求小沙漏題目。
  if (phase === 'detail') {
    const detailGroup = step.group;
    const detail = details[detailGroup];
    const picks = detailSelected[detailGroup] ?? {};
    const total = Object.values(picks).reduce((sum, ids) => sum + ids.length, 0);
    const pages = detail.cardPages ?? [];
    const cards = pages[cardPage] ?? [];
    return (
      <div className="interest-quiz" id="interest-questionnaire" data-phase={card ? 'card' : 'detail'} data-group={detailGroup}>
        {header(`第 ${QUESTION_GROUPS.indexOf(detailGroup) + 1}／${QUESTION_GROUPS.length} 題・${GROUP_LABELS[detailGroup]}・細項`)}
        {card ? renderCardQuestion() : (
          <>
            <h4 className="interest-quiz-question" id="interest-quiz-question">從已選方向挑一張，再選具體主題</h4>
            <div className="interest-quiz-card-grid">
              {cards.map(({ categoryId, examples }) => {
                const block = detail.directions.find(direction => direction.categoryId === categoryId);
                const selected = picks[categoryId] ?? [];
                const names = block.tags.filter(tag => selected.includes(tag.tagId)).map(tag => tag.name);
                return (
                  <button type="button" key={categoryId} className={`interest-quiz-direction-card${selected.length ? ' selected' : ''}`}
                    disabled={loading} onClick={() => loadCardQuestion({ direction: block, shown: block.tags, selected, data: null })}>
                    <strong>{block.title}</strong>
                    {examples.length > 0 && <span>{examples.join('、')}</span>}
                    {names.length > 0 && <small>已選：{names.slice(0, 2).join('、')}{names.length > 2 ? ` 等 ${names.length} 項` : ''}</small>}
                  </button>
                );
              })}
            </div>
            {total > 0 && <p className="interest-quiz-hint" id="interest-quiz-picked">已選 {total} 個主題。</p>}
            {/* 太常見的標籤（Python 等，too_common）不開放勾選（2026-11-23 使用者決定，ADR-032）：
                想排的話在 AI 聊天說，當作這一次排課的關鍵字。 */}
            <p className="interest-quiz-note" id="interest-quiz-common-topics">
              Python 這類很常見的工具或技能不在主題選項裡。想排的話，排課時直接跟 AI 助理說，例如「這次想排 Python 的課」。
            </p>
            {error && <p className="interest-quiz-error" role="alert">{error}</p>}
            <div className="interest-quiz-actions">
              <button type="button" className="course-card-action" onClick={goBack} disabled={loading}>上一題</button>
              {cardPage > 0 && <button type="button" className="course-card-action" onClick={() => setCardPage(cardPage - 1)}>上一批方向</button>}
              {cardPage + 1 < pages.length && <button type="button" className="course-card-action" onClick={() => setCardPage(cardPage + 1)}>更多已選方向</button>}
              <button type="button" className="course-card-action" id="interest-quiz-skip" onClick={() => answerDetail(true)} disabled={loading}>這題先略過</button>
              <button type="button" className="course-card-action primary" id="interest-quiz-next"
                onClick={() => answerDetail(false)} disabled={loading || total === 0}>下一步</button>
            </div>
          </>
        )}
      </div>
    );
  }

  // ── 確認頁 ──
  const topics = draft ? visibleTopics(draft, removedKeys) : [];
  return (
    <div className="interest-quiz" id="interest-questionnaire" data-phase="confirm">
      <h4 className="interest-quiz-question">確認你想接觸的主題</h4>
      <div className="interest-quiz-confirm" id="interest-quiz-confirm">
        <p className="interest-quiz-confirm-label">你選的方向</p>
        {draft.directions.length === 0 ? (
          <p className="interest-quiz-note">沒有選擇方向。保存後不會依課程主題調整推薦。</p>
        ) : (
          <ul className="interest-quiz-confirm-list">
            {draft.directions.map(direction => {
              const key = directionKey(direction.group, direction.categoryId);
              const removed = removedKeys.has(key);
              return (
                <li key={key} className={removed ? 'removed' : ''} data-direction={key}>
                  <span>{GROUP_LABELS[direction.group]}・{direction.title}</span>
                  {direction.available === false && <span className="interest-quiz-note">（目前不在候選課程中）</span>}
                  <button type="button" onClick={() => toggleRemoved(key)}>{removed ? '撤回' : '移除'}</button>
                </li>
              );
            })}
          </ul>
        )}
        <p className="interest-quiz-confirm-label">你確認的具體主題</p>
        {topics.length === 0 ? (
          <p className="interest-quiz-note">尚未確認具體主題。只選方向也可以，系統不會自動把方向展開成主題。</p>
        ) : (
          <div className="interest-quiz-confirm-topics">
            {topics.map(topic => (
              <label key={topic.tagId} className="interest-topic-confirm-row" data-topic={topic.tagId}>
                <input type="checkbox" checked={topic.checked} onChange={() => setDraft(setTopicChecked(draft, topic.tagId, !topic.checked))} />
                <span className="interest-followup-option-name">{topic.name}</span>
              </label>
            ))}
          </div>
        )}
        {draft.directions.length > 0 && !topics.some(topic => topic.checked) && (
          <p className="interest-quiz-reminder" role="status" id="interest-quiz-no-topics">
            這次只選了方向，還沒有新增會影響推薦的具體主題。
            <button type="button" onClick={goBack}>回去選</button>
          </p>
        )}
        <p className="interest-quiz-hint">可以移除不想保留的方向或主題，移除後也能撤回。</p>
      </div>
      <div className="interest-quiz-actions">
        <button type="button" className="course-card-action" onClick={goBack}>返回調整</button>
        <button type="button" className="course-card-action primary" id="interest-quiz-confirm-save"
          onClick={() => { onConfirm(finalizeSelections(draft, removedKeys)); setPhase('intro'); }}>
          {confirmLabel}
        </button>
      </div>
    </div>
  );
}
