-- Server errors, so the owner sees problems before members report them.
CREATE TABLE IF NOT EXISTS `error_events` (
	`id` text PRIMARY KEY NOT NULL,
	`at` text NOT NULL,
	`path` text NOT NULL,
	`status` integer NOT NULL,
	`message` text NOT NULL
);
CREATE INDEX IF NOT EXISTS `error_events_at` ON `error_events` (`at`);
