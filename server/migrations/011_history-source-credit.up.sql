-- Review and apply only after approval; never run automatically against shared Aiven.
-- Preserve the original MyFCU credit-record field without treating it as a grade.
ALTER TABLE `User_Course_History`
  ADD COLUMN `source_credit_record` VARCHAR(255) NULL;
