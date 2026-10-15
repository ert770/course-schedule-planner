CREATE TABLE IF NOT EXISTS `Course_Neighbor_Builds` (
  `build_id` CHAR(36) NOT NULL,
  `model_version` VARCHAR(64) NOT NULL,
  `computed_at` DATETIME(3) NOT NULL,
  `contributor_count` INT UNSIGNED NOT NULL,
  `real_contributor_count` INT UNSIGNED NOT NULL,
  `eligible_real_contributor_count` INT UNSIGNED NOT NULL,
  `neighbor_pair_count` INT UNSIGNED NOT NULL,
  `gate_met` TINYINT(1) NOT NULL,
  `settings_json` JSON NOT NULL,
  PRIMARY KEY (`build_id`),
  INDEX `idx_course_neighbor_builds_computed` (`computed_at`)
);

CREATE TABLE IF NOT EXISTS `Course_Neighbors` (
  `build_id` CHAR(36) NOT NULL,
  `course_code` VARCHAR(32) NOT NULL,
  `neighbor_code` VARCHAR(32) NOT NULL,
  `similarity` DOUBLE NOT NULL,
  `co_count` INT UNSIGNED NOT NULL,
  PRIMARY KEY (`build_id`, `course_code`, `neighbor_code`),
  CONSTRAINT `fk_course_neighbors_build`
    FOREIGN KEY (`build_id`) REFERENCES `Course_Neighbor_Builds` (`build_id`) ON DELETE CASCADE
)
