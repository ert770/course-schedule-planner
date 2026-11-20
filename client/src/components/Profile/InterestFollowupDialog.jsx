// 設定頁「想接觸的課程主題」的追問對話框。
//
// 在課程興趣步驟確認細項，或在保存時補問尚未確認的類別。
// 選項是後端依這位學生的候選課程準備的可選標籤（見 server/src/services/interestFollowupService.js）：
//   - 每個選項附代表課程與課程數（「會加分給 N 門課」），學生自己判斷；
//   - 題目可能是 GPT 寫的，也可能是固定問句（沒有金鑰、逾時、失敗時），流程相同；
//   - 預設勾選以頁面傳入的 `initialTagIds`（頁面上目前的答案，含還沒保存的）為準；
//     頁面沒有這個類別的答案時，才用伺服器標記的 `previouslySelected`（已保存的答案）。
//
// mode="save"：保存流程中跳出，有「略過，直接保存」——略過時新勾的類別只記類別、沒有標籤。
// mode="step" 確認後進入排課條件，mode="edit" 則留在課程興趣。
//
// 對話框自己處理 loading 與錯誤：保存按鈕按下後頁面不能被整頁 spinner 取代（那樣對話框會一起消失）。
// 追問載入失敗不能擋住保存：錯誤時仍可「略過，直接保存」。
import { useEffect, useMemo, useState } from 'react';
import { Loader2, X } from 'lucide-react';
import { profileAPI } from '../../services/api';
import { followupKey } from '../../utils/interestSelections';

const MAX_CATEGORIES_PER_REQUEST = 6; // 後端一次最多 6 個分類

function chunk(items, size) {
  const out = [];
  for (let index = 0; index < items.length; index += size) out.push(items.slice(index, index + size));
  return out;
}

const NO_INITIAL_TAG_IDS = {};

export default function InterestFollowupDialog({
  request, mode = 'save', initialTagIds = NO_INITIAL_TAG_IDS, onConfirm, onSkip, onCancel,
}) {
  const [status, setStatus] = useState('loading'); // loading | ready | error
  const [followups, setFollowups] = useState([]);
  const [checked, setChecked] = useState({});
  const [errorMessage, setErrorMessage] = useState('');

  const requestKey = useMemo(() => JSON.stringify(request), [request]);

  useEffect(() => {
    let cancelled = false;
    const { selections, ...scope } = JSON.parse(requestKey);

    // Strict Mode 的第一次 setup 會立即 cleanup，避免在這次重複送出追問。
    Promise.resolve()
      .then(() => cancelled ? [] : Promise.all(chunk(selections, MAX_CATEGORIES_PER_REQUEST).map(part => (
        profileAPI.getInterestFollowups({ ...scope, selections: part })
      ))))
      .then(results => {
        if (cancelled) return;
        const all = results.flatMap(result => result.followups ?? []);
        setFollowups(all);
        // 頁面上目前的答案優先（含還沒保存的），沒有才用已保存的答案。
        // 頁面的答案整份保留，即使某個標籤不在這次列出的選項裡，按「確定」也不會被默默丟掉。
        setChecked(Object.fromEntries(all
          .filter(item => !item.unavailable)
          .map(item => {
            const key = followupKey(item.group, item.categoryId);
            const initial = Object.hasOwn(initialTagIds, key)
              ? initialTagIds[key]
              : item.options.filter(option => option.previouslySelected).map(option => option.tagId);
            return [key, new Set(initial)];
          })));
        setStatus('ready');
      })
      .catch(error => {
        if (cancelled) return;
        setErrorMessage(error?.message || '追問暫時無法載入。');
        setStatus('error');
      });

    return () => { cancelled = true; };
  }, [requestKey, initialTagIds]);

  const toggle = (key, tagId) => {
    setChecked(prev => {
      const next = new Set(prev[key] ?? []);
      if (next.has(tagId)) next.delete(tagId);
      else next.add(tagId);
      return { ...prev, [key]: next };
    });
  };

  const confirm = () => {
    const answers = {};
    for (const item of followups) {
      if (item.unavailable) continue;
      const key = followupKey(item.group, item.categoryId);
      answers[key] = [...(checked[key] ?? [])];
    }
    onConfirm(answers);
  };

  const answerable = followups.filter(item => !item.unavailable);

  return (
    <div className="history-feedback-backdrop" role="dialog" aria-modal="true" aria-labelledby="interest-followup-title" id="interest-followup-dialog">
      <div className="history-feedback-dialog">
        <div className="history-feedback-header">
          <div>
            <h3 id="interest-followup-title">想接觸這些類別裡的哪些主題？</h3>
            <p>選的主題會讓系統在排課時優先推薦帶有這些主題的課，這是偏好，不會排除其他課。每個選項下面列的是目前候選課程裡的代表課，可以全部不選。</p>
          </div>
          <button type="button" className="history-feedback-close" aria-label="關閉" onClick={onCancel}>
            <X size={18} />
          </button>
        </div>

        <div className="history-feedback-body">
          {status === 'loading' && (
            <p className="interest-followup-loading" role="status">
              <Loader2 size={18} className="spin-animation" /> 正在整理這些類別的主題…
            </p>
          )}

          {status === 'error' && (
            <div className="search-action-notice error" role="alert">
              {errorMessage}
              {mode !== 'edit' && ' 你可以先略過細項，之後再補選。'}
            </div>
          )}

          {status === 'ready' && answerable.length === 0 && (
            <p className="interest-followup-empty">
              這些類別在你目前的候選課程裡暫時沒有可選的主題，會先只記錄你選的類別。
            </p>
          )}

          {status === 'ready' && followups.map(item => {
            const key = followupKey(item.group, item.categoryId);
            if (item.unavailable) {
              return (
                <section key={key} className="interest-followup-group">
                  <p className="interest-followup-empty">有一個類別在你目前的候選課程裡沒有可選主題，只會記錄類別。</p>
                </section>
              );
            }
            return (
              <section key={key} className="interest-followup-group" aria-label={item.categoryName}>
                <h4>{item.question}</h4>
                <p className="interest-followup-category">類別：{item.categoryName}</p>
                <div className="interest-followup-options">
                  {item.options.map(option => {
                    const isChecked = checked[key]?.has(option.tagId) === true;
                    return (
                      <label key={option.tagId} className={`interest-followup-option${isChecked ? ' selected' : ''}`}>
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => toggle(key, option.tagId)}
                        />
                        <span className="interest-followup-option-name">{option.name}</span>
                        <span className="interest-followup-option-meta">
                          會加分給 {option.courseCount} 門課
                          {option.sampleCourses?.length > 0 && `，例如：${option.sampleCourses.join('、')}`}
                        </span>
                      </label>
                    );
                  })}
                </div>
                {item.totalTagCount > item.options.length && (
                  <p className="interest-followup-more">這個類別另有 {item.totalTagCount - item.options.length} 個主題未列出。</p>
                )}
              </section>
            );
          })}
        </div>

        <div className="history-feedback-footer">
          {mode !== 'edit' ? (
            <button type="button" className="course-card-action" onClick={onSkip} id="interest-followup-skip">
              {mode === 'step' ? '先略過細項' : '略過細項並保存'}
            </button>
          ) : (
            <button type="button" className="course-card-action" onClick={onCancel}>取消</button>
          )}
          {status !== 'error' && (
            <button
              type="button"
              className="course-card-action primary"
              onClick={confirm}
              disabled={status !== 'ready'}
              id="interest-followup-confirm"
            >
              {mode === 'save' ? '確定並保存' : mode === 'step' ? '確定並繼續' : '確定細項'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
