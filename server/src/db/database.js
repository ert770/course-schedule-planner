import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { isMysqlConfigured, queryRows } from './mysql.js';
import { normalizeBlockedPeriods } from '../utils/periods.js';
import { normalizeDepartment, isDepartmentInput } from '../utils/text.js';
import { logger } from '../utils/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.join(__dirname, '..', '..', 'data');

const MYSQL_COLLECTIONS = new Set(['courses', 'reviews', 'user_preferences']);

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function getFilePath(collection) {
  return path.join(DATA_DIR, `${collection}.json`);
}

function readCollection(collection) {
  const filePath = getFilePath(collection);
  if (!fs.existsSync(filePath)) {
    return [];
  }
  const raw = fs.readFileSync(filePath, 'utf-8');
  return JSON.parse(raw);
}

function writeCollection(collection, data) {
  const filePath = getFilePath(collection);
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

function usesMysql(collection) {
  return isMysqlConfigured() && MYSQL_COLLECTIONS.has(collection);
}

function parseJson(value, fallback) {
  if (value === null || value === undefined || value === '') {
    return fallback;
  }
  if (typeof value === 'object') {
    return value;
  }
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function normalizeNumber(value, fallback = null) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : fallback;
}

function normalizeId(value) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : value;
}

function sameId(left, right) {
  return String(left) === String(right);
}

function parseTimeFromBitmask(timeBitmask) {
  if (!timeBitmask || typeof timeBitmask !== 'string') {
    return null;
  }

  const mask = timeBitmask.replace(/[^01]/g, '');
  if (!mask.includes('1')) {
    return null;
  }

  const periodsPerDay = 14;
  const activeSlots = [...mask]
    .map((bit, index) => {
      if (bit !== '1') return null;
      return {
        day: Math.floor(index / periodsPerDay) + 1,
        period: (index % periodsPerDay) + 1,
      };
    })
    .filter(slot => slot && slot.day >= 1 && slot.day <= 7);

  if (activeSlots.length === 0) {
    return null;
  }

  const countsByDay = activeSlots.reduce((counts, slot) => {
    counts.set(slot.day, (counts.get(slot.day) || 0) + 1);
    return counts;
  }, new Map());

  const [dayOfWeek] = [...countsByDay.entries()]
    .sort((a, b) => b[1] - a[1] || a[0] - b[0])[0];
  const periods = activeSlots
    .filter(slot => slot.day === dayOfWeek)
    .map(slot => slot.period);

  return {
    dayOfWeek,
    startPeriod: Math.min(...periods),
    endPeriod: Math.max(...periods),
  };
}

const CHINESE_DAY_TO_NUMBER = {
  一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 7, 天: 7,
};

// 學校課程系統的實際格式為 `(二)06-08`，同一門課可能有多個時段，
// 以空白分隔，例如 `(四)01-04 (四)06-09 (五)01-04`。
// 節次 `00` 代表尚未排定，視為無效。
function parseTimeBlocks(timeStr) {
  if (!timeStr || typeof timeStr !== 'string') {
    return [];
  }

  const blocks = [];
  const pattern = /[(（]\s*([一二三四五六日天])\s*[)）]\s*(\d{1,2})(?:\s*[-~]\s*(\d{1,2}))?/gu;

  for (const match of timeStr.matchAll(pattern)) {
    const dayOfWeek = CHINESE_DAY_TO_NUMBER[match[1]];
    const startPeriod = Number(match[2]);
    const endPeriod = match[3] === undefined ? startPeriod : Number(match[3]);

    if (!dayOfWeek || !startPeriod || !endPeriod) continue;
    if (startPeriod > endPeriod) continue;

    blocks.push({ dayOfWeek, startPeriod, endPeriod });
  }

  return blocks;
}

