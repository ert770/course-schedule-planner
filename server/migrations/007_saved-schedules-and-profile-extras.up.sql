-- Shared MySQL migration 007.
--
-- Design decisions:
-- 1. password_hash is intentionally not named password. This migration does not
--    copy plaintext passwords from users.json. Choosing bcrypt/argon2 and changing
--    the authentication flow is a separate task.
-- 2. watchlist and skill_tree use JSON, matching preference_tags, avoid_time, and
--    enrolled_programs already stored on User_Profiles. Separate join tables would
--    be disproportionate for the current demo-sized data.
-- 3. Saved_Schedules.user_id references the numeric User_Profiles.user_id. The
--    application-facing identity remains the student number and must be converted
--    through the existing toMysqlUserId() boundary before this table is used.

CREATE TABLE IF NOT EXISTS Saved_Schedules (
  schedule_id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  name VARCHAR(100) NOT NULL,
  schedule_json JSON NOT NULL,
  total_credits TINYINT UNSIGNED NULL,
  created_at DATETIME(3) NOT NULL,
  INDEX idx_saved_schedules_user (user_id, created_at),
  CONSTRAINT fk_saved_schedules_user
    FOREIGN KEY (user_id) REFERENCES User_Profiles(user_id)
);

ALTER TABLE User_Profiles
  ADD COLUMN must_take_courses JSON NULL,
  ADD COLUMN avoid_instructors JSON NULL,
  ADD COLUMN preferences_json JSON NULL,
  ADD COLUMN password_hash VARCHAR(255) NULL,
  ADD COLUMN watchlist JSON NULL,
  ADD COLUMN skill_tree JSON NULL,
  ADD COLUMN overall_score SMALLINT UNSIGNED NULL,
  ADD COLUMN overall_score_max SMALLINT UNSIGNED NULL;
