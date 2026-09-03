import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { isMysqlConfigured, queryRows } from './mysql.js';
import { normalizeBlockedPeriods } from '../utils/periods.js';
import { normalizeDepartment, isDepartmentInput } from '../utils/text.js';
import { getAbbreviations } from '../data/departmentMapping.js';
import { tagsToFlags, extractTags } from '../data/preferenceTags.js';
import { logger } from '../utils/logger.js';
import { createTtlCache } from '../utils/ttlCache.js';
import { validateCourseHistoryEntry } from '../data/courseHistory.js';
import { normalizeAdmissionYear } from '../data/graduationRuleVersions.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(__dirname, '..', '..', 'data');

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
    catalogCourseCode: row.subid3,
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

export class CourseHistoryUnavailableError extends Error {
  constructor(message, options = {}) {
    super(message, options);
    this.name = 'CourseHistoryUnavailableError';
    this.status = 503;
    this.code = 'COURSE_HISTORY_UNAVAILABLE';
  }
}

export function mapCourseHistoryRow(row) {
  const requiredColumns = [
    'academic_year', 'semester', 'catalog_course_code', 'course_name', 'credits',
    'passed', 'requirement_type', 'graduation_category',
  ];
  const missingColumns = requiredColumns.filter(column => row[column] === null || row[column] === undefined);
  if (missingColumns.length > 0) {
    throw new CourseHistoryUnavailableError(
      `歷史修課資料格式不完整（history_id=${row.history_id ?? 'unknown'}）：缺少 ${missingColumns.join('、')}`
    );
  }
  const entry = {
    academicYear: normalizeNumber(row.academic_year),
    semester: normalizeNumber(row.semester),
    courseCode: row.catalog_course_code,
    courseName: row.course_name,
    score: row.score === null || row.score === undefined ? null : normalizeNumber(row.score),
    letterGrade: row.letter_grade ?? null,
    credits: normalizeNumber(row.credits, 0),
    passed: Number(row.passed) === 1,
    requirementType: row.requirement_type,
    generalEducationCategory: row.general_education_category ?? null,
    graduationCategory: row.graduation_category,
  };
  const validation = validateCourseHistoryEntry(entry);
  if (!validation.valid) {
    throw new CourseHistoryUnavailableError(
      `歷史修課資料格式不完整（history_id=${row.history_id ?? 'unknown'}）：缺少 ${validation.missingFields.join('、')}`
    );
  }
  return entry;
}

export async function getUserCourseHistory(identity) {
  if (!isMysqlConfigured()) {
    throw new CourseHistoryUnavailableError('歷史修課只能來自 MySQL，但目前未設定資料庫連線。');
  }
  const numericId = Number(identity?.numericId);
  if (!Number.isInteger(numericId) || numericId <= 0) {
    throw new CourseHistoryUnavailableError('缺少可對應 User_Course_History.user_id 的 numeric identity。');
  }

  try {
    const rows = await queryRows(`
      SELECT
        \`history_id\`, \`academic_year\`, \`semester\`, \`catalog_course_code\`,
        \`course_name\`, \`score\`, \`letter_grade\`, \`credits\`, \`passed\`,
        \`requirement_type\`, \`general_education_category\`, \`graduation_category\`
      FROM \`User_Course_History\`
      WHERE \`user_id\` = ?
      ORDER BY \`academic_year\`, \`semester\`, \`history_id\`
    `, [numericId]);
    return rows.map(mapCourseHistoryRow);
  } catch (err) {
    if (err instanceof CourseHistoryUnavailableError) throw err;
    throw new CourseHistoryUnavailableError('歷史修課資料暫時無法載入，請稍後再試。', { cause: err });
  }
}

