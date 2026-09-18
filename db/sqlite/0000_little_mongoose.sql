CREATE TABLE `audit_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`actor_id` text NOT NULL,
	`role` text NOT NULL,
	`order_id` text,
	`action` text NOT NULL,
	`before_state` text,
	`after_state` text,
	`reason` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `audit_order` ON `audit_logs` (`order_id`);--> statement-breakpoint
CREATE TABLE `bids` (
	`id` text PRIMARY KEY NOT NULL,
	`order_id` text NOT NULL,
	`partner_id` text NOT NULL,
	`labor_cost` integer NOT NULL,
	`material_cost` integer NOT NULL,
	`transport_cost` integer NOT NULL,
	`discount` integer NOT NULL,
	`vat` integer NOT NULL,
	`total` integer NOT NULL,
	`included` text NOT NULL,
	`excluded` text NOT NULL,
	`message` text NOT NULL,
	`available_date` text NOT NULL,
	`start_hour` integer NOT NULL,
	`end_hour` integer NOT NULL,
	`status` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`partner_id`) REFERENCES `partners`(`user_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `bids_order_partner` ON `bids` (`order_id`,`partner_id`);--> statement-breakpoint
CREATE TABLE `orders` (
	`id` text PRIMARY KEY NOT NULL,
	`customer_id` text NOT NULL,
	`title` text NOT NULL,
	`work_items` text NOT NULL,
	`description` text NOT NULL,
	`region` text NOT NULL,
	`address` text NOT NULL,
	`phone` text NOT NULL,
	`desired_date` text,
	`budget` integer,
	`deadline` text NOT NULL,
	`answers` text NOT NULL,
	`review_status` text NOT NULL,
	`review_completed_at` text,
	`routing_status` text DEFAULT 'UNDECIDED' NOT NULL,
	`routing_decision` text,
	`status` text DEFAULT 'SUBMITTED' NOT NULL,
	`selected_bid_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`customer_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `orders_customer` ON `orders` (`customer_id`);--> statement-breakpoint
CREATE INDEX `orders_status` ON `orders` (`status`);--> statement-breakpoint
CREATE TABLE `partners` (
	`user_id` text PRIMARY KEY NOT NULL,
	`company` text NOT NULL,
	`representative` text NOT NULL,
	`work_items` text NOT NULL,
	`regions` text NOT NULL,
	`status` text DEFAULT 'PENDING' NOT NULL,
	`approved_by` text,
	`approved_at` text,
	`account_status` text DEFAULT 'UNVERIFIED' NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `photos` (
	`id` text PRIMARY KEY NOT NULL,
	`order_id` text NOT NULL,
	`owner_id` text NOT NULL,
	`object_key` text NOT NULL,
	`mime` text NOT NULL,
	`created_at` text NOT NULL,
	`expires_at` text NOT NULL,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `rate_limits` (
	`key` text PRIMARY KEY NOT NULL,
	`count` integer NOT NULL,
	`expires_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `schedule_slots` (
	`order_id` text PRIMARY KEY NOT NULL,
	`partner_id` text NOT NULL,
	`date` text NOT NULL,
	`start_hour` integer NOT NULL,
	`end_hour` integer NOT NULL,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `slots_partner_date` ON `schedule_slots` (`partner_id`,`date`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`name` text NOT NULL,
	`role` text NOT NULL,
	`phone` text,
	`suspended` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TRIGGER schedule_no_overlap BEFORE INSERT ON schedule_slots
WHEN EXISTS (SELECT 1 FROM schedule_slots s WHERE s.partner_id=NEW.partner_id AND s.date=NEW.date AND s.start_hour<NEW.end_hour AND s.end_hour>NEW.start_hour)
BEGIN SELECT RAISE(ABORT,'SCHEDULE_CONFLICT'); END;
--> statement-breakpoint
CREATE TRIGGER routing_immutable BEFORE UPDATE OF routing_decision ON orders
WHEN OLD.routing_status='DECIDED' AND NEW.routing_decision IS NOT OLD.routing_decision
BEGIN SELECT RAISE(ABORT,'ROUTING_IMMUTABLE'); END;
--> statement-breakpoint
CREATE TRIGGER selection_requires_review BEFORE UPDATE OF selected_bid_id ON orders
WHEN NEW.selected_bid_id IS NOT NULL AND (NEW.routing_decision!='MARKETPLACE' OR NEW.routing_status!='DECIDED' OR (NEW.review_status='MANUAL_REVIEW' AND NEW.review_completed_at IS NULL))
BEGIN SELECT RAISE(ABORT,'REVIEW_REQUIRED'); END;
--> statement-breakpoint
CREATE TRIGGER audit_no_update BEFORE UPDATE ON audit_logs
BEGIN SELECT RAISE(ABORT,'AUDIT_IMMUTABLE'); END;
--> statement-breakpoint
CREATE TRIGGER audit_no_delete BEFORE DELETE ON audit_logs
BEGIN SELECT RAISE(ABORT,'AUDIT_IMMUTABLE'); END;
--> statement-breakpoint
CREATE TRIGGER photo_limit BEFORE INSERT ON photos
WHEN (SELECT COUNT(*) FROM photos WHERE order_id=NEW.order_id)>=6
BEGIN SELECT RAISE(ABORT,'PHOTO_LIMIT'); END;
