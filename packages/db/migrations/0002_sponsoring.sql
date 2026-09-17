CREATE TABLE `app_system_wallets` (
	`id` text PRIMARY KEY NOT NULL,
	`app_id` text NOT NULL,
	`purpose` text NOT NULL,
	`key_provider_sub_org_id` text NOT NULL,
	`key_provider_wallet_id` text NOT NULL,
	`address` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`app_id`) REFERENCES `apps`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `app_system_wallets_purpose_idx` ON `app_system_wallets` (`app_id`,`purpose`);--> statement-breakpoint
CREATE TABLE `payment_events` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`processed_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sponsor_ledger` (
	`id` text PRIMARY KEY NOT NULL,
	`app_id` text NOT NULL,
	`kind` text NOT NULL,
	`amount_cents` integer NOT NULL,
	`reference` text NOT NULL,
	`meta` text,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`app_id`) REFERENCES `apps`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sponsor_ledger_reference_idx` ON `sponsor_ledger` (`reference`);--> statement-breakpoint
CREATE INDEX `sponsor_ledger_app_idx` ON `sponsor_ledger` (`app_id`,`created_at`);