// canonical ID（學號）與 `User_Profiles.user_id`（數字主鍵）的對照。
//
// canonical 是學號，但 MySQL 的 `WHERE user_id = ?` 只認數字。轉換只在這一層發生，
// 對照來源是 `users.json` 的同一列——**不做任何推測**，對不到就維持原值，
// 由 `updateMysqlUserPreference()` 的數字檢查擋下。
function buildUserIdIndex() {
  const toNumeric = new Map();
  const toStudentId = new Map();

  for (const user of readCollection('users')) {
    if (user.studentId === undefined || user.id === undefined) continue;
    toNumeric.set(String(user.studentId), String(user.id));
    toStudentId.set(String(user.id), String(user.studentId));
  }

  return { toNumeric, toStudentId };
}

// 學號 → `User_Profiles.user_id`。已經是數字時原樣回傳。
function toMysqlUserId(canonicalId) {
  const key = String(canonicalId ?? '');
  return buildUserIdIndex().toNumeric.get(key) ?? key;
}

// `User_Profiles.user_id` → 學號。對不到時維持數字，讓呼叫端看得出資料缺對照。
function toCanonicalUserId(mysqlUserId) {
  const key = String(mysqlUserId ?? '');
  return buildUserIdIndex().toStudentId.get(key) ?? key;
}

// `User_Profiles.avoid_time` 存的是時間字串（例如 ["08:00"]），但排課引擎的
// hardConstraintReason() 只認 `{ day, period }`。先前這裡原樣回傳陣列，
// 時間字串的 `bp.day` 為 undefined，比對永遠跳過，使用者設定的避開時段
// 完全不生效且沒有任何錯誤或警告。
//
// 這裡只做格式轉換，**不篩掉任何節次**——第 1～14 節都是使用者可以合法
// 避開的時段（見 `utils/periods.js` 對第 1 節歸屬的說明）。
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

// 系所對照失敗。`User_Profiles.department` 是組員的匯入資料，打錯字或用了
// A 表沒有的寫法時，`getAbbreviations()` 會回空陣列，排課的必修範圍就完全判不出來。
// 這種值不能靜默通過——它看起來是正常字串，只是所有系所比對都不會成立。
const warnedUnmappedDepartments = new Set();

function checkDepartmentMapping(department, userId) {
  if (!department || getAbbreviations(department).length > 0) return;
  if (warnedUnmappedDepartments.has(department)) return;

  warnedUnmappedDepartments.add(department);
  logger.error(
    `User_Profiles.department 對不到系所對照表（user_id=${userId}）：${JSON.stringify(department)}。`
      + '該使用者的必修範圍將無法判定。請確認系所名稱，或補進 `docs/DEPARTMENT_MAPPING.md` 的 A 表。',
    { label: 'Profile' }
  );
}