function parseTimeFromText(timeStr) {
  if (!timeStr || typeof timeStr !== 'string') {
    return null;
  }

  const blocks = parseTimeBlocks(timeStr);
  if (blocks.length > 0) {
    // 目前的課程資料模型只容納單一時段，先取第一段並保留完整清單，
    // 供後續支援多時段衝堂判定時使用。
    return { ...blocks[0], timeBlocks: blocks };
  }

  const normalized = timeStr.trim();
  const dayPatterns = [
    { dayOfWeek: 1, patterns: [/星期一/u, /週一/u, /周一/u, /禮拜一/u, /\bmon(?:day)?\b/i, /\bM\b/] },
    { dayOfWeek: 2, patterns: [/星期二/u, /週二/u, /周二/u, /禮拜二/u, /\btue(?:sday)?\b/i, /\bT\b/] },
    { dayOfWeek: 3, patterns: [/星期三/u, /週三/u, /周三/u, /禮拜三/u, /\bwed(?:nesday)?\b/i, /\bW\b/] },
    { dayOfWeek: 4, patterns: [/星期四/u, /週四/u, /周四/u, /禮拜四/u, /\bthu(?:rsday)?\b/i, /\bR\b/] },
    { dayOfWeek: 5, patterns: [/星期五/u, /週五/u, /周五/u, /禮拜五/u, /\bfri(?:day)?\b/i, /\bF\b/] },
  ];

  const dayMatch = dayPatterns.find(day =>
    day.patterns.some(pattern => pattern.test(normalized))
  );
  const rangeMatch = normalized.match(/(?:第\s*)?(\d{1,2})\s*(?:-|~|到|至)\s*(\d{1,2})\s*(?:節)?/u);
  const singleMatch = normalized.match(/(?:第\s*)?(\d{1,2})\s*(?:節)/u);

  if (!dayMatch || (!rangeMatch && !singleMatch)) {
    return null;
  }

  const startPeriod = normalizeNumber(rangeMatch?.[1] || singleMatch?.[1]);
  const endPeriod = normalizeNumber(rangeMatch?.[2] || singleMatch?.[1]);
  if (!startPeriod || !endPeriod) {
    return null;
  }

  return {
    dayOfWeek: dayMatch.dayOfWeek,
    startPeriod,
    endPeriod,
  };
}

function parseSectionTime(row) {
  return parseTimeFromText(row.time_str) || parseTimeFromBitmask(row.time_bitmask) || {
    dayOfWeek: null,
    startPeriod: null,
    endPeriod: null,
    timeBlocks: [],
  };
}

function mapCourseRow(row) {
  const time = parseSectionTime(row);
  const credits = normalizeNumber(row.credits, 0);

  return {
    id: normalizeId(row.section_id),
    sectionId: normalizeId(row.section_id),
    courseId: row.course_id,
    code: row.course_id,
    name: row.name,
    instructor: row.teacher,
    teacher: row.teacher,
    department: row.dept,
    credits,
    dayOfWeek: time.dayOfWeek,
    timeBlocks: time.timeBlocks || [],
    startPeriod: time.startPeriod,
    endPeriod: time.endPeriod,
    location: row.room,
    room: row.room,
    capacity: null,
    currentAmount: normalizeNumber(row.current_amount, 0),
    category: row.type,
    type: row.type,
    description: row.rag_context || '',
    syllabus: row.rag_context || '',
    subid3: row.subid3,
    year: normalizeNumber(row.year),
    semester: row.semester,
    timeStr: row.time_str,
    timeBitmask: row.time_bitmask,
    ragTag: parseJson(row.rag_tag, []),
    selectionCode: row.selection_code,
  };
}

// Course_Reviews 的評分欄位皆為 1~5 的整數且無空值，因此情緒可由整體評分直接判定，
// 不需再從標籤文字猜測。
function sentimentFromOverall(overall) {
  const score = Number(overall);
  if (!Number.isFinite(score)) return 'neutral';
  if (score >= 4) return 'positive';
  if (score <= 2) return 'negative';
  return 'neutral';
}

// Reviews_tags 為逗號分隔的文字標籤，例如「人很少,沒作業,兩個報告」。
function parseReviewTags(tags) {
  return String(tags || '')
    .split(/[,、，]/)
    .map(tag => tag.trim())
    .filter(Boolean);
}

