// 設定頁「想接觸的課程主題」：課程主題問答 v1（ADR-027）。
//
// 一次一題：本系、通識、系外各一題（A／B／C，可複選、不限數量，可換一組、上一題、這題先略過）。
// 每組作答後緊接著是該組的細項頁（有選方向才有；2026-11-22 使用者要求三組都要追問，規格原本只有一題）。
// 細項頁列出這組**每個**已選方向（三層沙漏的中、小層）：12 個以下直接列，13 個以上用預算好的群卡＋熱門＋搜尋，
// 設計稿 docs/PLANS/2026-11-22-interest-questionnaire-funnel-design.md。
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
// 一組選了很多方向時，第 4 個以後的區塊預設收合，只顯示標題與已選數量。
const OPEN_DIRECTIONS = 3;

// 細項頁的一個方向區塊（三層沙漏的中、小層）。展開、搜尋、「更多」只是畫面狀態，不影響作答。
// 群卡先收合，只顯示群名與 2 個代表標籤；點了才在原地展開。展開不會自動勾選任何標籤（A：只有勾選的標籤算分）。
const CLUSTER_REPS = 2;
const CLUSTER_SHOW = 6;
const FLAT_SHOW = 12;
const SEARCH_MIN_TAGS = 13;

function TagChip({ tag, selected, onToggle }) {
  return (
    <button
      type="button"
      className={`interest-quiz-tag${selected ? ' selected' : ''}`}
      aria-pressed={selected}
      data-tag={tag.tagId}
      onClick={() => onToggle(tag.tagId)}
    >
      {tag.name}
    </button>
  );
}

