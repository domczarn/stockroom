CREATE TABLE `notification_reads` (
	`owner_id` text NOT NULL,
	`event_key` text NOT NULL,
	`read_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `notification_reads_owner_event` ON `notification_reads` (`owner_id`,`event_key`);