CREATE TYPE "public"."subagent_status" AS ENUM('queued', 'running', 'completed', 'blocked', 'failed');--> statement-breakpoint
CREATE TABLE "subagent_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"parent_agent_id" text NOT NULL,
	"actor_user_id" text NOT NULL,
	"channel_id" text NOT NULL,
	"goal" text NOT NULL,
	"success_criteria" text NOT NULL,
	"report_back" text NOT NULL,
	"follow_up" text,
	"follow_up_at" timestamp with time zone,
	"status" "subagent_status" DEFAULT 'queued' NOT NULL,
	"result" text,
	"hop" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "subagent_runs" ADD CONSTRAINT "subagent_runs_parent_agent_id_agents_id_fk" FOREIGN KEY ("parent_agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subagent_runs" ADD CONSTRAINT "subagent_runs_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subagent_runs" ADD CONSTRAINT "subagent_runs_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "subagent_runs_parent_created_idx" ON "subagent_runs" USING btree ("parent_agent_id","created_at");--> statement-breakpoint
CREATE INDEX "subagent_runs_channel_idx" ON "subagent_runs" USING btree ("channel_id");