function DetailDirection({ block, selected, onToggle, defaultOpen }) {
  const [open, setOpen] = useState(defaultOpen);
  const [expanded, setExpanded] = useState(new Set());
  const [showAll, setShowAll] = useState(new Set());
  const [query, setQuery] = useState('');
  const byId = useMemo(() => new Map(block.tags.map(tag => [tag.tagId, tag])), [block.tags]);
  const isSelected = tagId => selected.includes(tagId);
  const toggleSet = (setter, key) => setter(prev => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    return next;
  });
  const keyword = query.trim().toLowerCase();
  const matches = keyword ? block.tags.filter(tag => tag.name.toLowerCase().includes(keyword)) : [];

  return (
    <section className="interest-quiz-direction" data-direction={block.categoryId} data-mode={block.mode}>
      <button type="button" className="interest-quiz-direction-head" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className="interest-quiz-direction-title">{block.title}</span>
        <span className="interest-quiz-direction-meta">已選 {selected.length}・共 {block.tagCount} 個主題</span>
      </button>
      {open && (
        <div className="interest-quiz-direction-body">
          {block.tagCount >= SEARCH_MIN_TAGS && (
            <input
              type="search"
              className="interest-quiz-search"
              placeholder="搜尋這個方向的主題"
              aria-label={`搜尋「${block.title}」的主題`}
              value={query}
              onChange={event => setQuery(event.target.value)}
            />
          )}
          {keyword ? (
            <div className="interest-quiz-tags" data-role="search-results">
              {matches.length === 0
                ? <span className="interest-quiz-note">找不到符合的主題。</span>
                : matches.map(tag => <TagChip key={tag.tagId} tag={tag} selected={isSelected(tag.tagId)} onToggle={onToggle} />)}
            </div>
          ) : block.mode === 'clusters' ? (
            <>
              <div className="interest-quiz-popular">
                <span className="interest-quiz-popular-label">熱門</span>
                {block.popular.map(tag => <TagChip key={tag.tagId} tag={tag} selected={isSelected(tag.tagId)} onToggle={onToggle} />)}
              </div>
              <div className="interest-quiz-clusters">
                {block.clusters.map(cluster => {
                  const key = cluster.clusterId;
                  const isOpen = expanded.has(key);
                  const tags = cluster.tagIds.map(tagId => byId.get(tagId)).filter(Boolean);
                  const reps = tags.slice(0, CLUSTER_REPS).map(tag => tag.name).join('、');
                  const pickedHere = tags.filter(tag => isSelected(tag.tagId)).length;
                  const visible = showAll.has(key) ? tags : tags.slice(0, CLUSTER_SHOW);
                  return (
                    <div key={key} className={`interest-quiz-cluster${isOpen ? ' open' : ''}`} data-cluster={key}>
                      <button type="button" className="interest-quiz-cluster-head" aria-expanded={isOpen} onClick={() => toggleSet(setExpanded, key)}>
                        <span className="interest-quiz-cluster-label">{cluster.label}</span>
                        <span className="interest-quiz-cluster-reps">（{reps}{tags.length > CLUSTER_REPS ? ' 等' : ''}）</span>
                        {pickedHere > 0 && <span className="interest-quiz-cluster-count">已選 {pickedHere}</span>}
                      </button>
                      {isOpen && (
                        <div className="interest-quiz-tags">
                          {visible.map(tag => <TagChip key={tag.tagId} tag={tag} selected={isSelected(tag.tagId)} onToggle={onToggle} />)}
                          {tags.length > CLUSTER_SHOW && !showAll.has(key) && (
                            <button type="button" className="interest-quiz-more" onClick={() => toggleSet(setShowAll, key)}>
                              更多 {tags.length - CLUSTER_SHOW} 個
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </>
          ) : (
            <div className="interest-quiz-tags">
              {(showAll.has('flat') ? block.tags : block.tags.slice(0, FLAT_SHOW))
                .map(tag => <TagChip key={tag.tagId} tag={tag} selected={isSelected(tag.tagId)} onToggle={onToggle} />)}
              {block.tags.length > FLAT_SHOW && !showAll.has('flat') && (
                <button type="button" className="interest-quiz-more" onClick={() => toggleSet(setShowAll, 'flat')}>
                  更多 {block.tags.length - FLAT_SHOW} 個
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}


export default function InterestQuestionnaire({ scope, savedSelections = [], confirmLabel, onConfirm }) {
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
  const [detailSelected, setDetailSelected] = useState({});
  const [detailAnswers, setDetailAnswers] = useState({});
  const [checkables, setCheckables] = useState({});
  const [draft, setDraft] = useState(null);
  const [removedKeys, setRemovedKeys] = useState(new Set());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const savedKey = JSON.stringify(savedSelections.map(({ group, categoryId, tagIds }) => [group, categoryId, tagIds]));
  useEffect(() => {
    let cancelled = false;
    if (!scopeReady || savedSelections.length === 0) {
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
  }, [savedKey, scope.department, scope.gradeLevel, scope.className, scopeReady]);

  const savedDirections = useMemo(() => savedDirectionsFrom(savedSelections, summary), [savedSelections, summary]);
  const savedTopicNames = useMemo(() => new Map((summary?.topics ?? []).map(topic => [topic.tagId, topic.name])), [summary]);

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
      const data = await request({ stage: 'detail', directions: detailDirections(directions) });
      if (!data.question || data.directions.length === 0) {
        await afterGroup(index, state);
        return;
      }
      setDetails(prev => ({ ...prev, [group]: data }));
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
      setPhase('detail');
      setStep(previous);
    }
  };

  const start = () => {
    setAnswers({});
    setHistory([]);
    setDetails({});
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

  if (!scopeReady) {
    return <p className="interest-quiz-note">選好班別後會顯示目前候選課程的主題。</p>;
  }

  // ── 開場與目前的主題 ──
  if (phase === 'intro') {
    const topicsByDirection = (summary?.topics ?? []).filter(topic => !topic.duplicate);
    return (
      <div className="interest-quiz" id="interest-questionnaire">
        <p className="interest-quiz-lead">想先接觸哪些課程主題？選幾個你有興趣的方向，我們會用來推薦課程。現在不確定的可以略過。</p>
        {savedDirections.length > 0 && (
          <div className="interest-quiz-current" id="interest-quiz-current">
            <p><strong>目前的方向</strong>{' '}{savedDirections.map(direction => direction.title).join('、')}</p>
            <p><strong>確認的具體主題</strong>{' '}{topicsByDirection.length > 0 ? topicsByDirection.map(topic => topic.name).join('、') : '尚未確認'}</p>
          </div>
        )}
        <button type="button" className="course-card-action primary" id="interest-quiz-start" onClick={start}>
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

  // ── 細項頁 ──
  if (phase === 'detail') {
    const detailGroup = step.group;
    const detail = details[detailGroup];
    const picks = detailSelected[detailGroup] ?? {};
    const total = Object.values(picks).reduce((sum, ids) => sum + ids.length, 0);
    const toggleFor = categoryId => tagId => setDetailSelected(prev => ({
      ...prev,
      [detailGroup]: { ...prev[detailGroup], [categoryId]: toggleTopic(prev[detailGroup]?.[categoryId] ?? [], tagId) },
    }));
    return (
      <div className="interest-quiz" id="interest-questionnaire" data-phase="detail" data-group={detailGroup}>
        {header(`第 ${QUESTION_GROUPS.indexOf(detailGroup) + 1}／${QUESTION_GROUPS.length} 題・${GROUP_LABELS[detailGroup]}・細項`)}
        {loading && !detail ? (
          <p className="interest-followup-loading"><Loader2 size={18} className="spin-animation" /> 正在準備題目…</p>
        ) : error && !detail ? (
          <p className="interest-quiz-error" role="alert">{error}</p>
        ) : detail ? (
          <>
            <h4 className="interest-quiz-question" id="interest-quiz-question">{detail.question}</h4>
            <div className="interest-quiz-directions">
              {detail.directions.map((block, index) => (
                <DetailDirection
                  key={block.categoryId}
                  block={block}
                  selected={picks[block.categoryId] ?? []}
                  onToggle={toggleFor(block.categoryId)}
                  defaultOpen={index < OPEN_DIRECTIONS}
                />
              ))}
            </div>
            {total > 0 && <p className="interest-quiz-hint" id="interest-quiz-picked">已選 {total} 個主題。</p>}
            {error && <p className="interest-quiz-error" role="alert">{error}</p>}
            <div className="interest-quiz-actions">
              <button type="button" className="course-card-action" onClick={goBack} disabled={loading}>上一題</button>
              <button type="button" className="course-card-action" id="interest-quiz-skip" onClick={() => answerDetail(true)} disabled={loading}>這題先略過</button>
              <button type="button" className="course-card-action primary" id="interest-quiz-next"
                onClick={() => answerDetail(false)} disabled={loading || total === 0}>
                下一步
              </button>
            </div>
          </>
        ) : null}
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
