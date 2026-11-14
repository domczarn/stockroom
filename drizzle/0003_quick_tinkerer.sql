CREATE TABLE `connections` (
	`id` text PRIMARY KEY NOT NULL,
	`sender` text NOT NULL,
	`recipient` text NOT NULL,
	`state` text NOT NULL,
	`blocked_by` text
);
--> statement-breakpoint
CREATE TABLE `messages` (
	`id` text PRIMARY KEY NOT NULL,
	`connection` text NOT NULL,
	`sender` text NOT NULL,
	`body` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `messages_connection_time` ON `messages` (`connection`,`created_at`,`id`);--> statement-breakpoint
CREATE TABLE `profiles` (
	`user_id` text PRIMARY KEY NOT NULL,
	`username` text,
	`avatar_seed` text NOT NULL,
	`share_revenue` integer DEFAULT 0 NOT NULL,
	`owner` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `profiles_username_unique` ON `profiles` (`username`);--> statement-breakpoint
CREATE UNIQUE INDEX `profiles_avatar_seed_unique` ON `profiles` (`avatar_seed`);--> statement-breakpoint
CREATE TABLE `sale_imports` (
	`id` text PRIMARY KEY NOT NULL,
	`payload` text NOT NULL,
	`updated_at` text NOT NULL
);
