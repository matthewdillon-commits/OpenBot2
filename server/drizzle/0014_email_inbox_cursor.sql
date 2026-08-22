CREATE TABLE "email_inbox_cursors" (
	"mailbox_key" text PRIMARY KEY NOT NULL,
	"uid_validity" integer NOT NULL,
	"last_uid" integer NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "scheduled_jobs" ADD COLUMN "match_from" text;--> statement-breakpoint
ALTER TABLE "scheduled_jobs" ADD COLUMN "match_to" text;--> statement-breakpoint
ALTER TABLE "scheduled_jobs" ADD COLUMN "match_subject" text;