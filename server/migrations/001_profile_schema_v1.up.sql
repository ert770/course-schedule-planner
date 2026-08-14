ALTER TABLE `User_Profiles`
  ADD COLUMN `student_id` VARCHAR(32) NULL,
  ADD COLUMN `class_name` VARCHAR(45) NULL,
  ADD COLUMN `profile_schema_version` INT NOT NULL DEFAULT 1,
  ADD UNIQUE INDEX `uq_user_profiles_student_id` (`student_id`);
