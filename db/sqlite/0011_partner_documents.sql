CREATE TABLE `partner_documents` (
	`id` text PRIMARY KEY NOT NULL,
	`partner_id` text NOT NULL,
	`kind` text NOT NULL,
	`object_key` text NOT NULL,
	`mime` text NOT NULL,
	`size` integer NOT NULL,
	`created_at` text NOT NULL,
	`expires_at` text NOT NULL,
	FOREIGN KEY (`partner_id`) REFERENCES `partners`(`user_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `partner_documents_one_per_kind` ON `partner_documents` (`partner_id`,`kind`);--> statement-breakpoint
CREATE INDEX `partner_documents_expiry` ON `partner_documents` (`expires_at`);
