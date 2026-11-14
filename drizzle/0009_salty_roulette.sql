CREATE TABLE `gmail_connections` (
	`owner_id` text PRIMARY KEY NOT NULL,
	`connection_id` text NOT NULL,
	`mailbox` text NOT NULL,
	`token` text NOT NULL,
	`enabled` integer DEFAULT 1 NOT NULL,
	`alerts` integer DEFAULT 0 NOT NULL,
	`days` integer DEFAULT 7 NOT NULL,
	`state` text DEFAULT 'connected' NOT NULL,
	`checked_at` text,
	`lease` integer DEFAULT 0 NOT NULL,
	`receipts` text DEFAULT '[]' NOT NULL
);
--> statement-breakpoint
CREATE TABLE `gmail_oauth_states` (
	`owner_id` text PRIMARY KEY NOT NULL,
	`state` text NOT NULL,
	`verifier` text NOT NULL,
	`expires_at` integer NOT NULL
);