function mapReviewRow(row) {
  const overall = normalizeNumber(row.overall);
  const workload = normalizeNumber(row.workload);

  return {
    id: normalizeId(row.Reviews_id),
    // 評價以 selection_code 關聯 section，courseId 對應 course.id（即 section_id）。
    courseId: normalizeId(row.section_id),
    selectionCode: row.selection_code,
    sentiment: sentimentFromOverall(overall),
    summary: row.Review_content,
    keywords: parseReviewTags(row.Reviews_tags),

    // 原始評分，供排課引擎與畢業建議直接使用
    sweetness: normalizeNumber(row.sweetness),
    coolness: normalizeNumber(row.coolness),
    workload,
    value: normalizeNumber(row.value),
    overall,
    reviewCount: normalizeNumber(row.review_count),

    // 相容既有消費端：難度取作業量，推薦度取整體評分
    difficultyRating: workload,
    recommendScore: overall,

    source: row.source || 'mysql',
    url: row.url || null,
    createdAt: row.scraped_at || null,
  };
}

// `User_Profiles.avoid_time` 存的是時間字串（例如 ["08:00"]），但排課引擎的
// hardConstraintReason() 只認 `{ day, period }`。先前這裡原樣回傳陣列，
// 時間字串的 `bp.day` 為 undefined，比對永遠跳過，
// 使用者設定的避開時段完全不生效且沒有任何錯誤或警告。
function normalizeAvoidTime(avoidTime) {
  return normalizeBlockedPeriods(
    parseJson(avoidTime, []),
    entry => logger.warn(`無法解析的封鎖時段：${JSON.stringify(entry)}`, { label: 'Profile' })
  );
}

// D3：`User_Profiles.department` 存的是 `'資訊工程學系'`——包含字面單引號字元。
// 帶引號的值會讓畢業建議的系所比對、前端系所下拉選單與 `#13` 的系所對照全部失敗，
// 且不會有任何錯誤。讀取時正規化，並在第一次遇到髒值時警告，不得靜默修正。
// 去重鍵是「user_id + 原始值」而不是只有 user_id。
// 只用 user_id 的話，同一位使用者第一次髒值警告過後，之後**任何**髒值都會被
// 靜默修正——匯入流程若持續寫回帶引號的值，整個行程生命週期只會留下一行日誌，
// 看不出上游還在壞、也看不出影響多少筆。
const warnedDepartmentValues = new Set();
let normalizedDepartmentCount = 0;

function readProfileDepartment(row) {
  const department = normalizeDepartment(row.department);

  if (department === row.department) {
    return department;
  }

  normalizedDepartmentCount += 1;
  const fingerprint = `${row.user_id}|${String(row.department)}`;

  // 相同的髒值只警告一次（避免每次請求刷版面），但累計次數照計，
  // 讓日誌能回答「上游是不是還在持續寫入髒資料」。
  if (!warnedDepartmentValues.has(fingerprint)) {
    warnedDepartmentValues.add(fingerprint);
    logger.warn(
      `User_Profiles.department 需正規化（user_id=${row.user_id}）：`
        + `${JSON.stringify(row.department)} -> ${JSON.stringify(department)}`
        + `；本行程累計正規化 ${normalizedDepartmentCount} 次、相異髒值 ${warnedDepartmentValues.size} 種`,
      { label: 'Profile' }
    );
  }

  return department;
}

// 本機 JSON 檔的 profile 不經過 mapUserProfileRow，仍走同一套正規化，
// 避免依資料來源不同而有兩種 department 值。
function normalizeProfileDepartment(profile) {
  if (!profile || profile.department === undefined) {
    return profile;
  }

  const department = normalizeDepartment(profile.department);
  return department === profile.department ? profile : { ...profile, department };
}

// 寫入端：型別錯誤的 department 不得寫進資料庫。
// 正規化不是型別轉換層——`{}`、`[...]`、`123` 會變成看起來正常的字串，
// 寫進去之後在資料庫與 API 回應中都像一般值，但所有系所比對都會失敗。
// API 層會先擋下並回 400；這裡是最後一道防線，避免其他呼叫路徑繞過檢查。
function normalizeProfileForWrite(item) {
  if (!item || item.department === undefined) {
    return item;
  }

  if (!isDepartmentInput(item.department)) {
    logger.warn(
      `忽略無效的 department 寫入值（型別 ${typeof item.department}）：`
        + `${JSON.stringify(item.department)}`,
      { label: 'Profile' }
    );
    const { department: _invalid, ...rest } = item;
    return rest;
  }

  return normalizeProfileDepartment(item);
}

