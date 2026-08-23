ALTER TABLE "crm_opportunities" ALTER COLUMN "stage" SET DEFAULT 'qualify';--> statement-breakpoint
ALTER TABLE "crm_opportunities" ADD COLUMN "position" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "crm_people" ADD COLUMN "stage_key" text DEFAULT 'new' NOT NULL;--> statement-breakpoint
ALTER TABLE "crm_people" ADD COLUMN "do_not_contact" boolean DEFAULT false NOT NULL;--> statement-breakpoint
UPDATE "crm_opportunities" SET "stage" = 'qualify' WHERE "stage" = 'new';--> statement-breakpoint
CREATE INDEX "crm_people_org_stage_idx" ON "crm_people" USING btree ("org_id","stage_key");
