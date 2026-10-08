CREATE TABLE `todos` (
	`id` text PRIMARY KEY,
	`text` text NOT NULL,
	`done` integer DEFAULT false NOT NULL
);