function mapUserProfileRow(row) {
  const preferenceTags = parseJson(row.preference_tags, []);
  const completedCourses = parseJson(row.completed_courses, []);

  return {
    id: normalizeId(row.user_id),
    userId: String(row.user_id),
    displayName: `User ${row.user_id}`,
    department: readProfileDepartment(row),
    gradeLevel: normalizeNumber(row.grade_level),
    completedCredits: 0,
    completedCourseIds: Array.isArray(completedCourses) ? completedCourses : [],
    // 校規下限 12、上限 25（見 docs/COURSE_SELECTION_RULES.md）。
    targetCreditsMin: 12,
    targetCreditsMax: normalizeNumber(row.max_credits, 25) || 25,
    blockedPeriods: normalizeAvoidTime(row.avoid_time),
    preferredCategories: Array.isArray(preferenceTags) ? preferenceTags : [],
    preferenceTags: Array.isArray(preferenceTags) ? preferenceTags : [],
    mustTakeCourses: [],
    avoidInstructors: [],
    preferCompact: false,
    noMorningClasses: false,
    noEveningClasses: false,
    preferencesJson: {},
  };
}

async function getMysqlCourses() {
  const rows = await queryRows(`
    SELECT
      cs.\`section_id\`,
      c.\`course_id\`,
      c.\`name\`,
      c.\`credits\`,
      c.\`type\`,
      c.\`dept\`,
      c.\`subid3\`,
      cs.\`teacher\`,
      cs.\`room\`,
      cs.\`time_str\`,
      cs.\`time_bitmask\`,
      cs.\`year\`,
      cs.\`semester\`,
      cs.\`current_amount\`,
      cs.\`rag_context\`,
      cs.\`rag_tag\`,
      cs.\`selection_code\`
    FROM \`Course_Sections\` cs
    -- Courses.course_id 與 Course_Sections.course_id 的 collation 不同，直接用 =
    -- 比較會拋出 ER_CANT_AGGREGATE_2COLLATIONS。這裡是代碼精確匹配，因此用
    -- BINARY 比較避開 collation 差異。
    INNER JOIN \`Courses\` c
      ON BINARY c.\`course_id\` = BINARY cs.\`course_id\`
    ORDER BY cs.\`year\` DESC, cs.\`semester\`, c.\`course_id\`, cs.\`section_id\`
  `);
  return rows.map(mapCourseRow);
}

async function getMysqlReviews() {
  // 評價資料表為 `Course_Reviews`（單數），以 selection_code 關聯 Course_Sections。
  // 舊程式碼查的 `Courses_Reviews` 並不存在，且欄位結構完全不同。
  const rows = await queryRows(`
    SELECT
      r.\`Reviews_id\`,
      r.\`selection_code\`,
      cs.\`section_id\`,
      r.\`Reviews_tags\`,
      r.\`Review_content\`,
      r.\`sweetness\`,
      r.\`coolness\`,
      r.\`workload\`,
      r.\`value\`,
      r.\`overall\`,
      r.\`review_count\`,
      r.\`source\`,
      r.\`url\`,
      r.\`scraped_at\`
    FROM \`Course_Reviews\` r
    LEFT JOIN \`Course_Sections\` cs
      ON BINARY cs.\`selection_code\` = BINARY r.\`selection_code\`
    ORDER BY r.\`Reviews_id\`
  `);
  return rows.map(mapReviewRow);
}

async function getMysqlUserPreferences() {
  const rows = await queryRows(`
    SELECT
      \`user_id\`,
      \`department\`,
      \`grade_level\`,
      \`preference_tags\`,
      \`avoid_time\`,
      \`completed_courses\`,
      \`max_credits\`
    FROM \`User_Profiles\`
    ORDER BY \`user_id\`
  `);
  const mysqlProfiles = rows.map(mapUserProfileRow);
  const localProfiles = readCollection('user_preferences');
  const mysqlUserIds = new Set(mysqlProfiles.map(profile => String(profile.userId)));
  return [
    ...mysqlProfiles,
    ...localProfiles
      .filter(profile => !mysqlUserIds.has(String(profile.userId)))
      .map(normalizeProfileDepartment),
  ];
}

