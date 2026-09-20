// Roadmap #10 任務 1 spike：把「固定課程排完後的選修競爭」寫成 MILP。
//
// 兩層變數（設計審查 2026-09-19）：
//   s_j ∈ {0,1}  是否選班次 j（衝堂、時段、每日上限看班次）
//   z_k ∈ {0,1}  是否選課號 k（同課只選一班、系列、共同必修、日後的多樣性看課號）
//   Σ_{j∈k} s_j = z_k
//
// 固定課程（本人必修、重補修、明確指定）沿用 S₀ 已排入的班次，不進模型；
// 候選先用正式的 evaluateCoursePlacement() 對「只有固定課程」的狀態做靜態檢查
// （時段偏好、與固定課衝堂、同系列、學分），規則只有一份。
//
// 本 spike 的目標函數只用 greedy 在同一狀態下的逐課分數（不含集中度與多樣性），
// 用途是量測速度與正確性，不是正式的方案目標。

import { getTimeBlocks } from '../scheduler.js';

function formatCoefficient(value) {
  const rounded = Math.round(value * 1e6) / 1e6;
  return String(Math.abs(rounded));
}

function linearExpression(terms) {
  const parts = terms.map(({ coef, name }, index) => {
    const sign = coef < 0 ? '-' : (index === 0 ? '' : '+');
    return `${sign} ${formatCoefficient(coef)} ${name}`.trim();
  });
  const lines = [];
  for (let i = 0; i < parts.length; i += 8) lines.push(parts.slice(i, i + 8).join(' '));
  return lines.join('\n   ');
}

function slotKeys(course) {
  const keys = [];
  for (const block of getTimeBlocks(course)) {
    for (let period = block.startPeriod; period <= block.endPeriod; period += 1) {
      keys.push(`${block.dayOfWeek}:${period}`);
    }
  }
  return keys;
}

function usedDays(course) {
  return new Set(getTimeBlocks(course).map(block => block.dayOfWeek));
}

/**
 * @param inputs `generateSchedule(..., { includeMipInputs: true }).mipInputs`
 * @returns `{ lpText, columnNames, sections, stats, prefilter }`
 */
