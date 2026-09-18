CREATE TABLE `company_pages` (
	`partner_id` text PRIMARY KEY NOT NULL,
	`draft_config` text NOT NULL,
	`published_config` text,
	`draft_revision` integer DEFAULT 0 NOT NULL,
	`published_revision` integer DEFAULT 0 NOT NULL,
	`published_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`partner_id`) REFERENCES `partners`(`user_id`) ON UPDATE no action ON DELETE no action
);
