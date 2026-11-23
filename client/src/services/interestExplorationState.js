const VERSION = 2;
const STATUS_VALUES = new Set(['not_started', 'in_progress', 'completed', 'skipped']);

function storageKey(identity) {
  const userId = String(identity ?? '').trim();
  return userId ? `fcu:${userId}:ragTagInterestExploration` : null;
}

function normalizeState(value) {
  const status = STATUS_VALUES.has(value?.status) ? value.status : 'not_started';
  const current = value?.version === VERSION;
  return {
    version: VERSION,
    status,
    currentIndex: current && Number.isInteger(value.currentIndex) && value.currentIndex >= 0
      ? value.currentIndex : 0,
    termKey: current && typeof value.termKey === 'string' ? value.termKey : '',
    pairs: current && Array.isArray(value.pairs) ? value.pairs.filter(pair => Array.isArray(pair)
      && pair.length === 2 && pair.every(card => card?.courseCode && card.representativeTags?.length)).slice(0, 3) : [],
    pending: current && value.pending && typeof value.pending.requestId === 'string'
      && value.pending.actions && typeof value.pending.actions === 'object' ? value.pending : null,
  };
}

export function getInterestExplorationState(identity) {
  const key = storageKey(identity);
  if (!key || typeof localStorage === 'undefined') {
    return normalizeState(null);
  }
  try {
    return normalizeState(JSON.parse(localStorage.getItem(key) || 'null'));
  } catch {
    return normalizeState(null);
  }
}

export function saveInterestExplorationState(identity, value) {
  const key = storageKey(identity);
  const current = getInterestExplorationState(identity);
  const state = normalizeState({ ...current, ...value });
  if (key && typeof localStorage !== 'undefined') {
    try { localStorage.setItem(key, JSON.stringify(state)); } catch { /* Storage can be disabled. */ }
  }
  return state;
}

export function startInterestExploration(identity) {
  return saveInterestExplorationState(identity, {
    status: 'in_progress',
    currentIndex: 0,
    termKey: '',
    pairs: [],
    pending: null,
  });
}

export default {
  getInterestExplorationState,
  saveInterestExplorationState,
  startInterestExploration,
};
