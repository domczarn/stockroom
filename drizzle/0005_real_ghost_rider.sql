CREATE TABLE `push_devices` (
	`endpoint` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`subscription` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `push_devices_owner` ON `push_devices` (`owner_id`);--> statement-breakpoint
CREATE TABLE `push_keys` (
	`id` text PRIMARY KEY NOT NULL,
	`public_key` text NOT NULL,
	`private_key` text NOT NULL
);
