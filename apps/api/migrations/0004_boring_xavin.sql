CREATE TABLE `purchase` (
	`id` text PRIMARY KEY NOT NULL,
	`team_id` text NOT NULL,
	`dodo_payment_id` text NOT NULL,
	`dodo_customer_id` text NOT NULL,
	`product_id` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`team_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `purchase_team_id_unique` ON `purchase` (`team_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `purchase_dodo_payment_id_unique` ON `purchase` (`dodo_payment_id`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_organization` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`logo` text,
	`metadata` text,
	`plan` text DEFAULT 'free' NOT NULL,
	`storage_quota_bytes` integer DEFAULT 2000000000 NOT NULL,
	`created_by` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
INSERT INTO `__new_organization`("id", "name", "slug", "logo", "metadata", "plan", "storage_quota_bytes", "created_by", "created_at") SELECT "id", "name", "slug", "logo", "metadata", "plan", "storage_quota_bytes", "created_by", "created_at" FROM `organization`;--> statement-breakpoint
DROP TABLE `organization`;--> statement-breakpoint
ALTER TABLE `__new_organization` RENAME TO `organization`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `organization_slug_unique` ON `organization` (`slug`);--> statement-breakpoint
UPDATE `organization` SET `storage_quota_bytes` = 1000000000000 WHERE `plan` = 'pro';--> statement-breakpoint
UPDATE `organization` SET `storage_quota_bytes` = 2000000000 WHERE `plan` = 'free';
