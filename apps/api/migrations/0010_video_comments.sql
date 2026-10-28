CREATE TABLE `video_comment` (
	`id` text PRIMARY KEY NOT NULL,
	`video_id` text NOT NULL,
	`author_id` text,
	`body` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`video_id`) REFERENCES `video`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`author_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `video_comment_video_created_idx` ON `video_comment` (`video_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `video_reaction` (
	`id` text PRIMARY KEY NOT NULL,
	`video_id` text NOT NULL,
	`user_id` text,
	`emoji` text NOT NULL,
	`at_ms` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`video_id`) REFERENCES `video`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `video_reaction_video_at_idx` ON `video_reaction` (`video_id`,`at_ms`);