CREATE TYPE "public"."job_trigger_kind" AS ENUM('cron', 'webhook', 'email');--> statement-breakpoint
CREATE TABLE "job_triggers" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text DEFAULT 'org_local' NOT NULL,
	"kind" "job_trigger_kind" NOT NULL,
	"channel_id" text NOT NULL,
	"goal_id" text NOT NULL,
	"thread_id" text NOT NULL,
	"coworker_id" text NOT NULL,
	"acting_user_id" text NOT NULL,
	"prompt" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"every_seconds" integer,
	"next_run_at" timestamp with time zone,
	"secret_hash" text,
	"mailbox" text,
	"last_enqueued_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "job_triggers" ADD CONSTRAINT "job_triggers_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_triggers" ADD CONSTRAINT "job_triggers_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_triggers" ADD CONSTRAINT "job_triggers_coworker_id_agents_id_fk" FOREIGN KEY ("coworker_id") REFERENCES "public"."agents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_triggers" ADD CONSTRAINT "job_triggers_acting_user_id_users_id_fk" FOREIGN KEY ("acting_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "job_triggers_org_kind_idx" ON "job_triggers" USING btree ("org_id","kind");--> statement-breakpoint
CREATE INDEX "job_triggers_cron_due_idx" ON "job_triggers" USING btree ("kind","enabled","next_run_at");--> statement-breakpoint
CREATE UNIQUE INDEX "job_triggers_mailbox_unique" ON "job_triggers" USING btree ("mailbox") WHERE "job_triggers"."mailbox" is not null;