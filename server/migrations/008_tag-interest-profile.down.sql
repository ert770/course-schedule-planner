DROP TABLE IF EXISTS `Learned_Tag_Interests`;
ALTER TABLE `Interaction_Events`
  DROP COLUMN `tag_interest_snapshot_json`,
  DROP COLUMN `interest_feedback_json`,
  DROP COLUMN `rating`;
