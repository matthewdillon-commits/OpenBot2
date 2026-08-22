CREATE TYPE "public"."job_run_status" AS ENUM('queued', 'running', 'succeeded', 'failed');--> statement-breakpoint
CREATE TYPE "public"."job_run_trigger" AS ENUM('cron', 'webhook', 'email');--> statement-breakpoint
CREATE TYPE "public"."scheduled_job_kind" AS ENUM('cron', 'webhook', 'email');--> statement-breakpoint
CREATE TYPE "public"."scheduled_job_status" AS ENUM('active', 'paused');--> statement-breakpoint
CREATE TABLE "job_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"job_id" text NOT NULL,
	"status" "job_run_status" DEFAULT 'queued' NOT NULL,
	"trigger" "job_run_trigger" NOT NULL,
	"result" text,
	"error" text,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scheduled_jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"agent_id" text NOT NULL,
	"kind" "scheduled_job_kind" NOT NULL,
	"cron_expr" text,
	"weekday_bounded" boolean DEFAULT true NOT NULL,
	"timezone" text NOT NULL,
	"brief" text NOT NULL,
	"status" "scheduled_job_status" DEFAULT 'active' NOT NULL,
	"last_run_at" timestamp with time zone,
	"next_run_at" timestamp with time zone,
	"webhook_secret_hash" text,
	"channel_id" text,
	"created_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "job_runs" ADD CONSTRAINT "job_runs_job_id_scheduled_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."scheduled_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_jobs" ADD CONSTRAINT "scheduled_jobs_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_jobs" ADD CONSTRAINT "scheduled_jobs_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_jobs" ADD CONSTRAINT "scheduled_jobs_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "job_runs_job_created_idx" ON "job_runs" USING btree ("job_id","created_at");--> statement-breakpoint
CREATE INDEX "job_runs_status_idx" ON "job_runs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "scheduled_jobs_due_idx" ON "scheduled_jobs" USING btree ("status","next_run_at");--> statement-breakpoint
CREATE INDEX "scheduled_jobs_agent_idx" ON "scheduled_jobs" USING btree ("agent_id");