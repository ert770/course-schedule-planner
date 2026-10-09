const VERSION = 1;
const STATUS_VALUES = new Set(['not_started', 'in_progress', 'completed', 'skipped']);

function storageKey(identity) {
  const userId = String(identity ?? '').trim();
  return userId ? `fcu:${userId}:ragTagInterestExploration` : null;
}

function normalizeState(value) {
  if (!value || typeof value !== 'object' || value.version !== VERSION) {
    return {
      version: VERSION,
      status: 'not_started',
      currentIndex: 0,
      courseCodes: [],
      clarifiedCategoryIds: [],
    };
  }
  const status = STATUS_VALUES.has(value.status) ? value.status : 'not_started';
  return {
    version: VERSION,
    status,
    currentIndex: Number.isInteger(value.currentIndex) && value.currentIndex >= 0
      ? value.currentIndex : 0,
    courseCodes: Array.isArray(value.courseCodes)
      ? [...new Set(value.courseCodes.map(code => String(code ?? '').trim().toUpperCase()).filter(Boolean))]
      : [],
    clarifiedCategoryIds: Array.isArray(value.clarifiedCategoryIds)
      ? [...new Set(value.clarifiedCategoryIds.map(id => String(id ?? '').trim()).filter(Boolean))]
      : [],
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
    courseCodes: [],
    clarifiedCategoryIds: [],
  });
}

export default {
  getInterestExplorationState,
  saveInterestExplorationState,
  startInterestExploration,
};
