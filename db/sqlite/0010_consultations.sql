CREATE TABLE `consultations` (
	`id` text PRIMARY KEY NOT NULL,
	`customer_id` text NOT NULL,
	`partner_id` text NOT NULL,
	`case_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`customer_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`partner_id`) REFERENCES `partners`(`user_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`case_id`) REFERENCES `portfolio_cases`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `consultations_pair` ON `consultations` (`customer_id`,`partner_id`);--> statement-breakpoint
CREATE TABLE `consultation_messages` (
	`seq` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`id` text NOT NULL,
	`consultation_id` text NOT NULL,
	`sender_id` text NOT NULL,
	`sender_name` text NOT NULL,
	`body` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`consultation_id`) REFERENCES `consultations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`sender_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `consultation_messages_id` ON `consultation_messages` (`id`);--> statement-breakpoint
CREATE INDEX `consultation_messages_room` ON `consultation_messages` (`consultation_id`,`seq`);--> statement-breakpoint
CREATE TABLE `consultation_reads` (
	`consultation_id` text NOT NULL,
	`user_id` text NOT NULL,
	`last_seq` integer NOT NULL,
	FOREIGN KEY (`consultation_id`) REFERENCES `consultations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `consultation_reads_pair` ON `consultation_reads` (`consultation_id`,`user_id`);
