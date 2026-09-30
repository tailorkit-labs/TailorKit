CREATE TABLE `todos` (
	`id` text PRIMARY KEY,
	`text` text NOT NULL,
	`done` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `tk_receipts` (
	`key` text PRIMARY KEY,
	`fingerprint` text NOT NULL,
	`result` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `tk_state` (
	`key` text PRIMARY KEY,
	`value` integer NOT NULL
);
