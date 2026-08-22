CREATE TYPE "public"."crm_created_by_kind" AS ENUM('user', 'bot', 'system');--> statement-breakpoint
CREATE TABLE "crm_campaigns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
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
ALTER TABLE "crm_conversations" ADD CONSTRAINT "crm_conversations_person_id_crm_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."crm_people"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_conversations" ADD CONSTRAINT "crm_conversations_company_id_crm_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."crm_companies"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_opportunities" ADD CONSTRAINT "crm_opportunities_company_id_crm_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."crm_companies"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_opportunities" ADD CONSTRAINT "crm_opportunities_person_id_crm_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."crm_people"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_people" ADD CONSTRAINT "crm_people_company_id_crm_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."crm_companies"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "crm_campaigns_status_idx" ON "crm_campaigns" USING btree ("status");--> statement-breakpoint
CREATE INDEX "crm_campaigns_created_at_idx" ON "crm_campaigns" USING btree ("created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "crm_companies_name_idx" ON "crm_companies" USING btree ("name");--> statement-breakpoint
CREATE INDEX "crm_companies_created_at_idx" ON "crm_companies" USING btree ("created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "crm_conversations_occurred_at_idx" ON "crm_conversations" USING btree ("occurred_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "crm_conversations_person_idx" ON "crm_conversations" USING btree ("person_id");--> statement-breakpoint
CREATE INDEX "crm_opportunities_stage_idx" ON "crm_opportunities" USING btree ("stage");--> statement-breakpoint
CREATE INDEX "crm_opportunities_created_at_idx" ON "crm_opportunities" USING btree ("created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "crm_people_name_idx" ON "crm_people" USING btree ("name");--> statement-breakpoint
CREATE INDEX "crm_people_company_idx" ON "crm_people" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "crm_people_created_at_idx" ON "crm_people" USING btree ("created_at" DESC NULLS LAST,"id" DESC NULLS LAST);