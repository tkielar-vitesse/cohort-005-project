CREATE TABLE `notification_submissions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`event_key` text NOT NULL,
	`recipient_id` integer NOT NULL,
	`actor_id` integer NOT NULL,
	`workflow` text NOT NULL,
	`data` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`created_at` integer NOT NULL,
	`state` text DEFAULT 'pending' NOT NULL,
	`first_attempt_at` integer,
	`attempts` integer DEFAULT 0 NOT NULL,
	`next_attempt_at` integer DEFAULT 0 NOT NULL,
	`claim_token` text,
	`lease_until` integer,
	`workflow_run_id` text,
	`last_error` text,
	`finished_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `notification_submissions_idempotency_key_unique` ON `notification_submissions` (`idempotency_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `notification_event_recipient_unique` ON `notification_submissions` (`event_key`,`recipient_id`);--> statement-breakpoint
CREATE INDEX `notification_submissions_due_idx` ON `notification_submissions` (`state`,`next_attempt_at`);