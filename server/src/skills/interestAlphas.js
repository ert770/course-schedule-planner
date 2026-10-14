// 協同過濾與 User Embedding 構想 5.1、5.3：三個興趣模型的 α 與開關。
//
// 候選分 = 基礎分 + α_tag × 基礎分 × s_tag + α_vec × 基礎分 × s_vec + α_cf × 基礎分 × s_cf + 其他加項。
// 三個 α 的總和上限 0.9：每個 s 介於 -1～1，合計調整最多 ±90%，課程不會因興趣分數被扣到 0。
// 總和超過上限時拒絕啟動，不靜默截斷；某一項在 off／shadow 時以 0 計入，其他項不自動放大。
import { DEFAULT_TAG_INTEREST_COURSE_ALPHA } from './tagInterestRanking.js';

export const INTEREST_ALPHA_SUM_CAP = 0.9;
export const DEFAULT_VECTOR_INTEREST_ALPHA = 0.2;
export const DEFAULT_CF_INTEREST_ALPHA = 0.1;
// 階段 6 只接 shadow；active 要等 shadow 結果檢視後另外決定。
export const DEFAULT_VECTOR_INTEREST_MODE = 'shadow';

const ALPHA_EPSILON = 1e-9;

function parseAlpha(name, raw, fallback) {
  if (raw === undefined || raw === null || String(raw).trim() === '') return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new RangeError(`${name} 必須是 0～1 的數字（目前是「${raw}」）`);
  }
  return value;
}

/** 讀取三個 α；總和超過 0.9 直接拋錯。 */
export function resolveInterestAlphas(env = process.env) {
  const alphas = {
    tag: DEFAULT_TAG_INTEREST_COURSE_ALPHA,
    vec: parseAlpha('VECTOR_INTEREST_ALPHA', env.VECTOR_INTEREST_ALPHA, DEFAULT_VECTOR_INTEREST_ALPHA),
    cf: parseAlpha('CF_INTEREST_ALPHA', env.CF_INTEREST_ALPHA, DEFAULT_CF_INTEREST_ALPHA),
  };
  const sum = alphas.tag + alphas.vec + alphas.cf;
  if (sum > INTEREST_ALPHA_SUM_CAP + ALPHA_EPSILON) {
    throw new RangeError(
      `興趣模型 α 總和 ${sum.toFixed(3)} 超過上限 ${INTEREST_ALPHA_SUM_CAP}`
      + `（α_tag ${alphas.tag}、α_vec ${alphas.vec}、α_cf ${alphas.cf}）`
    );
  }
  return alphas;
}

/** `VECTOR_INTEREST_MODE`：off／shadow。active 尚未開放，拋錯而不是當成 off。 */
export function resolveVectorInterestMode(value = DEFAULT_VECTOR_INTEREST_MODE) {
  const mode = String(value ?? DEFAULT_VECTOR_INTEREST_MODE).trim().toLowerCase() || DEFAULT_VECTOR_INTEREST_MODE;
  if (mode === 'off' || mode === 'shadow') return mode;
  if (mode === 'active') {
    throw new RangeError('VECTOR_INTEREST_MODE=active 尚未開放：s_vec 目前只能 off 或 shadow');
  }
  throw new RangeError(`VECTOR_INTEREST_MODE 只接受 off 或 shadow（目前是「${value}」）`);
}

// 階段 7：協同過濾 s_cf 只能 off／shadow；active 要等構想 4.6 的門檻達到後（階段 8）才開放。
export const DEFAULT_CF_INTEREST_MODE = 'shadow';

export function resolveCfInterestMode(value = DEFAULT_CF_INTEREST_MODE) {
  const mode = String(value ?? DEFAULT_CF_INTEREST_MODE).trim().toLowerCase() || DEFAULT_CF_INTEREST_MODE;
  if (mode === 'off' || mode === 'shadow') return mode;
  if (mode === 'active') {
    throw new RangeError('CF_INTEREST_MODE=active 尚未開放：協同過濾達到啟用門檻前只能 off 或 shadow');
  }
  throw new RangeError(`CF_INTEREST_MODE 只接受 off 或 shadow（目前是「${value}」）`);
}

/** 啟動時檢查；設定錯誤就拒絕啟動。 */
export function assertInterestConfig(env = process.env) {
  resolveInterestAlphas(env);
  resolveVectorInterestMode(env.VECTOR_INTEREST_MODE);
  resolveCfInterestMode(env.CF_INTEREST_MODE);
}

export default {
  INTEREST_ALPHA_SUM_CAP,
  DEFAULT_VECTOR_INTEREST_ALPHA,
  DEFAULT_CF_INTEREST_ALPHA,
  DEFAULT_VECTOR_INTEREST_MODE,
  DEFAULT_CF_INTEREST_MODE,
  resolveInterestAlphas,
  resolveVectorInterestMode,
  resolveCfInterestMode,
  assertInterestConfig,
};
