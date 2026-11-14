CREATE TABLE `chat_typing` (
	`key` text PRIMARY KEY NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `message_deliveries` (
	`key` text PRIMARY KEY NOT NULL,
	`cursor` text NOT NULL
);
--> statement-breakpoint
ALTER TABLE `profiles` ADD `share_activity` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `profiles` ADD `share_leaderboard` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `profiles` ADD `last_active_at` text;