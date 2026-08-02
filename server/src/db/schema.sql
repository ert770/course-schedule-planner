-- 課程資料表
CREATE TABLE IF NOT EXISTS courses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  code TEXT UNIQUE NOT NULL,
  instructor TEXT NOT NULL,
  department TEXT NOT NULL,
  credits INTEGER NOT NULL DEFAULT 3,
  -- 1=週一 … 7=週日。實際課程資料含週六與週日課程。
  day_of_week INTEGER NOT NULL CHECK(day_of_week BETWEEN 1 AND 7),
  start_period INTEGER NOT NULL CHECK(start_period BETWEEN 1 AND 14),
  end_period INTEGER NOT NULL CHECK(end_period BETWEEN 1 AND 14),
  location TEXT DEFAULT '',
  capacity INTEGER DEFAULT 60,
  category TEXT NOT NULL DEFAULT '選修' CHECK(category IN ('必修','選修','通識')),
  description TEXT DEFAULT '',
  syllabus TEXT DEFAULT ''
);

-- 課程評價
CREATE TABLE IF NOT EXISTS reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  course_id INTEGER NOT NULL,
  sentiment TEXT NOT NULL CHECK(sentiment IN ('positive','negative','neutral')),
  summary TEXT NOT NULL,
  keywords TEXT DEFAULT '[]',
  difficulty_rating REAL DEFAULT 3.0,
  recommend_score REAL DEFAULT 3.0,
  source TEXT DEFAULT 'manual',
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (course_id) REFERENCES courses(id)
);

-- 使用者偏好
CREATE TABLE IF NOT EXISTS user_preferences (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT UNIQUE NOT NULL,
  display_name TEXT DEFAULT '同學',
  completed_credits INTEGER DEFAULT 0,
  target_credits_min INTEGER DEFAULT 15,
  target_credits_max INTEGER DEFAULT 22,
  blocked_periods TEXT DEFAULT '[]',
  preferred_categories TEXT DEFAULT '[]',
  must_take_courses TEXT DEFAULT '[]',
  avoid_instructors TEXT DEFAULT '[]',
  prefer_compact INTEGER DEFAULT 0,
  no_morning_classes INTEGER DEFAULT 0,
  no_evening_classes INTEGER DEFAULT 0,
  preferences_json TEXT DEFAULT '{}',
  updated_at TEXT DEFAULT (datetime('now'))
);

-- 對話歷史 (短期記憶)
CREATE TABLE IF NOT EXISTS chat_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('user','assistant','system')),
  content TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

-- 已儲存的課表
CREATE TABLE IF NOT EXISTS saved_schedules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  name TEXT DEFAULT '我的課表',
  schedule_data TEXT NOT NULL,
  total_credits INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

-- 建立索引
CREATE INDEX IF NOT EXISTS idx_courses_department ON courses(department);
CREATE INDEX IF NOT EXISTS idx_courses_day ON courses(day_of_week);
CREATE INDEX IF NOT EXISTS idx_courses_category ON courses(category);
CREATE INDEX IF NOT EXISTS idx_reviews_course ON reviews(course_id);
CREATE INDEX IF NOT EXISTS idx_chat_user ON chat_history(user_id);
CREATE INDEX IF NOT EXISTS idx_schedules_user ON saved_schedules(user_id);
