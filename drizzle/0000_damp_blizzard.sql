CREATE TABLE `purchase_imports` (
	`transaction_id` text PRIMARY KEY NOT NULL,
	`payload` text NOT NULL,
	`updated_at` text NOT NULL
);
