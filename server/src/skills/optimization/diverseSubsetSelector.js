// Roadmap #10 任務 2：從各主軸候選中挑出最終要顯示的方案組合。
//
// 採用 Danna & Woodruff (2009, ORL 37:255–260) §2.2 的 D_bin 目標：
//   D_bin(S) = 2 / (|S|(|S|−1)) · Σ_{j<k} d_bin(x⁽ʲ⁾, x⁽ᵏ⁾)
//   d_bin(x, y) = (1/b) · Σ_{i∈B} |xᵢ − yᵢ|
// 並對本系統的小型受限問題以**窮舉**精確求解。這裡沒有實作論文 §3.1 的線性化整數規劃
// （式 (1)–(5)），也沒有 §4 的啟發式——線上最多 2³、benchmark 最多 4³ 種組合，窮舉即最佳。
//
// 與論文的差異（細節見 docs/SCHEDULING_LOGIC.md）：
//   - B 只取競爭課號的 z_k，不含班次變數與集中排課的日變數；只差班次的兩份方案 d_bin = 0。
//   - 每個 archetype 至多一份、S₀ 必選、兩兩 replacementDistance ≥ 2 是限制而非目標。
//   - |S| 不固定：先最大化方案數，再最大化 D_bin（D_bin 是平均值，不同 |S| 不可比）。
//
// 純函式：只看課號集合，不 materialize 方案、不碰 I/O。
import { compareCourseSets } from './diversePlanSolver.js';

export const SUBSET_SELECTION_METHOD = 'dbin-exact-enumeration';
export const SUBSET_MINIMUM_REPLACEMENT_DISTANCE = 2;
export const SUBSET_BASE_ID = 'base';

// 所有 tie-break 與輸出順序只看這份常數，不看輸入陣列的順序——否則「打亂輸入結果相同」
// 與「平手時依主軸順序」會互相矛盾。不在清單內的 archetype 排在後面，依名稱排序。
export const CANONICAL_ARCHETYPE_ORDER = Object.freeze(['easy', 'challenge', 'interest', 'compact']);

function archetypeRank(archetype) {
  const index = CANONICAL_ARCHETYPE_ORDER.indexOf(archetype);
  return index === -1 ? CANONICAL_ARCHETYPE_ORDER.length : index;
}

function compareArchetypes(left, right) {
  return archetypeRank(left) - archetypeRank(right) || String(left).localeCompare(String(right));
}

