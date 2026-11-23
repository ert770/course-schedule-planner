-- 010: User_Profiles.student_id and allocator.
-- Shared Aiven defaultdb: manually applied by the user; DO NOT run there again.
-- MySQL DDL commits implicitly. Run only against a separately verified clean schema.
-- The guard refuses both an already applied and a partially applied state.
DELIMITER //
CREATE PROCEDURE migration_010_preflight()
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'User_Profiles' AND COLUMN_NAME = 'student_id')
     OR EXISTS (SELECT 1 FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'User_Profiles' AND INDEX_NAME = 'uq_user_profiles_student_id')
     OR EXISTS (SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'User_Id_Allocator') THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Migration 010 already or partially applied; inspect schema manually';
  END IF;
END//
DELIMITER ;
CALL migration_010_preflight();
DROP PROCEDURE migration_010_preflight;
ALTER TABLE User_Profiles
  ADD COLUMN student_id VARCHAR(32) NULL,
  ADD UNIQUE KEY uq_user_profiles_student_id (student_id);
CREATE TABLE User_Id_Allocator (
  user_id INT NOT NULL AUTO_INCREMENT,
  PRIMARY KEY (user_id)
) ENGINE=InnoDB AUTO_INCREMENT=5;
