CREATE TABLE `completions` (
	`id` text PRIMARY KEY NOT NULL,
	`order_id` text NOT NULL,
	`summary` text NOT NULL,
	`before_photos` text NOT NULL,
	`after_photos` text NOT NULL,
	`status` text NOT NULL,
	`response` text,
	`created_at` text NOT NULL,
	`decided_at` text,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `contracts` (
	`id` text PRIMARY KEY NOT NULL,
	`order_id` text NOT NULL,
	`version` integer NOT NULL,
	`partner_id` text NOT NULL,
	`snapshot` text NOT NULL,
	`total` integer NOT NULL,
	`deposit` integer NOT NULL,
	`commission_bps` integer NOT NULL,
	`terms` text NOT NULL,
	`date` text NOT NULL,
	`start_hour` integer NOT NULL,
	`end_hour` integer NOT NULL,
	`status` text NOT NULL,
	`created_at` text NOT NULL,
	`accepted_at` text,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `contract_version` ON `contracts` (`order_id`,`version`);--> statement-breakpoint
CREATE TABLE `disputes` (
	`id` text PRIMARY KEY NOT NULL,
	`order_id` text NOT NULL,
	`opened_by` text NOT NULL,
	`reason` text NOT NULL,
	`photo_ids` text NOT NULL,
	`previous_status` text NOT NULL,
	`status` text NOT NULL,
	`resolution` text,
	`resolved_by` text,
	`created_at` text NOT NULL,
	`resolved_at` text,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `extra_works` (
	`id` text PRIMARY KEY NOT NULL,
	`order_id` text NOT NULL,
	`partner_id` text NOT NULL,
	`description` text NOT NULL,
	`supply` integer NOT NULL,
	`vat` integer NOT NULL,
	`total` integer NOT NULL,
	`photo_ids` text NOT NULL,
	`status` text NOT NULL,
	`created_at` text NOT NULL,
	`decided_at` text,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `messages` (
	`seq` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`id` text NOT NULL,
	`order_id` text NOT NULL,
	`partner_id` text NOT NULL,
	`sender_id` text NOT NULL,
	`sender_name` text NOT NULL,
	`kind` text NOT NULL,
	`body` text NOT NULL,
	`photo_ids` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `messages_id_unique` ON `messages` (`id`);--> statement-breakpoint
CREATE INDEX `message_thread` ON `messages` (`order_id`,`partner_id`,`seq`);--> statement-breakpoint
CREATE TABLE `notifications` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`order_id` text NOT NULL,
	`message` text NOT NULL,
	`created_at` text NOT NULL,
	`read_at` text
);
--> statement-breakpoint
CREATE INDEX `notice_user` ON `notifications` (`user_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `payments` (
	`id` text PRIMARY KEY NOT NULL,
	`order_id` text NOT NULL,
	`target_id` text NOT NULL,
	`kind` text NOT NULL,
	`amount` integer NOT NULL,
	`status` text NOT NULL,
	`provider_key` text,
	`refunded` integer DEFAULT 0 NOT NULL,
	`receipt_url` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `payments_provider_key_unique` ON `payments` (`provider_key`);--> statement-breakpoint
CREATE TABLE `refunds` (
	`id` text PRIMARY KEY NOT NULL,
	`payment_id` text NOT NULL,
	`amount` integer NOT NULL,
	`reason` text NOT NULL,
	`status` text NOT NULL,
	`actor_id` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`payment_id`) REFERENCES `payments`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `schedule_changes` (
	`id` text PRIMARY KEY NOT NULL,
	`order_id` text NOT NULL,
	`date` text NOT NULL,
	`start_hour` integer NOT NULL,
	`end_hour` integer NOT NULL,
	`reason` text NOT NULL,
	`status` text NOT NULL,
	`created_at` text NOT NULL,
	`decided_at` text,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `settlements` (
	`order_id` text PRIMARY KEY NOT NULL,
	`partner_id` text NOT NULL,
	`gross` integer NOT NULL,
	`refunded` integer NOT NULL,
	`fee` integer NOT NULL,
	`payable` integer NOT NULL,
	`status` text NOT NULL,
	`reason` text NOT NULL,
	`approved_by` text,
	`approved_at` text,
	`transfer_reference` text,
	`paid_at` text,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `settlements_transfer_reference_unique` ON `settlements` (`transfer_reference`);--> statement-breakpoint
CREATE TABLE `trade_terms` (
	`order_id` text PRIMARY KEY NOT NULL,
	`commission_bps` integer NOT NULL,
	`reason` text NOT NULL,
	`updated_by` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX one_accepted_contract ON contracts(order_id) WHERE status='ACCEPTED';
--> statement-breakpoint
CREATE UNIQUE INDEX one_active_payment ON payments(order_id,kind,target_id) WHERE status NOT IN ('ABORTED','EXPIRED');
--> statement-breakpoint
CREATE UNIQUE INDEX one_pending_refund ON refunds(payment_id) WHERE status='PENDING';
--> statement-breakpoint
CREATE UNIQUE INDEX one_open_dispute ON disputes(order_id) WHERE status='OPEN';
--> statement-breakpoint
CREATE TRIGGER accepted_contract_immutable BEFORE UPDATE ON contracts WHEN OLD.status='ACCEPTED' BEGIN SELECT RAISE(ABORT,'ACCEPTED_CONTRACT_IMMUTABLE'); END;
--> statement-breakpoint
CREATE TRIGGER contracts_no_delete BEFORE DELETE ON contracts BEGIN SELECT RAISE(ABORT,'CONTRACT_HISTORY_IMMUTABLE'); END;
--> statement-breakpoint
CREATE TRIGGER messages_no_update BEFORE UPDATE ON messages BEGIN SELECT RAISE(ABORT,'MESSAGE_HISTORY_IMMUTABLE'); END;
--> statement-breakpoint
CREATE TRIGGER messages_no_delete BEFORE DELETE ON messages BEGIN SELECT RAISE(ABORT,'MESSAGE_HISTORY_IMMUTABLE'); END;
--> statement-breakpoint
CREATE TRIGGER extra_content_immutable BEFORE UPDATE OF description,supply,vat,total,partner_id,order_id,photo_ids ON extra_works BEGIN SELECT RAISE(ABORT,'EXTRA_CONTENT_IMMUTABLE'); END;
--> statement-breakpoint
CREATE TRIGGER schedule_update_no_overlap BEFORE UPDATE ON schedule_slots WHEN EXISTS(SELECT 1 FROM schedule_slots s WHERE s.order_id!=NEW.order_id AND s.partner_id=NEW.partner_id AND s.date=NEW.date AND s.start_hour<NEW.end_hour AND s.end_hour>NEW.start_hour) BEGIN SELECT RAISE(ABORT,'SCHEDULE_CONFLICT'); END;
--> statement-breakpoint
DROP TRIGGER photo_limit;
--> statement-breakpoint
CREATE TRIGGER photo_limit BEFORE INSERT ON photos WHEN (SELECT COUNT(*) FROM photos WHERE order_id=NEW.order_id)>=60 BEGIN SELECT RAISE(ABORT,'PHOTO_LIMIT'); END;
