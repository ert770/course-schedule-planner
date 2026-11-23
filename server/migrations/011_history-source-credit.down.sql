-- A rollback could erase original source information; requires a reviewed export plan.
SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Migration 011 rollback requires a reviewed data-preservation plan';
