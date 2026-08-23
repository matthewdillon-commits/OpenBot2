ALTER TABLE "crm_companies" ADD COLUMN "location" text;--> statement-breakpoint
ALTER TABLE "crm_people" ADD COLUMN "linkedin_url" text;--> statement-breakpoint
ALTER TABLE "crm_people" ADD COLUMN "location" text;--> statement-breakpoint
ALTER TABLE "crm_people" ADD COLUMN "timezone" text;--> statement-breakpoint
ALTER TABLE "crm_people" ADD COLUMN "source" text DEFAULT 'manual' NOT NULL;--> statement-breakpoint
CREATE TABLE "crm_campaign_lists" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text DEFAULT 'org_local' NOT NULL,
	"campaign_id" uuid NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "crm_campaign_list_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text DEFAULT 'org_local' NOT NULL,
	"list_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"added_by" text DEFAULT 'user' NOT NULL,
	"source" text,
	"status" text DEFAULT 'active' NOT NULL,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "crm_campaign_lists" ADD CONSTRAINT "crm_campaign_lists_campaign_id_crm_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."crm_campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_campaign_list_members" ADD CONSTRAINT "crm_campaign_list_members_list_id_crm_campaign_lists_id_fk" FOREIGN KEY ("list_id") REFERENCES "public"."crm_campaign_lists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_campaign_list_members" ADD CONSTRAINT "crm_campaign_list_members_person_id_crm_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."crm_people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "crm_campaign_lists_campaign_slug_uidx" ON "crm_campaign_lists" USING btree ("campaign_id","slug");--> statement-breakpoint
CREATE INDEX "crm_campaign_lists_org_campaign_idx" ON "crm_campaign_lists" USING btree ("org_id","campaign_id");--> statement-breakpoint
CREATE UNIQUE INDEX "crm_campaign_list_members_list_person_uidx" ON "crm_campaign_list_members" USING btree ("list_id","person_id");--> statement-breakpoint
CREATE INDEX "crm_campaign_list_members_list_status_idx" ON "crm_campaign_list_members" USING btree ("list_id","status");--> statement-breakpoint
CREATE INDEX "crm_campaign_list_members_person_idx" ON "crm_campaign_list_members" USING btree ("person_id");--> statement-breakpoint
CREATE INDEX "crm_campaign_list_members_org_idx" ON "crm_campaign_list_members" USING btree ("org_id");
