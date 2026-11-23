-- Review before applying; never run automatically against shared databases.
ALTER TABLE `Unmatched_Course_History`
 MODIFY COLUMN `catalog_course_code` VARCHAR(45) NULL,
 ADD COLUMN `source_identity` CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
 ADD UNIQUE KEY `uq_unmatched_source` (`user_id`,`source_identity`,`academic_year`,`semester`);