async function updateMysqlUserPreference(userId, item) {
  if (!/^\d+$/.test(String(userId))) {
    return null;
  }

  const updates = [];
  const params = [];

  // `department` 為 NOT NULL，型別錯誤或空字串一律不寫（見 normalizeProfileForWrite）。
  if (isDepartmentInput(item.department)) {
    updates.push('`department` = ?');
    params.push(normalizeDepartment(item.department));
  }
  if (item.gradeLevel !== undefined || item.grade_level !== undefined) {
    updates.push('`grade_level` = ?');
    params.push(item.gradeLevel ?? item.grade_level);
  }
  if (item.preferenceTags !== undefined || item.preferredCategories !== undefined) {
    updates.push('`preference_tags` = ?');
    params.push(JSON.stringify(item.preferenceTags ?? item.preferredCategories ?? []));
  }
  if (item.blockedPeriods !== undefined || item.avoidTime !== undefined) {
    updates.push('`avoid_time` = ?');
    params.push(JSON.stringify(item.blockedPeriods ?? item.avoidTime ?? []));
  }
  if (item.completedCourseIds !== undefined || item.completedCourses !== undefined) {
    updates.push('`completed_courses` = ?');
    params.push(JSON.stringify(item.completedCourseIds ?? item.completedCourses ?? []));
  }
  if (item.targetCreditsMax !== undefined || item.maxCredits !== undefined) {
    updates.push('`max_credits` = ?');
    params.push(item.targetCreditsMax ?? item.maxCredits);
  }

  if (updates.length === 0) {
    return null;
  }

  params.push(userId);
  const result = await queryRows(
    `UPDATE \`User_Profiles\` SET ${updates.join(', ')} WHERE \`user_id\` = ?`,
    params
  );

  if (result.affectedRows === 0) {
    return null;
  }

  const allProfiles = await getMysqlUserPreferences();
  return allProfiles.find(profile => sameId(profile.userId, userId)) || null;
}

async function readCollectionBySource(collection) {
  if (!usesMysql(collection)) {
    const data = readCollection(collection);
    return collection === 'user_preferences' ? data.map(normalizeProfileDepartment) : data;
  }

  if (collection === 'courses') return getMysqlCourses();
  if (collection === 'reviews') return getMysqlReviews();
  if (collection === 'user_preferences') return getMysqlUserPreferences();

  return readCollection(collection);
}

export async function getAll(collection) {
  return readCollectionBySource(collection);
}

export async function getById(collection, id) {
  const data = await readCollectionBySource(collection);
  return data.find(item => sameId(item.id, id)) || null;
}

export async function query(collection, filterFn) {
  const data = await readCollectionBySource(collection);
  return data.filter(filterFn);
}

export async function insert(collection, item) {
  const data = readCollection(collection);
  const maxId = data.reduce((max, d) => Math.max(max, normalizeNumber(d.id, 0) || 0), 0);
  const newItem = { id: maxId + 1, ...item };
  data.push(newItem);
  writeCollection(collection, data);
  return newItem;
}

export async function update(collection, id, updates) {
  const data = readCollection(collection);
  const index = data.findIndex(item => sameId(item.id, id));
  if (index === -1) return null;
  data[index] = { ...data[index], ...updates };
  writeCollection(collection, data);
  return data[index];
}

export async function upsertByField(collection, field, value, item) {
  // D3：寫入端也正規化，否則使用者或匯入流程送進來的帶引號值會再次污染資料；
  // 型別錯誤的值則整個丟掉，不得寫進資料庫。
  const payload = collection === 'user_preferences' ? normalizeProfileForWrite(item) : item;

  if (usesMysql(collection) && collection === 'user_preferences' && field === 'userId') {
    const updated = await updateMysqlUserPreference(value, payload);
    if (updated) return updated;
  }

  const data = readCollection(collection);
  const index = data.findIndex(d => sameId(d[field], value));
  if (index === -1) {
    const maxId = data.reduce((max, d) => Math.max(max, normalizeNumber(d.id, 0) || 0), 0);
    const newItem = { id: maxId + 1, ...payload };
    data.push(newItem);
    writeCollection(collection, data);
    return newItem;
  }
  data[index] = { ...data[index], ...payload };
  writeCollection(collection, data);
  return data[index];
}

export async function remove(collection, id) {
  const data = readCollection(collection);
  const filtered = data.filter(item => !sameId(item.id, id));
  writeCollection(collection, filtered);
  return filtered.length < data.length;
}

export async function clearCollection(collection) {
  writeCollection(collection, []);
}

export default { getAll, getById, query, insert, update, upsertByField, remove, clearCollection };
