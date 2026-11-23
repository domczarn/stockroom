ALTER TABLE `profiles` ADD `instagram` text;
--> statement-breakpoint
CREATE UNIQUE INDEX `profiles_instagram` ON `profiles` (`instagram`) WHERE instagram IS NOT NULL;
