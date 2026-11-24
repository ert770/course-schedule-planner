-- Local test databases only until explicitly reviewed for deployment.
CREATE TABLE `Local_History_Attestations` (
  `id` BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `user_id` INT NOT NULL,
  `course_code` VARCHAR(80) NOT NULL,
  `academic_year` INT NOT NULL,
  `semester` INT NOT NULL,
  `trust_level` VARCHAR(40) NOT NULL,
  `statement_version` VARCHAR(32) NOT NULL,
  `confirmed_at` DATETIME(3) NOT NULL,
  KEY `idx_local_history_attestation_user` (`user_id`),
  CONSTRAINT `fk_local_history_attestation_user` FOREIGN KEY (`user_id`) REFERENCES `User_Profiles` (`user_id`) ON DELETE CASCADE
) ENGINE=InnoDB;
