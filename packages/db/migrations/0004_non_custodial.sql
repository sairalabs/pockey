ALTER TABLE `auth_challenges` ADD `payload` text;--> statement-breakpoint
ALTER TABLE `end_users` ADD `key_provider_user_id` text;--> statement-breakpoint
ALTER TABLE `end_users` ADD `key_provider_signer_user_id` text;--> statement-breakpoint
ALTER TABLE `end_users` ADD `key_provider_accounts` text;--> statement-breakpoint
CREATE UNIQUE INDEX `end_users_sub_org_idx` ON `end_users` (`key_provider_sub_org_id`);