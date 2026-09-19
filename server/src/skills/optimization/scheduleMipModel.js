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
