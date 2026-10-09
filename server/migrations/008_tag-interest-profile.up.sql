ALTER TABLE `Interaction_Events`
  ADD COLUMN `rating` TINYINT UNSIGNED NULL AFTER `feedback_reason`,
  ADD COLUMN `interest_feedback_json` JSON NULL AFTER `rating`,
  ADD COLUMN `tag_interest_snapshot_json` JSON NULL AFTER `exposure_json`;

CREATE TABLE IF NOT EXISTS `Learned_Tag_Interests` (
  `subject_id` VARCHAR(67) NOT NULL,
  `model_version` VARCHAR(64) NOT NULL,
  `catalog_version` VARCHAR(64) NOT NULL,
  `eligibility_version` VARCHAR(64) NULL,
  `prior_signature` CHAR(64) NOT NULL,
  `profile_json` JSON NOT NULL,
  `computed_at` DATETIME(3) NOT NULL,
  `expires_at` DATETIME(3) NOT NULL,
  PRIMARY KEY (`subject_id`),
  INDEX `idx_learned_tag_interests_expiry` (`expires_at`),
  CONSTRAINT `fk_learned_tag_interests_subject`
    FOREIGN KEY (`subject_id`) REFERENCES `Privacy_Subject_State` (`subject_id`)
)
