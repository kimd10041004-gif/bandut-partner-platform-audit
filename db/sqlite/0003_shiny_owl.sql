CREATE TABLE `request_drafts` (
	`user_id` text PRIMARY KEY NOT NULL,
	`id` text NOT NULL,
	`payload` text NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`updated_at` text NOT NULL,
	`expires_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `request_drafts_id_unique` ON `request_drafts` (`id`);--> statement-breakpoint
CREATE TABLE `submission_keys` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`payload_hash` text NOT NULL,
	`order_id` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE no action
);

--> statement-breakpoint
CREATE TRIGGER draft_not_submitted_insert BEFORE INSERT ON request_drafts
WHEN EXISTS(SELECT 1 FROM submission_keys WHERE id=NEW.id)
BEGIN SELECT RAISE(ABORT,'Request already submitted'); END;
--> statement-breakpoint
CREATE TRIGGER draft_not_submitted_update BEFORE UPDATE ON request_drafts
WHEN EXISTS(SELECT 1 FROM submission_keys WHERE id=NEW.id)
BEGIN SELECT RAISE(ABORT,'Request already submitted'); END;
