ALTER TABLE `extra_works` ADD `decided_by` text;--> statement-breakpoint
ALTER TABLE `extra_works` ADD `decision_snapshot` text;--> statement-breakpoint
ALTER TABLE `payments` ADD `mode` text DEFAULT 'unknown' NOT NULL;