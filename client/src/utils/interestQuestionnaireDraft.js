// 課程主題問答 v1（ADR-027）的作答狀態，純函式，不碰 React 與 API，方便用 node --test 驗證。
//
// 名詞：
//   - 方向（direction）：`{ group, categoryId, aliasIds, title, categoryLabel, level }`，對應一筆 interestSelections。
//   - 具體主題（topic）：標籤 ID。只有使用者確認（勾選）的才寫進 tagIds，方向本身不展開（ADR-027）。
//   - 每組的作答狀態：`untouched`（還沒答）、`answered`（按了下一題）、`skipped`（按了這題先略過）。
//     還沒答與略過都沿用已保存的方向，不清舊資料；只有作答後取消勾選，才算明確移除。

export const QUESTION_GROUPS = Object.freeze(['department', 'generalEducation', 'outside']);
const LEVEL_BY_GROUP = Object.freeze({ department: 'sub', generalEducation: 'main', outside: 'main' });

export const directionKey = (group, categoryId) => `${group}|${categoryId}`;

/** 同一個方向：同一組，且分類 ID 相同或是對方的別名（併過的本系選項）。 */
export function sameDirection(left, right) {
  if (!left || !right || left.group !== right.group) return false;
  if (left.categoryId === right.categoryId) return true;
  return (left.aliasIds ?? []).includes(right.categoryId) || (right.aliasIds ?? []).includes(left.categoryId);
}

/**
 * 勾選或取消一個方向。換一組之前選的仍保留。
 * 2026-11-22 依使用者要求拿掉「每題最多 2 項」的上限（規格原本限制兩項），方向與細項都不限數量。
 */
export function toggleDirection(selected, direction) {
  if (selected.some(item => sameDirection(item, direction))) {
    return selected.filter(item => !sameDirection(item, direction));
  }
  return [...selected, direction];
}

/** 細項勾選，同樣不限數量。 */
export function toggleTopic(selectedTagIds, tagId) {
  return selectedTagIds.includes(tagId)
    ? selectedTagIds.filter(id => id !== tagId)
    : [...selectedTagIds, tagId];
}

/** 已保存的 interestSelections 轉成方向（名稱來自 stage=summary）。 */
export function savedDirectionsFrom(savedSelections = [], summary = null) {
  return savedSelections.map(selection => {
    const label = summary?.directions?.find(item => item.group === selection.group && item.categoryId === selection.categoryId);
    return {
      group: selection.group,
      categoryId: selection.categoryId,
      aliasIds: [],
      title: label?.title ?? selection.categoryId,
      categoryLabel: label?.categoryLabel ?? null,
      level: selection.level ?? LEVEL_BY_GROUP[selection.group],
      available: label?.available ?? true,
      saved: true,
    };
  });
}

/** 某組目前有效的方向：作答過用作答結果，還沒答或略過就沿用已保存的。 */
export function effectiveDirections(group, answers, savedDirections) {
  const answer = answers[group];
  if (answer?.status === 'answered') return answer.selected;
  return savedDirections.filter(direction => direction.group === group);
}

/** 依組別順序（本系、通識、系外）、組內依被選順序，列出全部有效方向。追問依這個順序挑方向。 */
export function allEffectiveDirections(answers, savedDirections) {
  return QUESTION_GROUPS.flatMap(group => effectiveDirections(group, answers, savedDirections));
}

/**
 * 追問答案還有效嗎：所依據的方向必須仍在有效方向裡（規格：上一題修改後不再包含該方向，就從摘要移除）。
 */
export function isDetailStillValid(detail, directions) {
  if (!detail?.target) return false;
  return directions.some(direction => sameDirection(direction, detail.target));
}

/**
 * 確認頁的初始內容。
 * @param input.directions 有效方向（`allEffectiveDirections()`）
 * @param input.savedSelections 已保存的 interestSelections（保留的方向帶回原本確認過的 tagIds）
 * @param input.savedTopicNames Map<tagId, name>（stage=summary 的 topics）
 * @param input.details 各組追問的答案陣列，每筆 `{ target, shown: [{ tagId, name }], selected: [tagId], skipped }`。
 *   2026-11-22 起三組各有一題追問（使用者要求），所以是陣列；舊的單一 `detail` 參數仍接受。
 * @param input.checkableTopics stage=detail 回傳的「只有一個有效細項」的方向
 * @returns `{ directions, topics }`；topics 是 `{ key, group, categoryId, tagId, name, checked }`，
 *   每個 (方向, 標籤) 一筆；畫面以 tagId 合併顯示（同一主題只算一項）。
 */
