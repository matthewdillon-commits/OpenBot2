CREATE TYPE "public"."job_status" AS ENUM('queued', 'running', 'succeeded', 'failed', 'cancelled');--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text DEFAULT 'org_local' NOT NULL,
	"channel_id" text NOT NULL,
	"goal_id" text NOT NULL,
	"coworker_id" text NOT NULL,
	"acting_user_id" text NOT NULL,
	"trigger" text DEFAULT 'manual' NOT NULL,
	"payload" jsonb NOT NULL,
	"status" "job_status" DEFAULT 'queued' NOT NULL,
	"thread_id" text NOT NULL,
	"needs_you" boolean DEFAULT false NOT NULL,
	"error" text,
	"outcome" jsonb,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_coworker_id_agents_id_fk" FOREIGN KEY ("coworker_id") REFERENCES "public"."agents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_acting_user_id_users_id_fk" FOREIGN KEY ("acting_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "jobs_org_status_created_idx" ON "jobs" USING btree ("org_id","status","created_at");--> statement-breakpoint
CREATE INDEX "jobs_org_channel_idx" ON "jobs" USING btree ("org_id","channel_id");--> statement-breakpoint
CREATE UNIQUE INDEX "jobs_one_running_per_thread" ON "jobs" USING btree ("thread_id") WHERE "jobs"."status" = 'running';
