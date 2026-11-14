CREATE TABLE `access_notices` (
	`id` text PRIMARY KEY NOT NULL,
	`state` text NOT NULL,
	`submitted_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `email_sync` (
	`id` text PRIMARY KEY NOT NULL,
	`enabled` integer DEFAULT 1 NOT NULL,
	`mailbox` text,
	`state` text DEFAULT 'unverified' NOT NULL,
	`checked_at` text
);
