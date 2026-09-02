ALTER TABLE `User_Profiles`
  ADD COLUMN `admission_year` smallint unsigned DEFAULT NULL
  COMMENT '入學學年度（民國），Roadmap #23 版本化畢業規則用；NULL 代表未知';
