-- Review and approve separately before applying to any shared database.
ALTER TABLE `User_Course_History`
 MODIFY COLUMN `catalog_course_code` VARCHAR(45) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL,
 ADD COLUMN `source_course_code` VARCHAR(45) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL,
 ADD COLUMN `source_attempt_key` CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
 ADD UNIQUE KEY `uq_history_source_attempt` (`user_id`,`source_attempt_key`,`academic_year`,`semester`);
ALTER TABLE `Local_History_Attestations` MODIFY COLUMN `course_code` VARCHAR(80) NULL;
-- Backfill only a code explicitly retained in the original source payload.
UPDATE `User_Course_History`
 SET `source_course_code` = JSON_UNQUOTE(JSON_EXTRACT(`source_payload`, '$.sourceCourseCode'))
 WHERE `source_course_code` IS NULL
   AND JSON_TYPE(JSON_EXTRACT(`source_payload`, '$.sourceCourseCode')) = 'STRING'
   AND CHAR_LENGTH(JSON_UNQUOTE(JSON_EXTRACT(`source_payload`, '$.sourceCourseCode'))) BETWEEN 1 AND 45
   AND REGEXP_LIKE(JSON_UNQUOTE(JSON_EXTRACT(`source_payload`, '$.sourceCourseCode')), '^[A-Z0-9]+$', 'c');