function compareIds(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

// 同主軸內 candidateId 相同者是同一個候選（同課號、同班次），只留一份；
// 排序後窮舉的走訪順序也與輸入順序無關。
function normalizeAxes(axes) {
  const byArchetype = new Map();
  for (const axis of axes || []) {
    const bucket = byArchetype.get(axis.archetype) ?? new Map();
    for (const candidate of axis.candidates || []) {
      if (typeof candidate.candidateId !== 'string' || candidate.candidateId === '') {
        throw new TypeError('selectDiverseSubset：候選缺少 candidateId');
      }
      if (!bucket.has(candidate.candidateId)) bucket.set(candidate.candidateId, candidate);
    }
    byArchetype.set(axis.archetype, bucket);
  }
  return [...byArchetype.entries()]
    .map(([archetype, bucket]) => ({
      archetype,
      candidates: [...bucket.values()].sort((a, b) => compareIds(a.candidateId, b.candidateId)),
    }))
    .sort((a, b) => compareArchetypes(a.archetype, b.archetype));
}

// 字典序比較兩個組合；回傳正值代表 left 較好。picks 與 axes 等長，null 表示該主軸不選。
function compareCombinations(left, right) {
  if (left.planCount !== right.planCount) return left.planCount - right.planCount;
  // planCount 相同時 |S| 與 b 都是常數，D_bin 的順序等同這個整數的順序——
  // 直接比整數，不用浮點容差（容差不具傳遞性，會讓結果取決於比較順序）。
  if (left.pairwiseHammingSum !== right.pairwiseHammingSum) {
    return left.pairwiseHammingSum - right.pairwiseHammingSum;
  }
  for (let index = 0; index < left.picks.length; index += 1) {
    const l = left.picks[index] !== null;
    const r = right.picks[index] !== null;
    if (l !== r) return l ? 1 : -1;
  }
  // 各主軸的比值單位不同，不能相加；只在同一條主軸內互比。
  for (let index = 0; index < left.picks.length; index += 1) {
    if (left.picks[index] === null) continue;
    const l = Number(left.picks[index].ratio) || 0;
    const r = Number(right.picks[index].ratio) || 0;
    if (l !== r) return l > r ? 1 : -1;
  }
  for (let index = 0; index < left.picks.length; index += 1) {
    if (left.picks[index] === null) continue;
    const order = compareIds(left.picks[index].candidateId, right.picks[index].candidateId);
    if (order !== 0) return -order;
  }
  return 0;
}

export function dBinFromHammingSum(pairwiseHammingSum, planCount, b) {
  if (planCount < 2) return null;
  return (2 / (planCount * (planCount - 1))) * (pairwiseHammingSum / b);
}

/**
 * @param baseSelection S₀ 的競爭課號集合（一定入選）。
 * @param axes `[{ archetype, candidates: [{ candidateId, selectedKeys: Set, ratio }] }]`
 * @param b 不重複的競爭課號數（D_bin 的分母）。
 */
export function selectDiverseSubset({ baseSelection, axes, b } = {}) {
  const base = baseSelection instanceof Set ? baseSelection : new Set(baseSelection || []);
  const normalized = normalizeAxes(axes);
  const hasCandidates = normalized.some(axis => axis.candidates.length > 0);
  if (hasCandidates && !(Number.isFinite(b) && b > 0)) {
    throw new RangeError(`selectDiverseSubset：有候選時 b 必須是正數，收到 ${b}`);
  }

  let best = null;
  let evaluated = 0;
  let feasible = 0;
  const picks = new Array(normalized.length).fill(null);
  // members 與 picks 同步維護：已放進組合的課號集合，S₀ 永遠在第一個。
  const members = [base];

  const visit = (axisIndex, pairwiseHammingSum) => {
    if (axisIndex === normalized.length) {
      evaluated += 1;
      feasible += 1;
      const combination = { picks: [...picks], planCount: members.length, pairwiseHammingSum };
      if (best === null || compareCombinations(combination, best) > 0) best = combination;
      return;
    }
    picks[axisIndex] = null;
    visit(axisIndex + 1, pairwiseHammingSum);
    for (const candidate of normalized[axisIndex].candidates) {
      let added = 0;
      let allowed = true;
      for (const member of members) {
        const distance = compareCourseSets(member, candidate.selectedKeys);
        if (distance.replacementDistance < SUBSET_MINIMUM_REPLACEMENT_DISTANCE) {
          allowed = false;
          break;
        }
        added += distance.hammingDistance;
      }
      if (!allowed) {
        // 這個前綴之下的所有組合都不可行；計入 evaluated 讓診斷數字對得上搜尋空間。
        evaluated += normalized.slice(axisIndex + 1)
          .reduce((count, axis) => count * (axis.candidates.length + 1), 1);
        continue;
      }
      picks[axisIndex] = candidate;
      members.push(candidate.selectedKeys);
      visit(axisIndex + 1, pairwiseHammingSum + added);
      members.pop();
      picks[axisIndex] = null;
    }
  };
  visit(0, 0);

  const chosen = [];
  const chosenMembers = [{ id: SUBSET_BASE_ID, keys: base }];
  normalized.forEach((axis, index) => {
    const pick = best.picks[index];
    if (!pick) return;
    chosen.push({ archetype: axis.archetype, candidateId: pick.candidateId });
    chosenMembers.push({ id: axis.archetype, keys: pick.selectedKeys });
  });

  // 第一順位是方案數，所以被捨棄主軸的每個候選加進已選組合都必然違反距離限制
  // （否則方案數會更多）——conflictsWith 因此保證非空。
  const dropped = [];
  normalized.forEach((axis, index) => {
    if (best.picks[index] || axis.candidates.length === 0) return;
    const conflicts = new Set();
    for (const candidate of axis.candidates) {
      for (const member of chosenMembers) {
        const { replacementDistance } = compareCourseSets(member.keys, candidate.selectedKeys);
        if (replacementDistance < SUBSET_MINIMUM_REPLACEMENT_DISTANCE) conflicts.add(member.id);
      }
    }
    dropped.push({
      archetype: axis.archetype,
      conflictsWith: [...conflicts].sort((left, right) => (
        left === SUBSET_BASE_ID ? -1 : right === SUBSET_BASE_ID ? 1 : compareArchetypes(left, right)
      )),
    });
  });

  return {
    chosen,
    dropped,
    objective: {
      planCount: best.planCount,
      dBin: dBinFromHammingSum(best.pairwiseHammingSum, best.planCount, b),
      pairwiseHammingSum: best.pairwiseHammingSum,
    },
    b: Number.isFinite(b) ? b : 0,
    evaluated,
    feasible,
    method: SUBSET_SELECTION_METHOD,
  };
}

export default { selectDiverseSubset };
