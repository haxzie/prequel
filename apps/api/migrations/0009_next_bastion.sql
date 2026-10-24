CREATE TABLE `email_preference` (
	`user_id` text PRIMARY KEY NOT NULL,
	`marketing` integer DEFAULT true NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
