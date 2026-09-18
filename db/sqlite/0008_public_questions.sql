CREATE TABLE `questions` (
	`id` text PRIMARY KEY NOT NULL,
	`partner_id` text NOT NULL,
	`customer_id` text NOT NULL,
	`case_id` text,
	`body` text NOT NULL,
	`answer` text,
	`answered_at` text,
	`hidden` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`partner_id`) REFERENCES `partners`(`user_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`customer_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`case_id`) REFERENCES `portfolio_cases`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `questions_partner_created` ON `questions` (`partner_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `questions_customer_created` ON `questions` (`customer_id`,`created_at`);
