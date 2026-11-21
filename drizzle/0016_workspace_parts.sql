-- Bulky item text (descriptions, notes) is stored beside the workspace core, tied to the core's revision.
CREATE TABLE IF NOT EXISTS `workspace_parts` (
	`owner_id` text NOT NULL,
	`revision` text NOT NULL,
	`part` integer NOT NULL,
	`data` text NOT NULL,
	PRIMARY KEY (`owner_id`, `revision`, `part`)
);
