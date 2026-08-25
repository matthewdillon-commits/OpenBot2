CREATE TABLE "organization_spend_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text DEFAULT 'org_local' NOT NULL,
	"kind" text NOT NULL,
	"cents" integer NOT NULL,
	"job_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organization_sso" (
	"org_id" text PRIMARY KEY NOT NULL,
	"google_enabled" boolean DEFAULT true NOT NULL,
	"microsoft_enabled" boolean DEFAULT true NOT NULL,
	"okta_enabled" boolean DEFAULT true NOT NULL,
	"email_enabled" boolean DEFAULT true NOT NULL,
	"domains" text[] DEFAULT '{}' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "organizations" ALTER COLUMN "plan" SET DEFAULT 'free';--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "seat_limit" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "spend_cap_cents" integer;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "stripe_customer_id" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "stripe_subscription_id" text;--> statement-breakpoint
ALTER TABLE "organization_spend_events" ADD CONSTRAINT "organization_spend_events_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_sso" ADD CONSTRAINT "organization_sso_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "organization_spend_events_org_idx" ON "organization_spend_events" USING btree ("org_id","created_at");
--> statement-breakpoint
UPDATE "organizations" SET "seat_limit" = 100 WHERE "plan" = 'enterprise';
--> statement-breakpoint
UPDATE "organizations" SET "seat_limit" = 20 WHERE "plan" = 'growth';
--> statement-breakpoint
UPDATE "organizations" SET "seat_limit" = 5 WHERE "plan" = 'starter';
--> statement-breakpoint
INSERT INTO "organization_sso" ("org_id", "domains")
SELECT "id", '{}'::text[] FROM "organizations"
ON CONFLICT ("org_id") DO NOTHING;
--> statement-breakpoint
-- RLS is the second fence on org-owned tables. Query-scoped org_id remains.
-- Empty app.current_org_id (or bypass on) sees every row: migrations, boot,
-- the worker claim loop. Authenticated tenant requests set the org id.
-- shared_computer_claim is skipped: the first org to use the shared Chromium
-- must remain visible to a second org so it can be refused.
-- Replica B uses the same Postgres; nothing is held in a Map.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'openbot_rls') THEN
    CREATE ROLE openbot_rls NOLOGIN NOSUPERUSER NOBYPASSRLS;
  END IF;
END
$$;
--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO openbot_rls;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO openbot_rls;
--> statement-breakpoint
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO openbot_rls;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO openbot_rls;
--> statement-breakpoint
GRANT openbot_rls TO CURRENT_USER;
--> statement-breakpoint
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT c.relname AS table_name
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_attribute a ON a.attrelid = c.oid
    WHERE n.nspname = 'public'
      AND c.relkind = 'r'
      AND a.attname = 'org_id'
      AND NOT a.attisdropped
      AND c.relname <> 'shared_computer_claim'
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', r.table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', r.table_name);
    EXECUTE format('DROP POLICY IF EXISTS org_isolation ON %I', r.table_name);
    EXECUTE format(
      $p$
      CREATE POLICY org_isolation ON %I
        USING (
          current_setting('app.bypass_rls', true) = 'on'
          OR coalesce(current_setting('app.current_org_id', true), '') = ''
          OR org_id = current_setting('app.current_org_id', true)
        )
        WITH CHECK (
          current_setting('app.bypass_rls', true) = 'on'
          OR coalesce(current_setting('app.current_org_id', true), '') = ''
          OR org_id = current_setting('app.current_org_id', true)
        )
      $p$,
      r.table_name
    );
  END LOOP;
END
$$;
