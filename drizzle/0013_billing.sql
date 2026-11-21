-- Free plan counts new stock items per calendar month.
CREATE TABLE IF NOT EXISTS `item_adds` (
	`owner_id` text NOT NULL,
	`item_id` text NOT NULL,
	`month` text NOT NULL,
	PRIMARY KEY (`owner_id`, `item_id`)
);
CREATE INDEX IF NOT EXISTS `item_adds_month` ON `item_adds` (`owner_id`, `month`);
