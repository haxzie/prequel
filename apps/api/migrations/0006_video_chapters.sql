ALTER TABLE `video` ADD `transcript_key` text;--> statement-breakpoint
ALTER TABLE `video` ADD `transcript_language` text;--> statement-breakpoint
ALTER TABLE `video` ADD `chapters` text;--> statement-breakpoint
ALTER TABLE `video` ADD `chapters_source` text;--> statement-breakpoint
ALTER TABLE `video` ADD `chapters_model` text;--> statement-breakpoint
ALTER TABLE `video` ADD `chapters_input_tokens` integer;--> statement-breakpoint
ALTER TABLE `video` ADD `chapters_output_tokens` integer;--> statement-breakpoint
ALTER TABLE `video` ADD `chapters_retry_at` integer;