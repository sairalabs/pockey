CREATE TABLE `api_keys` (
	`id` text PRIMARY KEY NOT NULL,
	`app_id` text NOT NULL,
	`hash` text NOT NULL,
	`prefix` text NOT NULL,
	`name` text,
	`scopes` text DEFAULT '["server"]' NOT NULL,
	`last_used_at` integer,
	`revoked_at` integer,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`app_id`) REFERENCES `apps`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `api_keys_hash_idx` ON `api_keys` (`hash`);--> statement-breakpoint
CREATE INDEX `api_keys_app_idx` ON `api_keys` (`app_id`);--> statement-breakpoint
CREATE TABLE `apps` (
	`id` text PRIMARY KEY NOT NULL,
	`public_id` text NOT NULL,
	`developer_id` text NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`allowed_origins` text DEFAULT '[]' NOT NULL,
	`config` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`developer_id`) REFERENCES `developers`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `apps_public_id_idx` ON `apps` (`public_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `apps_developer_slug_idx` ON `apps` (`developer_id`,`slug`);--> statement-breakpoint
CREATE TABLE `ba_account` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`account_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`access_token` text,
	`refresh_token` text,
	`access_token_expires_at` integer,
	`refresh_token_expires_at` integer,
	`scope` text,
	`id_token` text,
	`password` text,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `ba_user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `ba_account_user_idx` ON `ba_account` (`user_id`);--> statement-breakpoint
CREATE TABLE `ba_passkey` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text,
	`public_key` text NOT NULL,
	`user_id` text NOT NULL,
	`credential_id` text NOT NULL,
	`counter` integer DEFAULT 0 NOT NULL,
	`device_type` text NOT NULL,
	`backed_up` integer DEFAULT false NOT NULL,
	`transports` text,
	`aaguid` text,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `ba_user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ba_passkey_credential_idx` ON `ba_passkey` (`credential_id`);--> statement-breakpoint
CREATE INDEX `ba_passkey_user_idx` ON `ba_passkey` (`user_id`);--> statement-breakpoint
CREATE TABLE `ba_session` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`token` text NOT NULL,
	`expires_at` integer NOT NULL,
	`ip_address` text,
	`user_agent` text,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `ba_user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ba_session_token_idx` ON `ba_session` (`token`);--> statement-breakpoint
CREATE INDEX `ba_session_user_idx` ON `ba_session` (`user_id`);--> statement-breakpoint
CREATE TABLE `ba_user` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`email_verified` integer DEFAULT false NOT NULL,
	`image` text,
	`app_id` text,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ba_user_app_email_idx` ON `ba_user` (`app_id`,`email`);--> statement-breakpoint
CREATE TABLE `ba_verification` (
	`id` text PRIMARY KEY NOT NULL,
	`identifier` text NOT NULL,
	`value` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `ba_verification_identifier_idx` ON `ba_verification` (`identifier`);--> statement-breakpoint
CREATE TABLE `developers` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`name` text,
	`stripe_customer_id` text,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `developers_email_idx` ON `developers` (`email`);--> statement-breakpoint
CREATE TABLE `end_user_identities` (
	`id` text PRIMARY KEY NOT NULL,
	`end_user_id` text NOT NULL,
	`app_id` text NOT NULL,
	`type` text NOT NULL,
	`identifier` text NOT NULL,
	`verified_at` integer,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`end_user_id`) REFERENCES `end_users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`app_id`) REFERENCES `apps`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `identities_app_type_identifier_idx` ON `end_user_identities` (`app_id`,`type`,`identifier`);--> statement-breakpoint
CREATE INDEX `identities_end_user_idx` ON `end_user_identities` (`end_user_id`);--> statement-breakpoint
CREATE TABLE `end_users` (
	`id` text PRIMARY KEY NOT NULL,
	`app_id` text NOT NULL,
	`key_provider_sub_org_id` text,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`last_active_at` integer,
	FOREIGN KEY (`app_id`) REFERENCES `apps`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `end_users_app_idx` ON `end_users` (`app_id`);--> statement-breakpoint
CREATE TABLE `session_signers` (
	`id` text PRIMARY KEY NOT NULL,
	`wallet_id` text NOT NULL,
	`key_provider_policy_id` text NOT NULL,
	`policy` text NOT NULL,
	`spent_total` text DEFAULT '0' NOT NULL,
	`expires_at` integer NOT NULL,
	`revoked_at` integer,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`wallet_id`) REFERENCES `wallets`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `session_signers_wallet_idx` ON `session_signers` (`wallet_id`);--> statement-breakpoint
CREATE TABLE `sponsor_balances` (
	`app_id` text PRIMARY KEY NOT NULL,
	`balance_cents` integer DEFAULT 0 NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`app_id`) REFERENCES `apps`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `usage_events` (
	`id` text PRIMARY KEY NOT NULL,
	`app_id` text NOT NULL,
	`end_user_id` text,
	`type` text NOT NULL,
	`amount` text,
	`meta` text,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`app_id`) REFERENCES `apps`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `usage_events_app_created_idx` ON `usage_events` (`app_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `usage_monthly` (
	`app_id` text NOT NULL,
	`month` text NOT NULL,
	`active_users` integer DEFAULT 0 NOT NULL,
	`wallets_created` integer DEFAULT 0 NOT NULL,
	`tx_signed` integer DEFAULT 0 NOT NULL,
	`session_signed` integer DEFAULT 0 NOT NULL,
	`gas_sponsored_wei` text DEFAULT '0' NOT NULL,
	`gas_sponsored_lamports` text DEFAULT '0' NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	PRIMARY KEY(`app_id`, `month`),
	FOREIGN KEY (`app_id`) REFERENCES `apps`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `wallets` (
	`id` text PRIMARY KEY NOT NULL,
	`end_user_id` text NOT NULL,
	`chain_family` text NOT NULL,
	`address` text NOT NULL,
	`key_provider_wallet_id` text NOT NULL,
	`smart_account_address` text,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`end_user_id`) REFERENCES `end_users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `wallets_user_family_idx` ON `wallets` (`end_user_id`,`chain_family`);--> statement-breakpoint
CREATE INDEX `wallets_address_idx` ON `wallets` (`address`);--> statement-breakpoint
CREATE TABLE `webhooks` (
	`id` text PRIMARY KEY NOT NULL,
	`app_id` text NOT NULL,
	`url` text NOT NULL,
	`secret` text NOT NULL,
	`events` text DEFAULT '[]' NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`app_id`) REFERENCES `apps`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `webhooks_app_idx` ON `webhooks` (`app_id`);