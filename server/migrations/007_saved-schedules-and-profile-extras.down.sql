DROP TABLE IF EXISTS Saved_Schedules;

ALTER TABLE User_Profiles
  DROP COLUMN must_take_courses,
  DROP COLUMN avoid_instructors,
  DROP COLUMN preferences_json,
  DROP COLUMN password_hash,
  DROP COLUMN watchlist,
  DROP COLUMN skill_tree,
  DROP COLUMN overall_score,
  DROP COLUMN overall_score_max;
