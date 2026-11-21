-- Weekly Pip report: one row per person per week sent, plus their email preference.
CREATE TABLE IF NOT EXISTS `weekly_reports` (
	`owner_id` text NOT NULL,
	`week` text NOT NULL,
	`sent_at` text NOT NULL,
	PRIMARY KEY (`owner_id`, `week`)
);
CREATE TABLE IF NOT EXISTS `email_prefs` (
	`owner_id` text PRIMARY KEY NOT NULL,
	`weekly` integer NOT NULL DEFAULT 1,
	`updated_at` text NOT NULL
);