export function buildScheduleMip(inputs) {
  const explicitIds = new Set(inputs.explicitIds.map(Number));
  const prefilter = { competitive: inputs.competitive.length, blockedAgainstFixed: 0, missingCorequisite: 0 };

  const allowedCompetitive = inputs.competitive.filter(entry => {
    if (entry.placement?.allowed) return true;
    prefilter.blockedAgainstFixed += 1;
    return false;
  });
  const allowedInternships = inputs.internships.filter(entry => entry.placement?.allowed);
  const internshipsByCode = new Map();
  for (const entry of allowedInternships) {
    const code = entry.course.catalogCourseCode;
    if (!internshipsByCode.has(code)) internshipsByCode.set(code, []);
    internshipsByCode.get(code).push(entry);
  }

  // 正課需要至少一個可排的實習班次，否則在 greedy 也一定排不進去。
  const regulars = allowedCompetitive.filter(entry => {
    if (entry.course.corequisiteRole !== 'regular') return true;
    if (internshipsByCode.has(entry.course.corequisiteCode)) return true;
    prefilter.missingCorequisite += 1;
    return false;
  });
  const neededInternshipCodes = new Set(
    regulars.filter(entry => entry.course.corequisiteRole === 'regular').map(entry => entry.course.corequisiteCode)
  );

  const sections = [];
  const pushSection = (entry, kind) => {
    sections.push({ ...entry, kind, name: `s${sections.length}` });
  };
  regulars.forEach(entry => pushSection(entry, 'competitive'));
  for (const code of neededInternshipCodes) {
    internshipsByCode.get(code).forEach(entry => pushSection(entry, 'internship'));
  }

  if (sections.length === 0) {
    const requiredCredits = Math.max(0, inputs.minCredits - inputs.fixedCredits);
    return {
      status: requiredCredits > 0 ? 'infeasible' : 'no-competitive-candidates',
      reason: requiredCredits > 0
        ? `沒有可選的競爭課程，仍缺 ${requiredCredits} 學分`
        : '固定課程已滿足學分條件，但沒有可產生替代方案的競爭課程',
      lpText: null, columnNames: [], sections: [],
      stats: { sectionVars: 0, courseVars: 0, rows: 0, nonzeros: 0, slotRows: 0 },
      prefilter,
    };
  }

  const courseVars = new Map();
  for (const section of sections) {
    if (!courseVars.has(section.courseKey)) {
      courseVars.set(section.courseKey, {
        name: `z${courseVars.size}`,
        code: section.course.catalogCourseCode,
        seriesKey: section.seriesKey,
        explicit: false,
        sections: [],
      });
    }
    const courseVar = courseVars.get(section.courseKey);
    courseVar.sections.push(section);
    if (explicitIds.has(Number(section.course.id))) courseVar.explicit = true;
    section.courseVar = courseVar.name;
  }

  const rows = [];
  const addRow = (terms, sense, rhs) => {
    if (terms.length === 0) return;
    rows.push({ name: `c${rows.length}`, terms, sense, rhs });
  };

  // 班次 ↔ 課號：同一課號恰好選 0 或 1 個班次。
  for (const courseVar of courseVars.values()) {
    addRow([
      ...courseVar.sections.map(section => ({ coef: 1, name: section.name })),
      { coef: -1, name: courseVar.name },
    ], '=', 0);
  }

  // 衝堂：每個（星期, 節次）至多一個班次，涵蓋多時段課程。
  const slots = new Map();
  for (const section of sections) {
    for (const key of new Set(slotKeys(section.course))) {
      if (!slots.has(key)) slots.set(key, []);
      slots.get(key).push(section.name);
    }
  }
  for (const names of slots.values()) {
    if (names.length > 1) addRow(names.map(name => ({ coef: 1, name })), '<=', 1);
  }

  // 學分上下限（固定課學分移到右側）。
  const creditTerms = sections
    .filter(section => (section.course.credits || 0) !== 0)
    .map(section => ({ coef: section.course.credits, name: section.name }));
  addRow(creditTerms, '<=', inputs.maxCredits - inputs.fixedCredits);
  if (inputs.minCredits > inputs.fixedCredits) {
    addRow(creditTerms, '>=', inputs.minCredits - inputs.fixedCredits);
  }

  // 每日課程數上限（預設 Infinity 時不建）。
  if (Number.isFinite(inputs.maxCoursesPerDay)) {
    const fixedPerDay = new Map();
    for (const course of inputs.fixedSchedule) {
      for (const day of usedDays(course)) fixedPerDay.set(day, (fixedPerDay.get(day) ?? 0) + 1);
    }
    const byDay = new Map();
    for (const section of sections) {
      for (const day of usedDays(section.course)) {
        if (!byDay.has(day)) byDay.set(day, []);
        byDay.get(day).push(section.name);
      }
    }
    for (const [day, names] of byDay) {
      addRow(names.map(name => ({ coef: 1, name })), '<=', inputs.maxCoursesPerDay - (fixedPerDay.get(day) ?? 0));
    }
  }

  // 共同必修：正課課號 = 實習課號（任一實習班次可搭配，與 greedy 的 placeCourseWithCorequisite 相同）。
  const courseVarByCode = new Map([...courseVars.values()].map(cv => [cv.code, cv]));
  for (const courseVar of courseVars.values()) {
    const regular = courseVar.sections.find(section => section.course.corequisiteRole === 'regular');
    if (!regular) continue;
    const internshipVar = courseVarByCode.get(regular.course.corequisiteCode);
    addRow([{ coef: 1, name: courseVar.name }, { coef: -1, name: internshipVar.name }], '=', 0);
  }

  // 同系列不同學期：明確指定的課豁免（與 evaluateCoursePlacement 相同）。
  const series = new Map();
  for (const courseVar of courseVars.values()) {
    if (!courseVar.seriesKey || courseVar.explicit) continue;
    if (!series.has(courseVar.seriesKey)) series.set(courseVar.seriesKey, []);
    series.get(courseVar.seriesKey).push(courseVar.name);
  }
  for (const names of series.values()) {
    if (names.length > 1) addRow(names.map(name => ({ coef: 1, name })), '<=', 1);
  }

  const objectiveTerms = sections
    .filter(section => section.kind === 'competitive' && section.score !== 0)
    .map(section => ({ coef: section.score, name: section.name }));

  const columnNames = [...sections.map(s => s.name), ...[...courseVars.values()].map(cv => cv.name)];
  const lpText = [
    'Maximize',
    ` obj: ${objectiveTerms.length > 0 ? linearExpression(objectiveTerms) : `0 ${sections[0]?.name ?? 'z0'}`}`,
    'Subject To',
    ...rows.map(row => ` ${row.name}: ${linearExpression(row.terms)} ${row.sense} ${row.rhs}`),
    'Binary',
    ...columnNames.map(name => ` ${name}`),
    'End',
    '',
  ].join('\n');

  return {
    lpText,
    columnNames,
    sections,
    stats: {
      sectionVars: sections.length,
      courseVars: courseVars.size,
      rows: rows.length,
      nonzeros: rows.reduce((sum, row) => sum + row.terms.length, 0) + objectiveTerms.length,
      slotRows: [...slots.values()].filter(names => names.length > 1).length,
    },
    prefilter,
  };
}

