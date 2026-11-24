// Pure preview planner: no database, session, consent or writes. Callers must
// supply only rows belonging to the authenticated user. Not an import endpoint.
const REQUIREMENT_TYPES = new Set(['必修', '選修']);
const GRADUATION_CATEGORIES = new Set(['required', 'elective', 'general', 'external', 'unspecified', 'nonGraduation']);
const isText = (value, max) => typeof value === 'string' && value.trim().length > 0 && value.trim().length <= max;
const key = row => JSON.stringify([row.courseCode, row.academicYear, row.semester]);
const fields = ['courseCode', 'courseName', 'academicYear', 'semester', 'credits', 'score', 'letterGrade', 'passed', 'requirementType', 'generalEducationCategory', 'graduationCategory', 'sourceCreditRecord'];
const equals = (a, b) => fields.every(field => (a[field] ?? null) === (b[field] ?? null));

export function validateImportEntry(row) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return ['invalid_entry'];
  const errors = [];
  if ('userId' in row || 'user_id' in row || 'numericId' in row) errors.push('identity_not_allowed');
  if (!isText(row.courseCode, 45) || !/^[A-Z0-9]+$/.test(row.courseCode)) errors.push('course_code_invalid');
  if (!isText(row.courseName, 255)) errors.push('course_name_invalid');
  if (!Number.isInteger(row.academicYear) || row.academicYear < 1 || row.academicYear > 65535) errors.push('academic_year_invalid');
  if (![1, 2, 3].includes(row.semester)) errors.push('semester_invalid');
  if (typeof row.credits !== 'number' || !Number.isFinite(row.credits) || row.credits < 0 || row.credits > 999.9 || Math.abs(row.credits * 10 - Math.round(row.credits * 10)) > 1e-8) errors.push('credits_invalid');
  if (row.score !== null && (typeof row.score !== 'number' || !Number.isFinite(row.score) || row.score < 0 || row.score > 100 || Math.abs(row.score * 100 - Math.round(row.score * 100)) > 1e-8)) errors.push('score_unconfirmed_or_invalid');
  if (Array.isArray(row.conflictingRows) && row.conflictingRows.length) errors.push('conflict_requires_review');
  if (row.sourceCreditRecord != null && (typeof row.sourceCreditRecord !== 'string' || row.sourceCreditRecord.length > 255)) errors.push('source_credit_record_invalid');
  if (row.letterGrade != null && (typeof row.letterGrade !== 'string' || row.letterGrade.length > 10)) errors.push('letter_grade_invalid');
  if (typeof row.passed !== 'boolean') errors.push('pass_status_unconfirmed');
  if (!REQUIREMENT_TYPES.has(row.requirementType)) errors.push('requirement_type_unconfirmed');
  if (!GRADUATION_CATEGORIES.has(row.graduationCategory)) errors.push('graduation_category_unconfirmed');
  if (row.generalEducationCategory != null && (typeof row.generalEducationCategory !== 'string' || row.generalEducationCategory.length > 32)) errors.push('general_category_invalid');
  return errors;
}

/** Preview only. Never overwrites existing records, including conflicts. */
export function planCourseHistoryImport(entries, existingRows) {
  if (!Array.isArray(entries) || !Array.isArray(existingRows) || entries.length > 1000) throw new TypeError('invalid import input');
  const existing = new Map();
  for(const row of existingRows)for(const code of new Set([row.courseCode,row.sourceCourseCode].filter(Boolean))){const k=key({...row,courseCode:code});const list=existing.get(k)??[];list.push(row);existing.set(k,list);}
  const incoming = new Map();
  const results = entries.map((row, index) => {
    const errors = validateImportEntry(row);
    if (errors.length) return { index, status: 'invalid', errors };
    const attempt = key(row);
    const prior = incoming.get(attempt);
    if (prior) {
      if (equals(prior.row, row)) return { index, status: 'duplicate_input', originalIndex: prior.index };
      // Invalidate the first occurrence too: do not silently pick a winner.
      return { index, status: 'conflict_input', originalIndex: prior.index };
    }
    incoming.set(attempt, { row, index });
    const candidates = existing.get(attempt)??[];
    if(candidates.length===0)return {index,status:'new'};
    // Match on either identifier, but never silently choose between distinct attempts.
    const current=candidates[0];
    const equivalent={...current,courseCode:row.courseCode};
    return { index, status: candidates.length===1 && equals(equivalent, row) ? 'duplicate_existing' : 'conflict_existing' };
  });
  for (const item of results) {
    if (item.status === 'conflict_input') {
      const first = results[item.originalIndex];
      first.status = 'conflict_input';
      for (const other of results) if (other.originalIndex === item.originalIndex) other.status = 'conflict_input';
    }
  }
  return { items: results, counts: results.reduce((out, item) => ({ ...out, [item.status]: (out[item.status] ?? 0) + 1 }), {}) };
}
