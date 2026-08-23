CREATE TYPE "public"."crm_created_by_kind" AS ENUM('user', 'bot', 'system');--> statement-breakpoint
CREATE TYPE "public"."crm_send_event_type" AS ENUM('sent', 'delivered', 'opened', 'clicked', 'failed', 'answered', 'no_answer');--> statement-breakpoint
CREATE TYPE "public"."crm_send_kind" AS ENUM('email', 'sms', 'call');--> statement-breakpoint
CREATE TYPE "public"."crm_send_status" AS ENUM('draft', 'queued', 'logged', 'sent', 'delivered', 'opened', 'clicked', 'failed', 'answered', 'no_answer');--> statement-breakpoint
CREATE TABLE "crm_campaigns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text DEFAULT 'org_local' NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"description" text,
	"started_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"notes" text,
	"created_by_kind" "crm_created_by_kind" DEFAULT 'system' NOT NULL,
	"created_by_id" text DEFAULT 'system' NOT NULL,
	"created_by_name" text DEFAULT 'System' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "crm_companies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text DEFAULT 'org_local' NOT NULL,
	"name" text NOT NULL,
	"domain" text,
	"website" text,
	"industry" text,
	"phone" text,
	"notes" text,
	"created_by_kind" "crm_created_by_kind" DEFAULT 'system' NOT NULL,
	"created_by_id" text DEFAULT 'system' NOT NULL,
	"created_by_name" text DEFAULT 'System' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "crm_conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text DEFAULT 'org_local' NOT NULL,
	"subject" text NOT NULL,
	"channel" text DEFAULT 'note' NOT NULL,
	"body" text,
	"person_id" uuid,
	"company_id" uuid,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_kind" "crm_created_by_kind" DEFAULT 'system' NOT NULL,
	"created_by_id" text DEFAULT 'system' NOT NULL,
	"created_by_name" text DEFAULT 'System' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "crm_opportunities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text DEFAULT 'org_local' NOT NULL,
	"name" text NOT NULL,
	"stage" text DEFAULT 'new' NOT NULL,
	"amount_cents" integer,
	"currency" text DEFAULT 'USD' NOT NULL,
	"company_id" uuid,
	"person_id" uuid,
	"expected_close_at" timestamp with time zone,
	"notes" text,
	"created_by_kind" "crm_created_by_kind" DEFAULT 'system' NOT NULL,
	"created_by_id" text DEFAULT 'system' NOT NULL,
	"created_by_name" text DEFAULT 'System' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "crm_people" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text DEFAULT 'org_local' NOT NULL,
	"name" text NOT NULL,
	"emails" text[] DEFAULT '{}' NOT NULL,
	"phones" text[] DEFAULT '{}' NOT NULL,
	"job_title" text,
	"company_id" uuid,
	"notes" text,
	"created_by_kind" "crm_created_by_kind" DEFAULT 'system' NOT NULL,
	"created_by_id" text DEFAULT 'system' NOT NULL,
	"created_by_name" text DEFAULT 'System' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "crm_send_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text DEFAULT 'org_local' NOT NULL,
	"send_id" uuid NOT NULL,
	"event_type" "crm_send_event_type" NOT NULL,
	"link_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "crm_sends" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text DEFAULT 'org_local' NOT NULL,
	"kind" "crm_send_kind" NOT NULL,
	"status" "crm_send_status" DEFAULT 'queued' NOT NULL,
	"subject" text,
	"body" text,
	"to_address" text NOT NULL,
	"person_id" uuid,
	"company_id" uuid,
	"campaign_id" uuid,
	"tracking_token" text NOT NULL,
	"provider" text DEFAULT 'logged' NOT NULL,
	"sent_at" timestamp with time zone,
	"created_by_kind" "crm_created_by_kind" DEFAULT 'system' NOT NULL,
	"created_by_id" text DEFAULT 'system' NOT NULL,
	"created_by_name" text DEFAULT 'System' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "crm_campaigns" ADD CONSTRAINT "crm_campaigns_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_companies" ADD CONSTRAINT "crm_companies_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_conversations" ADD CONSTRAINT "crm_conversations_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_conversations" ADD CONSTRAINT "crm_conversations_person_id_crm_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."crm_people"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_conversations" ADD CONSTRAINT "crm_conversations_company_id_crm_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."crm_companies"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_opportunities" ADD CONSTRAINT "crm_opportunities_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_opportunities" ADD CONSTRAINT "crm_opportunities_company_id_crm_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."crm_companies"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_opportunities" ADD CONSTRAINT "crm_opportunities_person_id_crm_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."crm_people"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_people" ADD CONSTRAINT "crm_people_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_people" ADD CONSTRAINT "crm_people_company_id_crm_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."crm_companies"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_send_events" ADD CONSTRAINT "crm_send_events_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_send_events" ADD CONSTRAINT "crm_send_events_send_id_crm_sends_id_fk" FOREIGN KEY ("send_id") REFERENCES "public"."crm_sends"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_sends" ADD CONSTRAINT "crm_sends_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_sends" ADD CONSTRAINT "crm_sends_person_id_crm_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."crm_people"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_sends" ADD CONSTRAINT "crm_sends_company_id_crm_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."crm_companies"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_sends" ADD CONSTRAINT "crm_sends_campaign_id_crm_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."crm_campaigns"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "crm_campaigns_org_status_idx" ON "crm_campaigns" USING btree ("org_id","status");--> statement-breakpoint
CREATE INDEX "crm_campaigns_org_created_at_idx" ON "crm_campaigns" USING btree ("org_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "crm_companies_org_name_idx" ON "crm_companies" USING btree ("org_id","name");--> statement-breakpoint
CREATE INDEX "crm_companies_org_created_at_idx" ON "crm_companies" USING btree ("org_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "crm_conversations_org_occurred_at_idx" ON "crm_conversations" USING btree ("org_id","occurred_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "crm_conversations_org_person_idx" ON "crm_conversations" USING btree ("org_id","person_id");--> statement-breakpoint
CREATE INDEX "crm_opportunities_org_stage_idx" ON "crm_opportunities" USING btree ("org_id","stage");--> statement-breakpoint
CREATE INDEX "crm_opportunities_org_created_at_idx" ON "crm_opportunities" USING btree ("org_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "crm_people_org_name_idx" ON "crm_people" USING btree ("org_id","name");--> statement-breakpoint
CREATE INDEX "crm_people_org_company_idx" ON "crm_people" USING btree ("org_id","company_id");--> statement-breakpoint
CREATE INDEX "crm_people_org_created_at_idx" ON "crm_people" USING btree ("org_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "crm_send_events_send_idx" ON "crm_send_events" USING btree ("send_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "crm_send_events_org_type_idx" ON "crm_send_events" USING btree ("org_id","event_type");--> statement-breakpoint
CREATE UNIQUE INDEX "crm_sends_tracking_token_key" ON "crm_sends" USING btree ("tracking_token");--> statement-breakpoint
CREATE INDEX "crm_sends_org_created_at_idx" ON "crm_sends" USING btree ("org_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "crm_sends_org_person_idx" ON "crm_sends" USING btree ("org_id","person_id");--> statement-breakpoint
CREATE INDEX "crm_sends_org_campaign_idx" ON "crm_sends" USING btree ("org_id","campaign_id");