function readProfileDepartment(row) {
  const department = normalizeDepartment(row.department);
  checkDepartmentMapping(department, row.user_id);

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

// 班別（`資訊三甲`／`資訊三乙`…）的儲存位置。
//
// 資工系選課公告明文「不接受必修課程換班級的要求」，因此必修範圍必須收斂到班別
// （見 `docs/COURSE_SELECTION_RULES.md` 第八節）。
//
// **目標狀態是 `User_Profiles.class_name` 欄位。** 該表與組員共用，本專案不自行
// `ALTER TABLE`；欄位一出現，下方的 `hasUserProfileClassNameColumn()` 會偵測到，
// 讀寫自動改走 SQL，不需要再改任何程式。
//
// 欄位還沒出現前的後備順序（讀取時優先度亦同）：
//
// | 順位 | 位置 | 適用 |
// | ---: | --- | --- |
// | 1 | `User_Profiles.class_name` | 欄位存在時的唯一真相來源 |
// | 2 | `users.json` 的 `className` | demo 登入使用者（`studentId` 或 `id` 對得到） |
//
// 曾經有第 3 順位 `user_preferences.json`，用來接住「在 `User_Profiles` 裡、
// 但 `users.json` 沒有對應列」的使用者。該檔已於 2026-08-11 刪除（同一份 profile
// 存兩個檔案必然漂移），因此這種使用者的班別**無處可存**。
// `pickClassNameTarget()` 對這種情況回傳 `null`，由 `upsertByField()` 拋錯——
// 不得靜默丟棄。先前那個 bug 正是「儲存成功但值消失」。

function normalizeClassName(value) {
  const className = String(value ?? '').trim();
  return className || null;
}

// `SHOW COLUMNS` 只查一次並快取。組員新增欄位後需重啟後端才會生效
// （`npm run dev:server` 使用 `node --watch`，改動任一後端檔案即會重啟）。
let classNameColumnPromise = null;
let profileSchemaVersionColumnPromise = null;
let studentIdColumnPromise = null;
let admissionYearColumnPromise = null;

function hasUserProfileClassNameColumn() {
  if (!isMysqlConfigured()) return Promise.resolve(false);

  if (!classNameColumnPromise) {
    classNameColumnPromise = queryRows('SHOW COLUMNS FROM `User_Profiles` LIKE \'class_name\'')
      .then(rows => rows.length > 0)
      .catch(err => {
        logger.warn(`無法確認 User_Profiles.class_name 欄位是否存在：${err.message}`, { label: 'Profile' });
        return false;
      });
  }

  return classNameColumnPromise;
}

function hasUserProfileSchemaVersionColumn() {
  if (!isMysqlConfigured()) return Promise.resolve(false);

  if (!profileSchemaVersionColumnPromise) {
    profileSchemaVersionColumnPromise = queryRows(
      'SHOW COLUMNS FROM `User_Profiles` LIKE \'profile_schema_version\''
    )
      .then(rows => rows.length > 0)
      .catch(err => {
        logger.warn(
          `無法確認 User_Profiles.profile_schema_version 欄位是否存在：${err.message}`,
          { label: 'Profile' }
        );
        return false;
      });
  }

  return profileSchemaVersionColumnPromise;
}

function hasUserProfileStudentIdColumn() {
  if (!isMysqlConfigured()) return Promise.resolve(false);

  if (!studentIdColumnPromise) {
    studentIdColumnPromise = queryRows('SHOW COLUMNS FROM `User_Profiles` LIKE \'student_id\'')
      .then(rows => rows.length > 0)
      .catch(err => {
        logger.warn(`無法確認 User_Profiles.student_id 欄位是否存在：${err.message}`, { label: 'Profile' });
        return false;
      });
  }

  return studentIdColumnPromise;
}

// 入學年度（Roadmap #23 的版本化畢業規則需要它才能選對規則版本）。
//
// 與 `class_name`／`profile_schema_version`／`student_id` 同樣是選用欄位：
// `server/scripts/admissionYearMigration.js` 套用之前欄位不存在，此時
// `admissionYear` 為 null，`resolveGraduationRule()` 會退回最新一版並明確標示
// `appliedFallbackVersion`——不是靜默當成該學生的入學年度。
function hasUserProfileAdmissionYearColumn() {
  if (!isMysqlConfigured()) return Promise.resolve(false);

  if (!admissionYearColumnPromise) {
    admissionYearColumnPromise = queryRows(
      'SHOW COLUMNS FROM `User_Profiles` LIKE \'admission_year\''
    )
      .then(rows => rows.length > 0)
      .catch(err => {
        logger.warn(
          `無法確認 User_Profiles.admission_year 欄位是否存在：${err.message}`,
          { label: 'Profile' }
        );
        return false;
      });
  }

  return admissionYearColumnPromise;
}

function readClassNameOverrides() {
  const index = new Map();

  for (const user of readCollection('users')) {
    const className = normalizeClassName(user.className);
    if (!className) continue;

    if (user.studentId !== undefined) index.set(String(user.studentId), className);
    if (user.id !== undefined) index.set(String(user.id), className);
  }

  return index;
}

function applyClassNameOverride(profile, overrides) {
  // 已有值代表來自 `User_Profiles.class_name`（順位 1），不得被後備來源覆蓋。
  if (!profile || profile.className) return profile;

  const className = overrides.get(String(profile.userId));
  return className ? { ...profile, className } : profile;
}

// 寫入 `users.json` 的對應使用者。找不到對應列時回傳 false。
function writeClassNameOverride(userId, className) {
  const users = readCollection('users');
  const index = users.findIndex(user =>
    sameId(user.studentId, userId) || sameId(user.id, userId)
  );

  if (index === -1) return false;

  users[index] = { ...users[index], className: normalizeClassName(className) };
  writeCollection('users', users);
  return true;
}

function hasUsersJsonRow(userId) {
  return readCollection('users').some(user =>
    sameId(user.studentId, userId) || sameId(user.id, userId)
  );
}

// 班別要寫到哪裡。純函式，與 I/O 分離才測得到。
//
// 回傳 `null` 代表**無處可存**：這位使用者在 `User_Profiles` 裡，但該表還沒有
// `class_name` 欄位，`users.json` 也沒有他的列。這種情況必須讓寫入失敗，
// 不得回報成功——「儲存成功但值消失」正是先前那個 bug。
export function pickClassNameTarget({ isMysqlProfileWrite, hasColumn, hasUsersJsonRow: hasRow }) {
  if (isMysqlProfileWrite && hasColumn) return 'column';
  if (hasRow) return 'usersJson';
  return null;
}

async function resolveClassNameTarget(userId, isMysqlProfileWrite) {
  return pickClassNameTarget({
    isMysqlProfileWrite,
    hasColumn: isMysqlProfileWrite ? await hasUserProfileClassNameColumn() : false,
    hasUsersJsonRow: hasUsersJsonRow(userId),
  });
}

// 寫入前的 department 正規化，與 `mapUserProfileRow()` 共用同一套規則，
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

  // `avoid_time` 與偏好標籤是兩組獨立的設定，不互相推導。
  //
  // 先前這裡會在 `avoid_time` 含第 1 節時自動補上 `#不排早八` 標籤（舊決策 C）。
  // 那等於把「星期三第 1 節不要」放大成「每天都不要」，而且使用者在偏好面板上
  // 會看到一個自己沒有勾過的標籤。兩者的聯集由排課引擎在 `findHardViolations()`
  // 各自判定，不需要在讀取時合成。
  const tags = Array.isArray(preferenceTags) ? preferenceTags : [];

  return {
    id: normalizeId(row.user_id),
    // canonical 是學號，不是 `user_id`。這裡換過來之後，上層程式一律只看得到學號。
    userId: row.student_id || toCanonicalUserId(row.user_id),
    studentId: row.student_id || toCanonicalUserId(row.user_id),
    mysqlUserId: String(row.user_id),
    displayName: `User ${row.user_id}`,
    department: readProfileDepartment(row),
    gradeLevel: normalizeNumber(row.grade_level),
    // `class_name` 欄位還不存在時 row 沒有這個鍵，值為 null，
    // 由 applyClassNameOverride() 從後備來源補上。
    className: normalizeClassName(row.class_name),
    // `admission_year` 欄位還不存在時 row 沒有這個鍵 → null（＝入學年度未知），
    // 不從 gradeLevel 推導補值：那會讓「推導值」與「使用者填的值」無從區分。
    admissionYear: normalizeNumber(row.admission_year, null),
    // 校規下限 12、上限 25（見 docs/COURSE_SELECTION_RULES.md）。
    targetCreditsMin: 12,
    targetCreditsMax: normalizeNumber(row.max_credits, 25) || 25,
    blockedPeriods: normalizeAvoidTime(row.avoid_time),
    preferredCategories: tags,
    preferenceTags: tags,
    selectedTags: tags,
    mustTakeCourses: [],
    avoidInstructors: [],
    preferencesJson: {},
    storedSchemaVersion: normalizeNumber(row.profile_schema_version, 0),

    // 偏好旗標**由標籤推導**，且只展開為 true 的項目。
    //
    // 先前這裡硬寫 `preferCompact: false`、`noMorningClasses: false`，那是
    // **合成值**而非使用者存的值。合併多個 profile 來源時，這些 false 會被
    // 當成有效資料，把使用者真正勾選的 true 蓋掉——偏好因此靜默消失，
    // API 卻回報儲存成功。缺席即代表未勾選，不得補預設值。
    ...tagsToFlags(tags),
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

// 預設 60 秒。評價資料由外部爬蟲流程寫入，非本應用程式的寫入路徑，
// 因此用短 TTL 換取「同一次伺服器啟動期間資料更新後最多 60 秒可見」，
// 而不是像 `classNameColumnPromise` 那樣永久快取到重啟為止——那種模式
// 適用於不會無重啟就變動的 schema 欄位，`Course_Reviews` 不是。
const REVIEWS_CACHE_TTL_MS = Number(process.env.REVIEWS_CACHE_TTL_MS) || 60_000;

async function fetchMysqlReviewsUncached() {
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

// 排課引擎每次排課都會呼叫 `getAll('reviews')`，`reviewSearch.js` 的
// `getReviewsByCourse()`／`getSentimentSummary()` 也在同一次請求內各撈一次
// 全表。加 TTL 快取後這些呼叫在到期前共用同一份結果，不必每次都下一次全表查詢。
const getCachedMysqlReviews = createTtlCache(fetchMysqlReviewsUncached, REVIEWS_CACHE_TTL_MS);

async function getMysqlReviews() {
  return getCachedMysqlReviews();
}

async function getMysqlUserPreferences() {
  // `class_name` 只在欄位存在時才選取——直接寫進 SQL 會讓欄位尚未新增的環境
  // 整個查詢失敗，等於所有 profile 一起壞掉。
  const columns = [
    'user_id',
    'department',
    'grade_level',
    'preference_tags',
    'avoid_time',
    'max_credits',
  ];
  if (await hasUserProfileClassNameColumn()) {
    columns.push('class_name');
  }
  if (await hasUserProfileSchemaVersionColumn()) {
    columns.push('profile_schema_version');
  }
  if (await hasUserProfileStudentIdColumn()) {
    columns.push('student_id');
  }
  if (await hasUserProfileAdmissionYearColumn()) {
    columns.push('admission_year');
  }

  const rows = await queryRows(`
    SELECT ${columns.map(column => `\`${column}\``).join(', ')}
    FROM \`User_Profiles\`
    ORDER BY \`user_id\`
  `);
  // `User_Profiles` 是 profile 的**唯一**來源。先前這裡還會串接
  // `user_preferences.json` 裡沒有 MySQL 對應列的 profile——同一份資料存兩個
  // 檔案、各自演化，實測就出現過 MySQL 與 JSON 對同一個偏好給出相反答案。
  // 該檔已於 2026-08-11 刪除。
  const classNames = readClassNameOverrides();
  return rows
    .map(mapUserProfileRow)
    .map(profile => applyClassNameOverride(profile, classNames));
}

async function updateMysqlUserPreference(canonicalId, item) {
  const hasStudentId = await hasUserProfileStudentIdColumn();
  // migration 完成後直接以 student_id 查找；欄位尚未建立時才使用 users.json
  // 內的 numeric id 對照，維持 shared MySQL 的相容性。
  const userId = toMysqlUserId(canonicalId);

  // 對照不到 numeric id 就不能寫——但這代表 `users.json` 缺對照列，是資料問題，
  // 必須講出來。先前這裡靜默 `return null`，導致前端送學號時
  // **每一次 profile 寫入都被跳過**而毫無跡象。
  if (!hasStudentId && !/^\d+$/.test(String(userId))) {
    logger.warn(
      `無法把 ${JSON.stringify(canonicalId)} 對應到 User_Profiles.user_id，`
      + 'MySQL profile 未更新。請確認 `users.json` 有對應的 id 欄位。',
      { label: 'Profile' }
    );
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
  // 偏好標籤。**先前只認 `preferenceTags` 與 `preferredCategories`，而 Setup 頁送的是
  // `selectedTags`**——兩者對不上，`preference_tags` 因此從未被前端更新過，
  // 資料庫裡那筆 legacy `["#不點名"]` 才會留存至今（稽核報告 F4）。
  // `extractTags()` 三種寫法都認得，也接受只送旗標的呼叫端（例如 AI Agent）。
  const tags = extractTags(item);
  if (tags !== null) {
    updates.push('`preference_tags` = ?');
    params.push(JSON.stringify(tags));
  }

  // `avoid_time` 保存第 1～14 節，不篩掉任何節次。正規化只是把時間字串
  // （legacy 匯入格式）換算成 `{ day, period }`，讓讀寫兩端格式一致。
  if (item.blockedPeriods !== undefined || item.avoidTime !== undefined) {
    const raw = item.blockedPeriods ?? item.avoidTime ?? [];
    updates.push('`avoid_time` = ?');
    params.push(JSON.stringify(normalizeBlockedPeriods(raw)));
  }
  if (item.targetCreditsMax !== undefined || item.maxCredits !== undefined) {
    updates.push('`max_credits` = ?');
    params.push(item.targetCreditsMax ?? item.maxCredits);
  }
  // 班別。欄位一旦由組員新增就自動改走 SQL，不需要再改程式。
  if (item.className !== undefined && await hasUserProfileClassNameColumn()) {
    updates.push('`class_name` = ?');
    params.push(normalizeClassName(item.className));
  }
  if (item.schemaVersion !== undefined && await hasUserProfileSchemaVersionColumn()) {
    updates.push('`profile_schema_version` = ?');
    params.push(item.schemaVersion);
  }
  if (item.admissionYear !== undefined && await hasUserProfileAdmissionYearColumn()) {
    // **不合法的年度一律不寫，而不是寫成該值或 NULL。**
    //
    // `normalizeNumber()` 對 `0` 會回傳 `0`（0 是有限數字），寫進去就會把真實的
    // 入學年度洗掉。這不是假設性風險：實測模型在 `update_student_profile` 的
    // schema 加上 admissionYear 之後，會用 `admissionYear: 0` 當佔位值送出來。
    // 明確的 `null` 才視為「清除」，其餘不合法值直接略過並留下 log。
    const admissionYear = item.admissionYear === null
      ? null
      : normalizeAdmissionYear(item.admissionYear);

    if (item.admissionYear !== null && admissionYear === null) {
      logger.warn(
        `忽略不合法的 admissionYear（${JSON.stringify(item.admissionYear)}），既有值保持不變`,
        { label: 'Profile' }
      );
    } else {
      updates.push('`admission_year` = ?');
      params.push(admissionYear);
    }
  }

  if (updates.length === 0) {
    return null;
  }

  params.push(hasStudentId ? canonicalId : userId);
  const result = await queryRows(
    `UPDATE \`User_Profiles\` SET ${updates.join(', ')} WHERE ${hasStudentId ? '\`student_id\`' : '\`user_id\`'} = ?`,
    params
  );

  if (result.affectedRows === 0) {
    return null;
  }

  // 回傳的 profile 以 canonical（學號）為鍵，不是剛才用來 UPDATE 的數字主鍵。
  const allProfiles = await getMysqlUserPreferences();
  return allProfiles.find(profile => (
    hasStudentId
      ? sameId(profile.userId, canonicalId)
      : sameId(profile.mysqlUserId, userId)
  )) || null;
}

// 只存在於 MySQL 的資料。`server/data/` 沒有對應的 JSON 檔——課程與評價的
// 種子資料已於 2026-08-02 移除，`user_preferences.json` 於 2026-08-11 刪除
// （見 AGENTS.md 與 `services/memoryService.js` 的欄位擁有權契約）。
const MYSQL_ONLY_COLLECTIONS = new Set(['courses', 'reviews', 'user_preferences']);

// 未設定 DB_* 時，這些集合先前會靜默回傳空陣列（檔案根本不存在），
// 排課因此回報「找不到符合條件的候選課程」——看起來像篩選條件太嚴，
// 實際上是資料庫沒接上。這是最難查的一種失敗，必須明講。
//
// **寫入路徑也要擋。** `writeCollection()` 會直接建檔，若不擋，未設定資料庫時
// 存一次偏好就會把剛刪掉的 `user_preferences.json` 長回來。
function assertMysqlAvailable(collection) {
  if (MYSQL_ONLY_COLLECTIONS.has(collection) && !isMysqlConfigured()) {
    throw new Error(
      `${collection} 只能來自 MySQL，但未設定資料庫連線。`
      + '請在 `server/.env` 設定 DB_HOST、DB_USER 與 DB_NAME（見 `.env.example`）。'
    );
  }
}

async function readCollectionBySource(collection) {
  assertMysqlAvailable(collection);

  if (!usesMysql(collection)) return readCollection(collection);

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
  assertMysqlAvailable(collection);

  // D3：寫入端也正規化，否則使用者或匯入流程送進來的帶引號值會再次污染資料；
  // 型別錯誤的值則整個丟掉，不得寫進資料庫。
  let payload = collection === 'user_preferences' ? normalizeProfileForWrite(item) : item;

  const isMysqlProfileWrite = usesMysql(collection)
    && collection === 'user_preferences'
    && field === 'userId';

  // 班別的儲存位置：`User_Profiles.class_name` > `users.json`。
  // 見上方 resolveClassNameTarget() 的說明。
  //
  // 這裡不可原地 delete——`normalizeProfileForWrite()` 在不需正規化時會原樣
  // 回傳呼叫端傳進來的物件，改到它等於改到呼叫端的資料。
  if (collection === 'user_preferences' && payload?.className !== undefined) {
    const className = payload.className;
    const classNameTarget = await resolveClassNameTarget(value, isMysqlProfileWrite);

    if (classNameTarget === null) {
      // 兩個位置都沒有，班別無處可存。靜默丟棄會讓使用者以為存好了，
      // 下一次排課卻退回系所 + 年級而沒有任何跡象。
      throw new Error(
        `班別無處可存：${JSON.stringify(String(value))} 在 User_Profiles 中，`
        + '但該表沒有 class_name 欄位，`users.json` 也沒有對應列。'
        + '請先在 `users.json` 建立該使用者，或請組員為 User_Profiles 新增 class_name 欄位。'
      );
    }

    if (classNameTarget === 'usersJson') {
      // 已經存進 users.json，就從 payload 移除，避免同一個值在兩處各存一份而漂移。
      writeClassNameOverride(value, className);
      const { className: _storedInUsersJson, ...rest } = payload;
      payload = rest;
    }
    // `column` 保留在 payload 交給 SQL。
  }

  if (isMysqlProfileWrite) {
    const updated = await updateMysqlUserPreference(value, payload);
    if (updated) return updated;

    // `User_Profiles` 沒有這一列。先前這裡會落回本機 `user_preferences.json`，
    // 於是同一位使用者的 profile 同時存在兩處並各自演化。該檔已刪除，
    // 現在直接拋錯——寫不進去就要講出來，不得回報成功。
    throw new Error(
      `更新 User_Profiles 失敗：找不到 ${JSON.stringify(String(value))} 對應的資料列。`
    );
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

export default {
  getAll, getById, query, insert, update, upsertByField, remove, clearCollection,
  getUserCourseHistory,
};
