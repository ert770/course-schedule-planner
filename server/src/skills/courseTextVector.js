import { createHash } from 'node:crypto';
import { resolveInterestTags, interestTagCatalog } from '../data/interestTagCatalog.js';

export const COURSE_TEXT_VECTOR_VERSION = 'course-text-vector-v1';
export const COURSE_TEXT_SYLLABUS_VECTOR_VERSION = 'course-text-vector-v2';
export const COURSE_TEXT_MAX_CODE_POINTS = 1800;
const codeOf = value => String(value ?? '').trim().toUpperCase();
const clean = value => String(value ?? '').replace(/<\/?[a-z][^>]*>/giu, ' ').replace(/\s+/gu, ' ').trim();
const ordinal = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const longest = values => [...values].sort((a, b) => b.length - a.length || ordinal(a, b))[0] ?? '';

function latestSyllabusByCourse(syllabi) {
  const latest = new Map();
  for (const syllabus of Array.isArray(syllabi) ? syllabi : []) {
    const code = codeOf(syllabus.catalogCourseCode ?? syllabus.courseCode);
    const text = clean(syllabus.syllabusText);
    if (!code || !text) continue;
    const year = Number(syllabus.academicYear);
    const semester = Number(syllabus.semester);
    if (!Number.isInteger(year) || !Number.isInteger(semester)) continue;
    const rank = year * 10 + semester;
    const current = latest.get(code);
    const row = { rank, text, sourceKey: String(syllabus.sourceKey ?? '') };
    if (!current || rank > current.rank
      || (rank === current.rank && (text.length > current.text.length
        || (text.length === current.text.length && ordinal(row.sourceKey, current.sourceKey) < 0)))) {
      latest.set(code, row);
    }
  }
  return new Map([...latest].map(([code, row]) => [code, row.text]));
}

// 公開課程資訊；不含教師、使用者、成績或班次。相同穩定課號只建立一份文件。
export function buildCourseTextDocuments(courses = [], syllabi = [], { includeSyllabi = false } = {}) {
  const grouped = new Map();
  const syllabusByCourse = includeSyllabi ? latestSyllabusByCourse(syllabi) : new Map();
  for (const course of courses) {
    const code = codeOf(course.catalogCourseCode);
    if (!code) continue;
    const group = grouped.get(code) ?? { names: new Set(), descriptions: new Set(), tags: new Set() };
    group.names.add(clean(course.name));
    group.descriptions.add(clean(course.description));
    for (const tag of resolveInterestTags(course.ragTag).tags) group.tags.add(tag.canonicalName);
    grouped.set(code, group);
  }
  return [...grouped].sort(([a], [b]) => ordinal(a, b)).flatMap(([courseCode, group]) => {
    const name = longest(group.names);
    const description = longest(group.descriptions);
    const tags = [...group.tags].sort();
    const syllabusText = syllabusByCourse.get(courseCode) ?? '';
    if (!name && !description && tags.length === 0 && !syllabusText) return [];
    const textParts = [`課名：${name}`, `主題：${tags.join('、')}`, `簡介：${description}`];
    if (includeSyllabi) textParts.push(`課程大綱：${syllabusText}`);
    const fullText = textParts.join('\n');
    const points = Array.from(fullText);
    const text = points.slice(0, COURSE_TEXT_MAX_CODE_POINTS).join('');
    const textVersion = includeSyllabi ? COURSE_TEXT_SYLLABUS_VECTOR_VERSION : COURSE_TEXT_VECTOR_VERSION;
    const contentHash = createHash('sha256').update(`${textVersion}\n${text}`).digest('hex');
    return [{ courseCode, name, tags, text, contentHash, truncated: points.length > COURSE_TEXT_MAX_CODE_POINTS,
      hasDescription: Boolean(description), hasSyllabus: Boolean(syllabusText) }];
  });
}

export function normalizeDenseVector(values, dimension) {
  if (!Array.isArray(values) || values.length !== dimension || !values.every(Number.isFinite)) {
    throw new TypeError('課程文字向量維度或數值不正確');
  }
  const norm = Math.hypot(...values);
  if (!(norm > 0) || !Number.isFinite(norm)) throw new TypeError('課程文字向量範數不正確');
  return Float32Array.from(values, value => value / norm);
}

// 目錄或文件更新後，不把舊向量假裝成目前的課程表示法。
export function buildCourseTextEmbeddingIndex(courses, artifact, syllabi = []) {
  const includeSyllabi = artifact?.textVersion === COURSE_TEXT_SYLLABUS_VECTOR_VERSION;
  if (artifact?.schemaVersion !== 1
    || ![COURSE_TEXT_VECTOR_VERSION, COURSE_TEXT_SYLLABUS_VECTOR_VERSION].includes(artifact.textVersion)
    || artifact.catalogVersion !== interestTagCatalog.catalogVersion
    || !Number.isInteger(artifact.dimension) || artifact.dimension < 1 || artifact.dimension > 4096
    || typeof artifact.embeddingModel !== 'string' || !artifact.embeddingModel
    || !Number.isFinite(Date.parse(artifact.generatedAt)) || !Array.isArray(artifact.courses)) {
    throw new TypeError('課程文字向量產物的格式或目錄版本不相容');
  }
  if (includeSyllabi && (!Array.isArray(syllabi) || syllabi.length === 0)) {
    throw new TypeError('課程文字向量產物需要資料庫中的教學大綱');
  }
  const documents = new Map(buildCourseTextDocuments(courses, syllabi, { includeSyllabi })
    .map(doc => [doc.courseCode, doc]));
  const vectors = new Map();
  const seen = new Set();
  let staleCourses = 0;
  for (const row of artifact.courses) {
    const code = codeOf(row.courseCode);
    if (!code || seen.has(code)) throw new TypeError('課程文字向量產物含空課號或重複課號');
    seen.add(code);
    const vector = normalizeDenseVector(row.vector, artifact.dimension);
    const document = documents.get(code);
    if (!document || document.contentHash !== row.contentHash) { staleCourses += 1; continue; }
    vectors.set(code, vector);
  }
  return { vectors, documents, staleCourses, method: {
    representation: includeSyllabi ? 'course-text-embedding-v2' : 'course-text-embedding-v1',
    selection: 'one-per-unit-cosine', k: 5,
    embeddingModel: artifact.embeddingModel, dimension: artifact.dimension,
    catalogVersion: artifact.catalogVersion, generatedAt: artifact.generatedAt,
  } };
}

export function denseCosine(left, right) {
  if (!left || !right || left.length !== right.length) return 0;
  let dot = 0;
  for (let i = 0; i < left.length; i += 1) dot += left[i] * right[i];
  return Math.max(-1, Math.min(1, dot));
}
