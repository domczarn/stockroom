CREATE TABLE IF NOT EXISTS `usage_daily` (`day` text NOT NULL, `feature` text NOT NULL, `count` integer NOT NULL DEFAULT 0, PRIMARY KEY (`day`, `feature`));
