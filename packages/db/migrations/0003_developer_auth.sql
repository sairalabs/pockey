ALTER TABLE `developers` ADD `auth_user_id` text;--> statement-breakpoint
CREATE UNIQUE INDEX `developers_auth_user_idx` ON `developers` (`auth_user_id`);