export function decodeSelection(model, values) {
  return model.sections.filter(section => (values.get(section.name) ?? 0) > 0.5);
}

const epsilonEqual = (left, right) => (
  Math.abs(left - right) <= 1e-6 * Math.max(1, Math.abs(right))
);

function entryQuality(entry) {
  const structural = ['base', 'crossYearElective', 'outsideOwnDepartment']
    .reduce((sum, key) => sum + (Number(entry.scoreComponents?.[key]) || 0), 0);
  return (Number(entry.score) || 0) - structural;
}

function hierarchyTier(entry) {
  if ((Number(entry.scoreComponents?.outsideOwnDepartment) || 0) < 0) return 'outside';
  if ((Number(entry.scoreComponents?.crossYearElective) || 0) < 0) return 'cross-year';
  return 'own-year';
}

function courseSet(value) {
  return value instanceof Set ? value : new Set(value || []);
}

/**
 * 正式多方案模型。基本衝堂、班次、學分、每日上限、共同必修與系列規則
 * 與 buildScheduleMip 相同；options 再加入品質、距離、主軸與 Dinkelbach 目標。
 */
export function buildDiverseScheduleMip(inputs, options = {}) {
  if (!inputs || !inputs.basePlan?.success) {
    return { status: 'data-insufficient', reason: 'S₀ 不存在或未成功', lpText: null };
  }

  const basic = buildScheduleMip({
    ...inputs,
    minCredits: Math.max(inputs.minCredits, options.creditTarget ?? inputs.basePlan.totalCredits),
  });
  if (basic.status) return basic;

  const { sections, prefilter } = basic;
  // 不可行診斷用：暫時不加入指定的限制群組（'credit'、'replacement'、'quality'、'axis'、'rated'），
  // 只在求解器判定不可行後逐一放寬重解，找出是哪一組限制造成；正式求解一律不放寬。
  const relax = options.relax instanceof Set ? options.relax : new Set(options.relax || []);
  const explicitIds = new Set((inputs.explicitIds || []).map(Number));
  const courseVars = new Map();
  for (const section of sections) {
    if (!courseVars.has(section.courseKey)) {
      courseVars.set(section.courseKey, {
        name: section.courseVar,
        code: section.course.catalogCourseCode,
        seriesKey: section.seriesKey,
        competitive: section.kind === 'competitive',
        hierarchyTier: hierarchyTier(section),
        explicit: false,
        sections: [],
      });
    }
    const courseVar = courseVars.get(section.courseKey);
    courseVar.sections.push(section);
    if (explicitIds.has(Number(section.course.id))) courseVar.explicit = true;
  }

  const rows = [];
  const addRow = (name, terms, sense, rhs, meta = {}) => {
    const nonzero = terms.filter(term => Math.abs(term.coef) > 1e-12);
    if (nonzero.length === 0) {
      const satisfied = sense === '<=' ? 0 <= rhs : sense === '>=' ? 0 >= rhs : epsilonEqual(0, rhs);
      if (!satisfied) return { infeasible: true, reason: `${name} 沒有可用變數但要求 ${sense} ${rhs}` };
      return null;
    }
    rows.push({ name, terms: nonzero, sense, rhs, meta });
    return null;
  };

  for (const courseVar of courseVars.values()) {
    addRow(`link_${courseVar.name}`, [
      ...courseVar.sections.map(section => ({ coef: 1, name: section.name })),
      { coef: -1, name: courseVar.name },
    ], '=', 0, { type: 'section-course-link' });
  }

  const slots = new Map();
  for (const section of sections) {
    for (const key of new Set(slotKeys(section.course))) {
      if (!slots.has(key)) slots.set(key, []);
      slots.get(key).push(section.name);
    }
  }
  for (const [key, names] of slots) {
    if (names.length > 1) addRow(`slot_${rows.length}`, names.map(name => ({ coef: 1, name })), '<=', 1,
      { type: 'time-conflict', key });
  }

  const creditTerms = sections
    .filter(section => Number(section.course.credits) !== 0)
    .map(section => ({ coef: Number(section.course.credits), name: section.name }));
  const creditTarget = Math.max(inputs.minCredits, options.creditTarget ?? inputs.basePlan.totalCredits);
  const creditNeed = creditTarget - inputs.fixedCredits;
  const creditCeiling = inputs.maxCredits - inputs.fixedCredits;
  if (creditNeed > 0 && !relax.has('credit')) {
    const failure = addRow('credit_target', creditTerms, '>=', creditNeed,
      { type: 'credit-target', bound: creditTarget });
    if (failure) return { status: 'infeasible', reason: 'credit-parity-infeasible', detail: failure.reason };
  }
  addRow('credit_ceiling', creditTerms, '<=', creditCeiling,
    { type: 'credit-ceiling', bound: inputs.maxCredits });

  if (Number.isFinite(inputs.maxCoursesPerDay)) {
    const fixedPerDay = new Map();
    for (const course of inputs.fixedSchedule) {
      for (const day of usedDays(course)) fixedPerDay.set(day, (fixedPerDay.get(day) ?? 0) + 1);
    }
    const byDay = new Map();
    for (const section of sections) {
      for (const day of usedDays(section.course)) {
        if (!byDay.has(day)) byDay.set(day, []);
        byDay.get(day).push(section.name);
      }
    }
    for (const [day, names] of byDay) {
      const failure = addRow(`daily_${day}`, names.map(name => ({ coef: 1, name })), '<=',
        inputs.maxCoursesPerDay - (fixedPerDay.get(day) ?? 0),
        { type: 'daily-cap', day, bound: inputs.maxCoursesPerDay });
      if (failure) return { status: 'infeasible', reason: 'daily-cap-infeasible', detail: failure.reason };
    }
  }

  const courseVarByCode = new Map([...courseVars.values()].map(item => [item.code, item]));
  for (const courseVar of courseVars.values()) {
    const regular = courseVar.sections.find(section => section.course.corequisiteRole === 'regular');
    if (!regular) continue;
    const internshipVar = courseVarByCode.get(regular.course.corequisiteCode);
    if (!internshipVar) return { status: 'infeasible', reason: 'corequisite-infeasible', lpText: null };
    addRow(`coreq_${courseVar.name}`, [
      { coef: 1, name: courseVar.name }, { coef: -1, name: internshipVar.name },
    ], '=', 0, { type: 'corequisite' });
  }

  const series = new Map();
  for (const courseVar of courseVars.values()) {
    if (!courseVar.seriesKey || courseVar.explicit) continue;
    if (!series.has(courseVar.seriesKey)) series.set(courseVar.seriesKey, []);
    series.get(courseVar.seriesKey).push(courseVar.name);
  }
  for (const [key, names] of series) {
    if (names.length > 1) addRow(`series_${rows.length}`, names.map(name => ({ coef: 1, name })), '<=', 1,
      { type: 'series', key });
  }

  for (const [index, rawReference] of (relax.has('replacement') ? [] : (options.referenceSelections || [])).entries()) {
    const reference = courseSet(rawReference);
    const competitiveVars = [...courseVars.entries()].filter(([, item]) => item.competitive);
    const inside = competitiveVars.filter(([key]) => reference.has(key));
    const outside = competitiveVars.filter(([key]) => !reference.has(key));
    if (inside.length < 2 || outside.length < 2) {
      return { status: 'infeasible', reason: 'insufficient-difference', lpText: null };
    }
    addRow(`replace_out_${index}`, inside.map(([, item]) => ({ coef: 1, name: item.name })),
      '<=', inside.length - 2, { type: 'replacement-out', bound: 2 });
    addRow(`replace_in_${index}`, outside.map(([, item]) => ({ coef: 1, name: item.name })),
      '>=', 2, { type: 'replacement-in', bound: 2 });
  }


  // 本系優先是結構規則，不列入 87% 的偏好品質退讓。替代方案維持 S₀ 的
  // 跨年級與系外課程門數，只在各自階層內更換課程。
  if (options.hierarchyTargets && !relax.has('hierarchy')) {
    for (const tier of ['cross-year', 'outside']) {
      const terms = [...courseVars.values()]
        .filter(item => item.competitive && item.hierarchyTier === tier)
        .map(item => ({ coef: 1, name: item.name }));
      const target = Number(options.hierarchyTargets[tier]) || 0;
      const failure = addRow(`hierarchy_${tier.replace('-', '_')}`, terms, '=', target,
        { type: 'hierarchy-parity', tier, bound: target });
      if (failure) {
        return { status: 'infeasible', reason: 'hierarchy-parity-infeasible', detail: failure.reason };
      }
    }
  }

  const baselineUtility = Number(options.baselineUtility) || 0;
  const qualityScale = Math.max(1, Number(options.qualityScale) || 1);
  const qualityLossLimit = relax.has('quality')
    ? Math.max(0, Math.abs(Number(options.baselineUtility) || 0)) + 1e9
    : Math.max(0, Number(options.qualityLossLimit) || 0);
  const utilityTerms = sections
    .filter(section => section.kind === 'competitive')
    .map(section => ({ coef: entryQuality(section), name: section.name }));
  addRow('quality_loss', [{ coef: 1, name: 'd' }, ...utilityTerms], '>=', baselineUtility,
    { type: 'quality-loss', bound: qualityLossLimit });

  const axis = relax.has('axis') ? null : options.axis;
  if (axis?.type === 'interest') {
    const terms = [...courseVars.values()].filter(item => item.competitive).map(item => ({
      coef: Number(item.sections[0].interestScore || 0) - axis.threshold,
      name: item.name,
    }));
    const rhs = axis.threshold * (axis.fixedCount || 0) - (axis.fixedScoreSum || 0);
    const failure = addRow('axis_interest', terms, '>=', rhs,
      { type: 'axis-interest', bound: axis.threshold });
    if (failure) return { status: 'infeasible', reason: 'axis-threshold-infeasible', detail: failure.reason };
  }
  if (axis?.type === 'easy' || axis?.type === 'challenge') {
    const ratedVars = [...courseVars.values()].filter(
      item => item.competitive && item.sections[0].rated
    );
    const terms = ratedVars.map(item => ({
      coef: Number(item.sections[0].easyScore || 0) - axis.threshold,
      name: item.name,
    }));
    const rhs = axis.threshold * (axis.fixedRatedCount || 0) - (axis.fixedEasySum || 0);
    const sense = axis.type === 'challenge' ? '<=' : '>=';
    const thresholdFailure = addRow('axis_easiness', terms, sense, rhs,
      { type: `axis-${axis.type}`, bound: axis.threshold });
    if (thresholdFailure) return { status: 'infeasible', reason: 'axis-threshold-infeasible', detail: thresholdFailure.reason };
    // 診斷放寬評價數下限時仍保留至少 1 門有評價課，否則平均門檻會因「一門都不選」而空洞成立。
    const ratedFloor = relax.has('rated') ? 1 : axis.minRated;
    const ratedFailure = addRow('rated_floor', ratedVars.map(item => ({ coef: 1, name: item.name })),
      '>=', Math.max(0, ratedFloor - (axis.fixedRatedCount || 0)),
      { type: 'rated-floor', bound: axis.minRated });
    if (ratedFailure) return { status: 'infeasible', reason: 'rating-coverage-infeasible', detail: ratedFailure.reason };
  }

  const dayVariables = [];
  if (axis?.type === 'compact') {
    const fixedDays = new Set(inputs.fixedSchedule.flatMap(course => [...usedDays(course)]));
    for (let day = 1; day <= 7; day += 1) {
      const name = `y${day}`;
      const onDay = sections.filter(section => usedDays(section.course).has(day));
      if (fixedDays.has(day)) {
        addRow(`fixed_day_${day}`, [{ coef: 1, name }], '=', 1, { type: 'fixed-day', day });
      } else {
        for (const section of onDay) {
          addRow(`use_day_${day}_${section.name}`, [
            { coef: 1, name: section.name }, { coef: -1, name },
          ], '<=', 0, { type: 'day-use', day });
        }
        if (onDay.length > 0) {
          addRow(`day_active_${day}`, [
            { coef: 1, name }, ...onDay.map(section => ({ coef: -1, name: section.name })),
          ], '<=', 0, { type: 'day-active', day });
        } else {
          addRow(`unused_day_${day}`, [{ coef: 1, name }], '=', 0, { type: 'unused-day', day });
        }
      }
      dayVariables.push(name);
    }
    const failure = addRow('axis_compact', dayVariables.map(name => ({ coef: 1, name })),
      '<=', axis.maxDays, { type: 'axis-compact', bound: axis.maxDays });
    if (failure) return { status: 'infeasible', reason: 'axis-threshold-infeasible', detail: failure.reason };
  }

  const centroid = options.centroid instanceof Map ? options.centroid : new Map();
  const competitiveVars = [...courseVars.entries()].filter(([, item]) => item.competitive);
  const diversityTerms = competitiveVars.map(([key, item]) => ({
    coef: (1 - 2 * (centroid.get(key) ?? 0)) / Math.max(1, competitiveVars.length),
    name: item.name,
  }));
  const lambda = Math.max(0, Number(options.lambda) || 0);
  // `objective: 'quality'` 求 Dinkelbach 的初始可行解 x⁰（Trapp & Konrad Algorithm 1 允許
  // 任一可行解起步）：同一組限制下最大化使用者品質 U(z)。係數各不相同，求解遠快於
  // 多樣性目標；λ₁ 再由 x⁰ 的 N̂/D̂ 算出，取代 λ=0 那一輪近乎全平手的求解。
  const objectiveTerms = (options.objective === 'quality'
    ? utilityTerms
    : [
      ...diversityTerms,
      ...(lambda > 0 ? [{ coef: -lambda / qualityScale, name: 'd' }] : []),
    ]).filter(term => Math.abs(term.coef) > 1e-12);

  const columnNames = [
    ...sections.map(section => section.name),
    ...[...courseVars.values()].map(item => item.name),
    ...dayVariables,
    'd',
  ];
  const binaryNames = columnNames.filter(name => name !== 'd');
  const lpText = [
    'Maximize',
    ` obj: ${objectiveTerms.length ? linearExpression(objectiveTerms) : '0 d'}`,
    'Subject To',
    ...rows.map(row => ` ${row.name}: ${linearExpression(row.terms)} ${row.sense} ${row.rhs}`),
    'Bounds',
    ` 0 <= d <= ${qualityLossLimit}`,
    'Binary',
    ...binaryNames.map(name => ` ${name}`),
    'End',
    '',
  ].join('\n');

  return {
    status: 'ready', lpText, columnNames, sections, courseVars, rows,
    quality: { baselineUtility, qualityScale, qualityLossLimit, utilityTerms },
    diversity: { centroid, courseCount: competitiveVars.length },
    axis, dayVariables, prefilter,
    stats: {
      sectionVars: sections.length, courseVars: courseVars.size,
      competitiveCourseVars: competitiveVars.length,
      dayVars: dayVariables.length, continuousVars: 1, rows: rows.length,
      nonzeros: rows.reduce((sum, row) => sum + row.terms.length, 0) + objectiveTerms.length,
    },
  };
}

export function selectionCourseKeys(model, values) {
  return new Set([...model.courseVars.entries()]
    .filter(([, item]) => item.competitive && (values.get(item.name) ?? 0) > 0.5)
    .map(([key]) => key));
}

export function utilityForSelection(model, values) {
  return model.sections
    .filter(section => section.kind === 'competitive' && (values.get(section.name) ?? 0) > 0.5)
    .reduce((sum, section) => sum + entryQuality(section), 0);
}

export function rowActivity(row, values) {
  return row.terms.reduce((sum, term) => sum + term.coef * (values.get(term.name) ?? 0), 0);
}

export function collectBindingConstraints(model, values) {
  return model.rows
    .filter(row => row.meta?.type && epsilonEqual(rowActivity(row, values), row.rhs))
    .map(row => ({ id: row.name, type: row.meta.type, activity: rowActivity(row, values), bound: row.rhs }));
}
