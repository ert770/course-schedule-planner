ALTER TABLE `User_Profiles`
  DROP INDEX `uq_user_profiles_student_id`,
  DROP COLUMN `profile_schema_version`,
  DROP COLUMN `class_name`,
  DROP COLUMN `student_id`;
