CREATE TABLE "shared_computer_claim" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text DEFAULT 'org_local' NOT NULL,
	"claimed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "shared_computer_claim" ADD CONSTRAINT "shared_computer_claim_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;
