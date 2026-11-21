CREATE TABLE IF NOT EXISTS `accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL UNIQUE,
	`created_at` text NOT NULL,
	`plan` text NOT NULL DEFAULT 'free',
	`plan_until` text,
	`stripe_customer` text,
	`stripe_subscription` text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `login_codes` (
	`email` text PRIMARY KEY NOT NULL,
	`code_hash` text NOT NULL,
	`expires_at` integer NOT NULL,
	`attempts` integer NOT NULL DEFAULT 0
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `sessions` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`device` text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `passkeys` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`public_key` text NOT NULL,
	`counter` integer NOT NULL DEFAULT 0,
	`transports` text,
	`name` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `auth_challenges` (
	`id` text PRIMARY KEY NOT NULL,
	`challenge` text NOT NULL,
	`account_id` text,
	`expires_at` integer NOT NULL
);
