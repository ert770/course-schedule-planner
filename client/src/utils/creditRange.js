// 學分範圍（2026-11-28）：最低不能低於年級下限（12，大四 9）；最高 25，超修 30。
export const CREDIT_MAX = 25;
export const OVERLOAD_CREDIT_MAX = 30;

export function creditRangeFromProfile(profile = {}) {
  const floor = Number(profile.targetCreditsMin) || 12;
  const options = profile.scheduleOptions ?? {};
  const overload = options.allowCreditOverload === true;
  const ceiling = overload ? OVERLOAD_CREDIT_MAX : CREDIT_MAX;
  const max = Math.min(options.maxCredits ?? profile.targetCreditsMax ?? CREDIT_MAX, ceiling);
  const min = Math.min(Math.max(options.minCredits ?? floor, floor), max);
  return { floor, value: { min: String(min), max: String(max), overload } };
}

export function validateCreditRange({ min, max, overload }, floor) {
  const low = Number(min);
  const high = Number(max);
  const ceiling = overload ? OVERLOAD_CREDIT_MAX : CREDIT_MAX;
  if (min === '' || max === '' || !Number.isInteger(low) || !Number.isInteger(high)) return '學分請填整數。';
  if (low < floor) return `最低學分不能低於 ${floor}。`;
  if (high > ceiling) {
    return overload ? `最高學分不能超過 ${ceiling}。` : `最高學分不能超過 ${ceiling}；已申請超修請勾選下方選項。`;
  }
  if (low > high) return '最低學分不能高於最高學分。';
  return null;
}

export function creditRangePayload({ min, max, overload }) {
  return {
    targetCreditsMax: Number(max),
    scheduleOptions: { minCredits: Number(min), maxCredits: Number(max), allowCreditOverload: overload },
  };
}
