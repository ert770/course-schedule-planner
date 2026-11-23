// 探索頁「從一門課出發」的三種相近程度（2026-11-24，使用者決定）：
//   課名、課程說明、課程主題各算一個文字向量（OpenAI，離線先算好），請求時各自算 cosine 後取平均排序。
//
// - 課程主題文字只用「主題」類標籤：工具軟體與上課方式標籤不放進去（分類同 explorationTagGate.js）。
// - 本學期課程表沒有的課（只出現在修課紀錄），只有課名向量，起點時只比課名。
// - 向量是公開課程資訊（課名、說明、主題），不含教師、使用者或成績。
import { createHash } from 'node:crypto';
import { resolveInterestTags } from '../data/interestTagCatalog.js';
import { TAG_KIND, tagKind } from './explorationTagGate.js';

export const EXPLORATION_VECTOR_VERSION = 'course-exploration-vectors-v1';
export const EXPLORATION_VECTOR_FIELDS = Object.freeze(['name', 'description', 'topic']);
export const EXPLORATION_DESCRIPTION_MAX_CODE_POINTS = 1800;

const codeOf = value => String(value ?? '').trim().toUpperCase();
const clean = value => String(value ?? '').replace(/<\/?[a-z][^>]*>/giu, ' ').replace(/\s+/gu, ' ').trim();
const ordinal = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const longest = values => [...values].filter(Boolean).sort((a, b) => b.length - a.length || ordinal(a, b))[0] ?? '';
const truncate = text => [...text].slice(0, EXPLORATION_DESCRIPTION_MAX_CODE_POINTS).join('');

export function fieldHash(model, dimension, text) {
  return createHash('sha256').update(`${model}\u0000${dimension}\u0000${text}`).digest('hex');
}

/**
 * 每個課號一份文件：`{ courseCode, source, name, texts: { name, description, topic } }`，
 * 沒有內容的欄位為 null。
 *
 * @param courses        課程表的班次（同課號多班次合併）
 * @param historyCourses `[{ courseCode, courseName }]`：修課紀錄裡、課程表沒有的課，只建課名
 */
export function buildExplorationDocuments(courses = [], historyCourses = []) {
  const grouped = new Map();
  for (const course of courses) {
    const code = codeOf(course.catalogCourseCode);
    if (!code) continue;
    const group = grouped.get(code) ?? { names: new Set(), descriptions: new Set(), tags: new Set() };
    group.names.add(clean(course.name));
    group.descriptions.add(clean(course.description));
    for (const tag of resolveInterestTags(course.ragTag).tags) {
      const kind = tagKind(tag.canonicalTagId);
      if (kind === TAG_KIND.TOOL || kind === TAG_KIND.FORMAT) continue;
      group.tags.add(tag.canonicalName);
    }
    grouped.set(code, group);
  }
  const documents = [...grouped].map(([courseCode, group]) => {
    const name = longest(group.names);
    const description = truncate(longest(group.descriptions));
    const tags = [...group.tags].sort(ordinal);
    return {
      courseCode, source: 'catalog', name,
      texts: {
        name: name || null,
        description: description || null,
        topic: tags.length > 0 ? tags.join('、') : null,
      },
    };
  });
  const known = new Set(grouped.keys());
  const historyNames = new Map();
  for (const entry of historyCourses) {
    const code = codeOf(entry.courseCode);
    const name = clean(entry.courseName);
    if (!code || !name || known.has(code)) continue;
    const names = historyNames.get(code) ?? new Set();
    names.add(name);
    historyNames.set(code, names);
  }
  for (const [courseCode, names] of historyNames) {
    const name = longest(names);
    documents.push({ courseCode, source: 'history', name, texts: { name, description: null, topic: null } });
  }
  return documents.sort((a, b) => ordinal(a.courseCode, b.courseCode));
}

export function encodeVector(values) {
  const norm = Math.hypot(...values);
  if (!(norm > 0)) throw new TypeError('向量範數不正確');
  return Buffer.from(Float32Array.from(values, value => value / norm).buffer).toString('base64');
}

export function decodeVector(base64, dimension) {
  const buffer = Buffer.from(base64, 'base64');
  const vector = new Float32Array(buffer.buffer, buffer.byteOffset, buffer.byteLength / 4);
  if (vector.length !== dimension) throw new TypeError('探索向量維度不正確');
  return Float32Array.from(vector);
}

/** 產物 → `Map<課號, { source, name, vectors: { name, description, topic } }>`。 */
export function buildExplorationVectorIndex(artifact) {
  if (artifact?.schemaVersion !== 1 || artifact.version !== EXPLORATION_VECTOR_VERSION
    || !Number.isInteger(artifact.dimension) || !Array.isArray(artifact.courses)) {
    throw new TypeError('探索向量產物的格式或版本不相容');
  }
  const entries = new Map();
  for (const row of artifact.courses) {
    const code = codeOf(row.courseCode);
    if (!code || entries.has(code)) throw new TypeError('探索向量產物含空課號或重複課號');
    const vectors = {};
    for (const field of EXPLORATION_VECTOR_FIELDS) {
      vectors[field] = row.vectors?.[field] ? decodeVector(row.vectors[field], artifact.dimension) : null;
    }
    entries.set(code, { source: row.source, name: row.name, vectors });
  }
  return {
    entries,
    method: { model: artifact.model, dimension: artifact.dimension, generatedAt: artifact.generatedAt, version: artifact.version },
  };
}

function dot(left, right) {
  let sum = 0;
  for (let i = 0; i < left.length; i += 1) sum += left[i] * right[i];
  return Math.max(-1, Math.min(1, sum));
}

/**
 * 三種相近程度。兩邊都有的欄位才比；回傳 `{ name, description, topic, score, fields }`，
 * `score` 是可比欄位的平均（三個都有時等同加總排序），沒有任何可比欄位時為 null。
 */
export function explorationSimilarity(start, candidate) {
  const parts = {};
  for (const field of EXPLORATION_VECTOR_FIELDS) {
    const left = start?.vectors?.[field];
    const right = candidate?.vectors?.[field];
    parts[field] = left && right ? dot(left, right) : null;
  }
  const values = Object.values(parts).filter(value => value !== null);
  return {
    ...parts,
    fields: values.length,
    score: values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : null,
  };
}

export default {
  EXPLORATION_VECTOR_VERSION,
  buildExplorationDocuments,
  buildExplorationVectorIndex,
  explorationSimilarity,
  encodeVector,
  decodeVector,
  fieldHash,
};