export function buildConfirmDraft({
  directions, savedSelections = [], savedTopicNames = new Map(), detail = null, details = [], checkableTopics = [],
}) {
  const topics = [];
  const seen = new Set();
  const add = (direction, tagId, name, checked) => {
    const key = `${directionKey(direction.group, direction.categoryId)}|${tagId}`;
    if (seen.has(key)) {
      if (checked) topics.find(item => item.key === key).checked = true;
      return;
    }
    seen.add(key);
    topics.push({ key, group: direction.group, categoryId: direction.categoryId, tagId, name, checked });
  };

  const validDetails = [...details, ...(detail ? [detail] : [])].filter(item => isDetailStillValid(item, directions));
  for (const direction of directions) {
    const saved = savedSelections.find(item => item.group === direction.group && item.categoryId === direction.categoryId);
    // 細項頁會預先勾好已存的標籤，所以這個方向有作答（沒按略過）時，以作答結果為準：在細項頁取消勾選的就不再保留。
    // 按略過或沒有細項頁時，已存的標籤照舊保留。
    const answered = validDetails.some(item => !item.skipped && sameDirection(direction, item.target));
    if (!answered) {
      for (const tagId of saved?.tagIds ?? []) add(direction, tagId, savedTopicNames.get(tagId) ?? tagId, true);
    }
    for (const validDetail of validDetails) {
      if (!sameDirection(direction, validDetail.target)) continue;
      // 略過追問時，看過的細項列出但預設不勾。
      for (const option of validDetail.shown) {
        add(direction, option.tagId, option.name, !validDetail.skipped && validDetail.selected.includes(option.tagId));
      }
    }
    for (const item of checkableTopics) {
      if (item.group === direction.group && item.categoryId === direction.categoryId) add(direction, item.tagId, item.name, false);
    }
  }
  return { directions, topics };
}

/** 畫面用：同一個標籤只顯示一列；勾選狀態以任一筆為準（全部一起切換）。只列還保留的方向底下的主題。 */
export function visibleTopics(draft, removedKeys) {
  const byTag = new Map();
  for (const topic of draft.topics) {
    if (removedKeys.has(directionKey(topic.group, topic.categoryId))) continue;
    const entry = byTag.get(topic.tagId);
    if (entry) entry.sources.push(topic);
    else byTag.set(topic.tagId, { tagId: topic.tagId, name: topic.name, checked: topic.checked, sources: [topic] });
  }
  return [...byTag.values()];
}

/** 切換一個標籤的勾選（同一標籤在所有方向底下一起切換）。 */
export function setTopicChecked(draft, tagId, checked) {
  return { ...draft, topics: draft.topics.map(topic => (topic.tagId === tagId ? { ...topic, checked } : topic)) };
}

/**
 * 確認並儲存：保留的方向各一筆；tagIds 只放勾選的主題。移除一個方向時，同一標籤若也被其他保留的方向確認，仍保留在那筆。
 */
export function finalizeSelections(draft, removedKeys) {
  return draft.directions
    .filter(direction => !removedKeys.has(directionKey(direction.group, direction.categoryId)))
    .map(direction => ({
      group: direction.group,
      categoryId: direction.categoryId,
      level: direction.level ?? LEVEL_BY_GROUP[direction.group],
      mode: 'followup',
      tagIds: [...new Set(draft.topics
        .filter(topic => topic.checked && topic.group === direction.group && topic.categoryId === direction.categoryId)
        .map(topic => topic.tagId))],
    }));
}

export default {
  QUESTION_GROUPS,
  directionKey,
  sameDirection,
  toggleDirection,
  toggleTopic,
  savedDirectionsFrom,
  effectiveDirections,
  allEffectiveDirections,
  isDetailStillValid,
  buildConfirmDraft,
  visibleTopics,
  setTopicChecked,
  finalizeSelections,
};
