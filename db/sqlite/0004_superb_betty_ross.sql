CREATE TABLE `content_posts` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`title` text NOT NULL,
	`body` text NOT NULL,
	`published` integer DEFAULT 0 NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `operation_settings` (
	`id` text PRIMARY KEY NOT NULL,
	`accepting` integer DEFAULT 1 NOT NULL,
	`notice` text NOT NULL,
	`revision` integer NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `partner_profiles` (
	`partner_id` text PRIMARY KEY NOT NULL,
	`about` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`partner_id`) REFERENCES `partners`(`user_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `portfolio_assets` (
	`id` text PRIMARY KEY NOT NULL,
	`partner_id` text NOT NULL,
	`object_key` text NOT NULL,
	`mime` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`partner_id`) REFERENCES `partners`(`user_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `portfolio_cases` (
	`id` text PRIMARY KEY NOT NULL,
	`partner_id` text NOT NULL,
	`title` text NOT NULL,
	`body` text NOT NULL,
	`region` text NOT NULL,
	`asset_id` text,
	`published` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`partner_id`) REFERENCES `partners`(`user_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`asset_id`) REFERENCES `portfolio_assets`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `reviews` (
	`order_id` text PRIMARY KEY NOT NULL,
	`partner_id` text NOT NULL,
	`customer_id` text NOT NULL,
	`rating` integer NOT NULL,
	`body` text NOT NULL,
	`reply` text,
	`hidden` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`partner_id`) REFERENCES `partners`(`user_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`customer_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TRIGGER intake_pause BEFORE INSERT ON orders
WHEN EXISTS(SELECT 1 FROM operation_settings WHERE id='main' AND accepting=0)
BEGIN SELECT RAISE(ABORT,'INTAKE_PAUSED'); END;
--> statement-breakpoint
CREATE TRIGGER review_owner_completed BEFORE INSERT ON reviews
WHEN NOT EXISTS(SELECT 1 FROM orders o JOIN bids b ON b.id=o.selected_bid_id WHERE o.id=NEW.order_id AND o.customer_id=NEW.customer_id AND b.partner_id=NEW.partner_id AND o.status IN ('COMPLETED','SETTLED')) OR NEW.rating NOT BETWEEN 1 AND 5
BEGIN SELECT RAISE(ABORT,'REVIEW_NOT_ELIGIBLE'); END;
