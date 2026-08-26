CREATE TABLE `subscription` (
	`id` text PRIMARY KEY NOT NULL,
	`team_id` text NOT NULL,
	`dodo_subscription_id` text NOT NULL,
	`dodo_customer_id` text NOT NULL,
	`status` text NOT NULL,
	`seats_purchased` integer DEFAULT 0 NOT NULL,
	`scheduled_seats` integer,
	`current_period_end` integer,
	`grace_until` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`team_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `subscription_team_id_unique` ON `subscription` (`team_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `subscription_dodo_subscription_id_unique` ON `subscription` (`dodo_subscription_id`);--> statement-breakpoint
CREATE TABLE `webhook_event` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
