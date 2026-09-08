import { validateCourseHistoryEntry } from './courseHistory.js';

const COURSE_CODE_PATTERN = /^[A-Z]{2,}\d{4}$/u;
const EMPTY_VALUES = new Set(['', '—', '-', 'X']);

function cells(line) {
  return line.split('|').slice(1, -1).map(value => value.trim());
}

function isSeparator(row) {
  return row.length > 0 && row.every(value => /^:?-{3,}:?$/u.test(value));
}

function numberOrNull(value) {
  if (EMPTY_VALUES.has(String(value ?? '').trim())) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function semesterNumber(value) {
  const text = String(value ?? '').trim();
  if (text === '1' || text === '上' || text === '上學期') return 1;
  if (text === '2' || text === '下' || text === '下學期') return 2;
  if (text === '3' || text === '暑' || text === '暑期') return 3;
  return null;
}

function requirementType(section) {
  if (/基礎|共同|體育|英文/u.test(section)) return '必修';
  if (/通識/u.test(section)) return '通識';
  if (/商管|外語|跨院|一般/u.test(section)) return '選修';
  // 「資工核心／系內」混有必修與選修，附件沒有修別欄，不能用章節名稱猜。
  return '未確認';
}

function graduationCategory(section, reportedGraduationCredits) {
  if (reportedGraduationCredits === 0) return 'nonGraduation';
  if (/通識/u.test(section)) return 'general';
  if (/商管|外語|跨院|一般/u.test(section)) return 'external';
  // 其餘課程缺少正式逐門認列表；保留 unknown，不把系內課硬判成必修或選修。
  return 'unspecified';
}

function sameEntry(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

/**
 * 將使用者提供的 Markdown 成績表轉成 User_Course_History 的 11 欄契約。
 * 回傳 warnings，讓無課號、部分認列與缺少正式分類等資料缺口不會靜默消失。
 */
export function parseCourseHistoryMarkdown(markdown, { sourceName = 'unknown' } = {}) {
  let section = '';
  let headers = null;
  const attempts = new Map();
  const warnings = [];
  let skippedWithoutCourseCode = 0;
  let duplicateRows = 0;

  for (const [lineIndex, rawLine] of String(markdown ?? '').split(/\r?\n/u).entries()) {
    const line = rawLine.trim();
    if (line.startsWith('## ')) {
      section = line.slice(3).trim();
      headers = null;
      continue;
    }
    if (!line.startsWith('|')) continue;

    const row = cells(line);
    if (row.includes('課程編碼')) {
      headers = row;
      continue;
    }
    if (!headers || isSeparator(row)) continue;

    const record = Object.fromEntries(headers.map((header, index) => [header, row[index] ?? '']));
    const courseCode = String(record['課程編碼'] ?? '').trim();
    if (!COURSE_CODE_PATTERN.test(courseCode)) {
      skippedWithoutCourseCode += 1;
      warnings.push(`${sourceName}:${lineIndex + 1} 缺少有效課號，未匯入「${record['科目'] || '未知科目'}」`);
      continue;
    }

    const academicYear = numberOrNull(record['實際修習學年']);
    const semester = semesterNumber(record['實際修習學期']);
    const credits = numberOrNull(record['實際修習學分']);
    const score = numberOrNull(record['取得學分記錄']);
    const reportedGraduationCredits = numberOrNull(record['計入畢業學分']);

    if (!Number.isInteger(academicYear) || !semester || credits === null || score === null) {
      throw new Error(
        `${sourceName}:${lineIndex + 1} ${courseCode} 缺少可匯入的學年、學期、實修學分或數字成績`
      );
    }

    if (reportedGraduationCredits === null) {
      warnings.push(`${sourceName}:${lineIndex + 1} ${courseCode} 缺少計入畢業學分，分類保留待確認`);
    } else if (reportedGraduationCredits !== 0 && reportedGraduationCredits !== credits) {
      warnings.push(
        `${sourceName}:${lineIndex + 1} ${courseCode} 實修 ${credits}、計入畢業 ${reportedGraduationCredits}；`
        + '現有 schema 只保存實修學分，部分認列留待 #23 正式規則處理'
      );
    }

    const entry = {
      academicYear,
      semester,
      courseCode,
      courseName: String(record['科目'] ?? '').trim(),
      score,
      letterGrade: null,
      credits,
      passed: score >= 60,
      requirementType: requirementType(section),
      generalEducationCategory: String(record['通識類別'] ?? '').trim() || null,
      graduationCategory: graduationCategory(section, reportedGraduationCredits),
    };
    const validation = validateCourseHistoryEntry(entry);
    if (!validation.valid || !entry.courseName) {
      throw new Error(`${sourceName}:${lineIndex + 1} ${courseCode} 不符合 courseHistory 契約`);
    }

    const key = [entry.courseCode, entry.academicYear, entry.semester].join('|');
    const existing = attempts.get(key);
    if (existing) {
      if (!sameEntry(existing, entry)) {
        throw new Error(`${sourceName}:${lineIndex + 1} 修課唯一鍵 ${key} 有互相衝突的兩筆資料`);
      }
      duplicateRows += 1;
      continue;
    }
    attempts.set(key, entry);
  }

  return {
    entries: [...attempts.values()].sort((left, right) =>
      left.academicYear - right.academicYear
      || left.semester - right.semester
      || left.courseCode.localeCompare(right.courseCode)
    ),
    warnings,
    skippedWithoutCourseCode,
    duplicateRows,
  };
}

export default { parseCourseHistoryMarkdown };
