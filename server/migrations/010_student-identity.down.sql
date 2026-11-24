-- Shared Aiven defaultdb was manually upgraded. Never run rollback there.
-- Deliberately non-destructive: dropping this column or allocator could erase
-- account mappings or allow previously issued IDs to be reissued. A rollback
-- requires a separately reviewed data-preservation and ID-retirement plan.
SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Migration 010 rollback requires a reviewed data-preservation plan';
