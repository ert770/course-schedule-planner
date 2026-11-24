-- Review before applying. Never execute automatically against shared databases.
ALTER TABLE `User_Course_History` ADD COLUMN `course_id` VARCHAR(80) NULL,
 ADD COLUMN `source_payload` JSON NULL, MODIFY COLUMN `passed` TINYINT(1) NULL,
 MODIFY COLUMN `requirement_type` VARCHAR(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL,
 MODIFY COLUMN `graduation_category` VARCHAR(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL;
CREATE TABLE `Unmatched_Course_History` (
 `id` BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY, `user_id` INT NOT NULL,
 `catalog_course_code` VARCHAR(45) NOT NULL, `academic_year` SMALLINT UNSIGNED NOT NULL,
 `semester` TINYINT UNSIGNED NOT NULL, `reason` VARCHAR(32) NOT NULL, `source_payload` JSON NOT NULL,
 UNIQUE KEY `uq_unmatched_attempt` (`user_id`,`catalog_course_code`,`academic_year`,`semester`),
 CONSTRAINT `fk_unmatched_user` FOREIGN KEY (`user_id`) REFERENCES `User_Profiles` (`user_id`) ON DELETE CASCADE
) ENGINE=InnoDB;
