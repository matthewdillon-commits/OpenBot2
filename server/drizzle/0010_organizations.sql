CREATE TYPE "public"."organization_role" AS ENUM('owner', 'admin', 'member');--> statement-breakpoint
CREATE TYPE "public"."organization_status" AS ENUM('active', 'suspended');--> statement-breakpoint
CREATE TABLE "organization_invites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"email" text NOT NULL,
	"role" "organization_role" NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"invited_by" text NOT NULL,
	"accepted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organization_invites_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "organization_memberships" (
	"org_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role" "organization_role" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organization_memberships_org_id_user_id_pk" PRIMARY KEY("org_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "organization_settings" (
	"org_id" text PRIMARY KEY NOT NULL,
	"display_name" text,
	"logo_url" text,
	"default_model" text,
	"feature_flags" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" text PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"status" "organization_status" DEFAULT 'active' NOT NULL,
	"plan" text DEFAULT 'enterprise' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organizations_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
INSERT INTO "organizations" ("id", "slug", "name", "status", "plan")
VALUES ('org_local', 'local', 'Local', 'active', 'enterprise');
--> statement-breakpoint
INSERT INTO "organization_settings" ("org_id") VALUES ('org_local');
--> statement-breakpoint
INSERT INTO "organization_memberships" ("org_id", "user_id", "role")
SELECT
  'org_local',
  "users"."id",
  CASE WHEN "user_roles"."role" = 'admin' THEN 'owner'::"organization_role" ELSE 'member'::"organization_role" END
FROM "users"
LEFT JOIN "user_roles" ON "user_roles"."user_id" = "users"."id"
ON CONFLICT DO NOTHING;
--> statement-breakpoint
UPDATE "action_policy" SET "id" = 'org_local' WHERE "id" = 'current';
--> statement-breakpoint
CREATE TABLE "user_preferences" (
	"user_id" text PRIMARY KEY NOT NULL,
	"active_org_id" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP INDEX "skills_slug_key";--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "org_id" text DEFAULT 'org_local' NOT NULL;--> statement-breakpoint
ALTER TABLE "audit_events" ADD COLUMN "org_id" text DEFAULT 'org_local' NOT NULL;--> statement-breakpoint
ALTER TABLE "channel_agents" ADD COLUMN "org_id" text DEFAULT 'org_local' NOT NULL;--> statement-breakpoint
ALTER TABLE "channel_memberships" ADD COLUMN "org_id" text DEFAULT 'org_local' NOT NULL;--> statement-breakpoint
ALTER TABLE "channels" ADD COLUMN "org_id" text DEFAULT 'org_local' NOT NULL;--> statement-breakpoint
ALTER TABLE "chunks" ADD COLUMN "org_id" text DEFAULT 'org_local' NOT NULL;--> statement-breakpoint
ALTER TABLE "connector_cursors" ADD COLUMN "org_id" text DEFAULT 'org_local' NOT NULL;--> statement-breakpoint
ALTER TABLE "connector_instances" ADD COLUMN "org_id" text DEFAULT 'org_local' NOT NULL;--> statement-breakpoint
ALTER TABLE "credentials" ADD COLUMN "org_id" text DEFAULT 'org_local' NOT NULL;--> statement-breakpoint
ALTER TABLE "document_acls" ADD COLUMN "org_id" text DEFAULT 'org_local' NOT NULL;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "org_id" text DEFAULT 'org_local' NOT NULL;--> statement-breakpoint
ALTER TABLE "intelligence_channel_mappings" ADD COLUMN "org_id" text DEFAULT 'org_local' NOT NULL;--> statement-breakpoint
ALTER TABLE "revoked_access" ADD COLUMN "org_id" text DEFAULT 'org_local' NOT NULL;--> statement-breakpoint
ALTER TABLE "sync_runs" ADD COLUMN "org_id" text DEFAULT 'org_local' NOT NULL;--> statement-breakpoint
ALTER TABLE "webhook_subscriptions" ADD COLUMN "org_id" text DEFAULT 'org_local' NOT NULL;--> statement-breakpoint
ALTER TABLE "action_policy" ADD COLUMN "org_id" text DEFAULT 'org_local' NOT NULL;--> statement-breakpoint
ALTER TABLE "computer_snapshot" ADD COLUMN "org_id" text DEFAULT 'org_local' NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_preferences" ADD COLUMN "org_id" text DEFAULT 'org_local' NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_profiles" ADD COLUMN "org_id" text DEFAULT 'org_local' NOT NULL;--> statement-breakpoint
ALTER TABLE "component_exclusions" ADD COLUMN "org_id" text DEFAULT 'org_local' NOT NULL;--> statement-breakpoint
ALTER TABLE "component_functions" ADD COLUMN "org_id" text DEFAULT 'org_local' NOT NULL;--> statement-breakpoint
ALTER TABLE "components" ADD COLUMN "org_id" text DEFAULT 'org_local' NOT NULL;--> statement-breakpoint
ALTER TABLE "mcp_servers" ADD COLUMN "org_id" text DEFAULT 'org_local' NOT NULL;--> statement-breakpoint
ALTER TABLE "mcp_tools" ADD COLUMN "org_id" text DEFAULT 'org_local' NOT NULL;--> statement-breakpoint
ALTER TABLE "plugin_grants" ADD COLUMN "org_id" text DEFAULT 'org_local' NOT NULL;--> statement-breakpoint
ALTER TABLE "sandboxed_components" ADD COLUMN "org_id" text DEFAULT 'org_local' NOT NULL;--> statement-breakpoint
ALTER TABLE "skills" ADD COLUMN "org_id" text DEFAULT 'org_local' NOT NULL;--> statement-breakpoint
ALTER TABLE "organization_invites" ADD CONSTRAINT "organization_invites_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_memberships" ADD CONSTRAINT "organization_memberships_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_memberships" ADD CONSTRAINT "organization_memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_settings" ADD CONSTRAINT "organization_settings_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_preferences" ADD CONSTRAINT "user_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_preferences" ADD CONSTRAINT "user_preferences_active_org_id_organizations_id_fk" FOREIGN KEY ("active_org_id") REFERENCES "public"."organizations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "organization_invites_org_email_idx" ON "organization_invites" USING btree ("org_id","email");--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_agents" ADD CONSTRAINT "channel_agents_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_memberships" ADD CONSTRAINT "channel_memberships_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channels" ADD CONSTRAINT "channels_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chunks" ADD CONSTRAINT "chunks_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connector_cursors" ADD CONSTRAINT "connector_cursors_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connector_instances" ADD CONSTRAINT "connector_instances_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credentials" ADD CONSTRAINT "credentials_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_acls" ADD CONSTRAINT "document_acls_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intelligence_channel_mappings" ADD CONSTRAINT "intelligence_channel_mappings_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "revoked_access" ADD CONSTRAINT "revoked_access_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_runs" ADD CONSTRAINT "sync_runs_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_subscriptions" ADD CONSTRAINT "webhook_subscriptions_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "action_policy" ADD CONSTRAINT "action_policy_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "computer_snapshot" ADD CONSTRAINT "computer_snapshot_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_preferences" ADD CONSTRAINT "agent_preferences_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_profiles" ADD CONSTRAINT "agent_profiles_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "component_exclusions" ADD CONSTRAINT "component_exclusions_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "component_functions" ADD CONSTRAINT "component_functions_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "components" ADD CONSTRAINT "components_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_servers" ADD CONSTRAINT "mcp_servers_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_tools" ADD CONSTRAINT "mcp_tools_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plugin_grants" ADD CONSTRAINT "plugin_grants_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sandboxed_components" ADD CONSTRAINT "sandboxed_components_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skills" ADD CONSTRAINT "skills_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "skills_org_slug_key" ON "skills" USING btree ("org_id","slug");