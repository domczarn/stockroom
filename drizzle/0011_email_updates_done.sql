CREATE TABLE IF NOT EXISTS `email_updates_done` (
	`owner_id` text NOT NULL,
	`gmail_id` text NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`owner_id`, `gmail_id`)
);
