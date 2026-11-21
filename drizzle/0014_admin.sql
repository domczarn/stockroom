-- Admin console: app-wide settings and private notes about members.
CREATE TABLE IF NOT EXISTS `app_settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` text NOT NULL
);
CREATE TABLE IF NOT EXISTS `admin_notes` (
	`owner_id` text PRIMARY KEY NOT NULL,
	`note` text NOT NULL,
	`updated_at` text NOT NULL
);
