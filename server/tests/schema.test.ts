import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { getTableName } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";
import {
  accounts,
  agentPreferences,
  agentProfiles,
  agents,
  agentVisibility,
  auditEvents,
  channelAgents,
  channelMemberships,
  channels,
  chunks,
  connectorCursors,
  connectorInstances,
  credentials,
  crmCampaignListMembers,
  crmCampaignLists,
  crmCampaigns,
  crmCompanies,
  crmConversations,
  crmOpportunities,
  crmPeople,
  crmSendEvents,
  crmSends,
  documentAcls,
  documents,
  intelligenceChannelMappings,
  jobStatus,
  jobs,
  jobTriggerKind,
  jobTriggers,
  sessions,
  sharedComputerClaim,
  syncRuns,
  userRoles,
  users,
  verifications,
} from "../src/db/schema";

describe("OpenBot database schema", () => {
  test("defines the core runtime records", () => {
    expect(
      [
        users,
        sessions,
        accounts,
        verifications,
        userRoles,
        agents,
        channels,
        channelMemberships,
        channelAgents,
        credentials,
        connectorInstances,
        connectorCursors,
        syncRuns,
        documents,
        chunks,
        documentAcls,
        auditEvents,
        intelligenceChannelMappings,
      ].map(getTableName),
    ).toEqual([
      "users",
      "sessions",
      "accounts",
      "verifications",
      "user_roles",
      "agents",
      "channels",
      "channel_memberships",
      "channel_agents",
      "credentials",
      "connector_instances",
      "connector_cursors",
      "sync_runs",
      "documents",
      "chunks",
      "document_acls",
      "audit_events",
      "intelligence_channel_mappings",
    ]);
  });

  test("keeps document embeddings and ACLs separate from document metadata", () => {
    expect(Object.keys(documents)).toEqual(
      expect.arrayContaining([
        "id",
        "connectorInstanceId",
        "sourceId",
        "canonicalUrl",
      ]),
    );
    expect(Object.keys(chunks)).toEqual(
      expect.arrayContaining(["documentId", "embedding"]),
    );
    expect(Object.keys(documentAcls)).toEqual(
      expect.arrayContaining(["documentId", "principal", "effect"]),
    );
  });

  test("includes Better Auth's verified Google identity records", () => {
    expect(Object.keys(users)).toContain("emailVerified");
    expect(Object.keys(sessions)).toEqual(
      expect.arrayContaining(["ipAddress", "userAgent"]),
    );
    expect(Object.keys(accounts)).toEqual(
      expect.arrayContaining(["userId", "providerId", "accountId"]),
    );
  });

  test("defines the exact agent profile and roster preference contracts", () => {
    expect([agentProfiles, agentPreferences].map(getTableName)).toEqual([
      "agent_profiles",
      "agent_preferences",
    ]);
    expect(agentVisibility.enumName).toBe("agent_visibility");
    expect(agentVisibility.enumValues).toEqual(["public", "private"]);

    const profileConfig = getTableConfig(agentProfiles);
    const preferenceConfig = getTableConfig(agentPreferences);

    expect(
      profileConfig.columns.map((column) => ({
        name: column.name,
        notNull: column.notNull,
        hasDefault: column.hasDefault,
        primary: column.primary,
      })),
    ).toEqual([
      { name: "agent_id", notNull: true, hasDefault: false, primary: true },
      {
        name: "org_id",
        notNull: true,
        hasDefault: true,
        primary: false,
      },
      {
        name: "owner_user_id",
        notNull: false,
        hasDefault: false,
        primary: false,
      },
      { name: "title", notNull: true, hasDefault: false, primary: false },
      {
        name: "role_description",
        notNull: true,
        hasDefault: false,
        primary: false,
      },
      {
        name: "avatar_seed",
        notNull: true,
        hasDefault: false,
        primary: false,
      },
      {
        name: "visibility",
        notNull: true,
        hasDefault: false,
        primary: false,
      },
      /*
       * Nullable, and that is the security property.
       *
       * Null means this agent holds no credential and may not call a tool back, which is what a URL
       * somebody pasted gets until an administrator hands it one.
       */
      {
        name: "callback_token_hash",
        notNull: false,
        hasDefault: false,
        primary: false,
      },
      {
        name: "callback_token_issued_at",
        notNull: false,
        hasDefault: false,
        primary: false,
      },
      {
        name: "deleted_at",
        notNull: false,
        hasDefault: false,
        primary: false,
      },
      {
        name: "created_at",
        notNull: true,
        hasDefault: true,
        primary: false,
      },
      {
        name: "updated_at",
        notNull: true,
        hasDefault: true,
        primary: false,
      },
    ]);

    expect(
      preferenceConfig.columns.map((column) => ({
        name: column.name,
        sqlType: column.getSQLType(),
        notNull: column.notNull,
        hasDefault: column.hasDefault,
        primary: column.primary,
      })),
    ).toEqual([
      {
        name: "org_id",
        sqlType: "text",
        notNull: true,
        hasDefault: true,
        primary: false,
      },
      {
        name: "user_id",
        sqlType: "text",
        notNull: true,
        hasDefault: false,
        primary: false,
      },
      {
        name: "agent_id",
        sqlType: "text",
        notNull: true,
        hasDefault: false,
        primary: false,
      },
      {
        name: "hidden_at",
        sqlType: "timestamp with time zone",
        notNull: false,
        hasDefault: false,
        primary: false,
      },
    ]);

    expect(
      [...profileConfig.foreignKeys, ...preferenceConfig.foreignKeys].map(
        (foreignKey) => {
          const reference = foreignKey.reference();
          return {
            sourceColumns: reference.columns.map((column) => column.name),
            targetTable: getTableName(reference.foreignTable),
            targetColumns: reference.foreignColumns.map(
              (column) => column.name,
            ),
            onDelete: foreignKey.onDelete,
            onUpdate: foreignKey.onUpdate,
          };
        },
      ),
    ).toEqual([
      {
        sourceColumns: ["agent_id"],
        targetTable: "agents",
        targetColumns: ["id"],
        onDelete: "cascade",
        onUpdate: "no action",
      },
      {
        sourceColumns: ["org_id"],
        targetTable: "organizations",
        targetColumns: ["id"],
        onDelete: "restrict",
        onUpdate: "no action",
      },
      {
        sourceColumns: ["owner_user_id"],
        targetTable: "users",
        targetColumns: ["id"],
        onDelete: "set null",
        onUpdate: "no action",
      },
      {
        sourceColumns: ["org_id"],
        targetTable: "organizations",
        targetColumns: ["id"],
        onDelete: "restrict",
        onUpdate: "no action",
      },
      {
        sourceColumns: ["user_id"],
        targetTable: "users",
        targetColumns: ["id"],
        onDelete: "cascade",
        onUpdate: "no action",
      },
      {
        sourceColumns: ["agent_id"],
        targetTable: "agents",
        targetColumns: ["id"],
        onDelete: "cascade",
        onUpdate: "no action",
      },
    ]);

    expect(
      preferenceConfig.primaryKeys.map((primaryKey) => ({
        name: primaryKey.getName(),
        columns: primaryKey.columns.map((column) => column.name),
      })),
    ).toEqual([
      {
        name: "agent_preferences_user_id_agent_id_pk",
        columns: ["user_id", "agent_id"],
      },
    ]);

    expect(
      profileConfig.indexes.map((index) => ({
        name: index.config.name,
        columns: index.config.columns.map((column) =>
          "name" in column ? column.name : undefined,
        ),
        unique: index.config.unique,
        method: index.config.method,
      })),
    ).toEqual([
      {
        name: "agent_profiles_visibility_deleted_idx",
        columns: ["visibility", "deleted_at"],
        unique: false,
        method: "btree",
      },
    ]);
  });

  /*
   * The callback columns arrive as an alteration, not in the base schema.
   *
   * Every deployment of this has already applied 0000, so editing it in place changes a file the
   * database has recorded as run and the columns never appear. They are added by 0001, and this
   * says so, because the alternative failure is silent: the code reads a column the deployment
   * does not have.
   */
  test("defines the CRM records, scoped to an organization", () => {
    expect(
      [
        crmCompanies,
        crmPeople,
        crmOpportunities,
        crmCampaigns,
        crmCampaignLists,
        crmCampaignListMembers,
        crmConversations,
        crmSends,
        crmSendEvents,
      ].map(getTableName),
    ).toEqual([
      "crm_companies",
      "crm_people",
      "crm_opportunities",
      "crm_campaigns",
      "crm_campaign_lists",
      "crm_campaign_list_members",
      "crm_conversations",
      "crm_sends",
      "crm_send_events",
    ]);
    expect(Object.keys(crmPeople)).toEqual(
      expect.arrayContaining([
        "orgId",
        "name",
        "emails",
        "phones",
        "companyId",
        "stageKey",
        "doNotContact",
        "linkedinUrl",
        "location",
        "timezone",
        "source",
      ]),
    );
    expect(Object.keys(crmOpportunities)).toEqual(
      expect.arrayContaining(["orgId", "name", "stage", "position"]),
    );
    expect(Object.keys(crmSends)).toEqual(
      expect.arrayContaining([
        "orgId",
        "kind",
        "toAddress",
        "trackingToken",
        "status",
      ]),
    );
  });

  test("adds the CRM tables in their own migration", async () => {
    const migration = await readFile(
      new URL("../drizzle/0011_crm.sql", import.meta.url),
      "utf8",
    );
    expect(migration).toContain(`CREATE TABLE "crm_people"`);
    expect(migration).toContain(`CREATE TABLE "crm_companies"`);
    expect(migration).toContain(`CREATE TABLE "crm_sends"`);
    expect(migration).toContain(`"org_id" text DEFAULT 'org_local' NOT NULL`);
    expect(migration).toContain(`"tracking_token" text NOT NULL`);
    expect(migration).toContain(
      `CREATE UNIQUE INDEX "crm_sends_tracking_token_key"`,
    );
  });

  test("adds LimitlessAI-2 record fields and campaign lists in their own migration", async () => {
    const migration = await readFile(
      new URL("../drizzle/0013_crm_lai2_record.sql", import.meta.url),
      "utf8",
    );
    expect(migration).toContain(`CREATE TABLE "crm_campaign_lists"`);
    expect(migration).toContain(`CREATE TABLE "crm_campaign_list_members"`);
    expect(migration).toContain(`"linkedin_url"`);
    expect(migration).toContain(
      `ALTER TABLE "crm_companies" ADD COLUMN "location"`,
    );
  });

  test("defines unattended jobs isolated by org_id", () => {
    expect(getTableName(jobs)).toBe("jobs");
    expect(jobStatus.enumValues).toEqual([
      "queued",
      "running",
      "succeeded",
      "failed",
      "cancelled",
    ]);
    expect(Object.keys(jobs)).toEqual(
      expect.arrayContaining([
        "orgId",
        "channelId",
        "goalId",
        "coworkerId",
        "actingUserId",
        "trigger",
        "payload",
        "status",
        "threadId",
        "needsYou",
        "error",
        "outcome",
      ]),
    );
  });

  test("adds unattended jobs in their own migration", async () => {
    const migration = await readFile(
      new URL("../drizzle/0014_unattended_jobs.sql", import.meta.url),
      "utf8",
    );
    expect(migration).toContain(`CREATE TABLE "jobs"`);
    expect(migration).toContain(`"org_id" text DEFAULT 'org_local' NOT NULL`);
    expect(migration).toContain(`jobs_one_running_per_thread`);
    expect(migration).toContain(`"needs_you"`);
    expect(migration).toContain(`"goal_id"`);
    expect(migration).toContain(`"outcome" jsonb`);
  });

  test("defines standing job triggers isolated by org_id", () => {
    expect(getTableName(jobTriggers)).toBe("job_triggers");
    expect(jobTriggerKind.enumValues).toEqual(["cron", "webhook", "email"]);
    expect(Object.keys(jobTriggers)).toEqual(
      expect.arrayContaining([
        "orgId",
        "kind",
        "channelId",
        "goalId",
        "threadId",
        "coworkerId",
        "actingUserId",
        "prompt",
        "everySeconds",
        "nextRunAt",
        "secretHash",
        "mailbox",
      ]),
    );
  });

  test("adds standing job triggers in their own migration", async () => {
    const migration = await readFile(
      new URL("../drizzle/0016_job_triggers.sql", import.meta.url),
      "utf8",
    );
    expect(migration).toContain(`CREATE TABLE "job_triggers"`);
    expect(migration).toContain(`"org_id" text DEFAULT 'org_local' NOT NULL`);
    expect(migration).toContain(`job_triggers_mailbox_unique`);
    expect(migration).toContain(`"every_seconds"`);
    expect(migration).toContain(`"secret_hash"`);
  });

  test("defines the shared Chromium claim isolated by org_id", () => {
    expect(getTableName(sharedComputerClaim)).toBe("shared_computer_claim");
    expect(Object.keys(sharedComputerClaim)).toEqual(
      expect.arrayContaining(["id", "orgId", "claimedAt"]),
    );
  });

  test("adds the shared computer claim in its own migration", async () => {
    const migration = await readFile(
      new URL("../drizzle/0015_shared_computer_claim.sql", import.meta.url),
      "utf8",
    );
    expect(migration).toContain(`CREATE TABLE "shared_computer_claim"`);
    expect(migration).toContain(`"org_id" text DEFAULT 'org_local' NOT NULL`);
    expect(migration).toContain(`PRIMARY KEY`);
  });

  test("adds LimitlessAI-2 stages in their own migration", async () => {
    const migration = await readFile(
      new URL("../drizzle/0012_crm_stages.sql", import.meta.url),
      "utf8",
    );
    expect(migration).toContain(`"stage_key"`);
    expect(migration).toContain(`"do_not_contact"`);
    expect(migration).toContain(`"position"`);
    expect(migration).toContain(`SET DEFAULT 'qualify'`);
  });

  test("adds the callback token columns in their own migration", async () => {
    const migration = await readFile(
      new URL("../drizzle/0001_swift_morph.sql", import.meta.url),
      "utf8",
    );
    expect(migration).toContain(
      `ALTER TABLE "agent_profiles" ADD COLUMN "callback_token_hash" text;`,
    );
    expect(migration).toContain(
      `ALTER TABLE "agent_profiles" ADD COLUMN "callback_token_issued_at" timestamp with time zone;`,
    );
  });

  test("keeps the agent profile migration aligned with the schema", async () => {
    const migration = await readFile(
      new URL("../drizzle/0000_schema.sql", import.meta.url),
      "utf8",
    );
    const normalizedMigration = migration.replace(/\s+/g, " ").trim();

    expect(normalizedMigration).toContain(
      `CREATE TYPE "public"."agent_visibility" AS ENUM('public', 'private')`,
    );
    expect(normalizedMigration).toContain(
      `"agent_id" text PRIMARY KEY NOT NULL, "owner_user_id" text, "title" text NOT NULL, "role_description" text NOT NULL, "avatar_seed" text NOT NULL, "visibility" "agent_visibility" NOT NULL, "deleted_at" timestamp with time zone, "created_at" timestamp with time zone DEFAULT now() NOT NULL, "updated_at" timestamp with time zone DEFAULT now() NOT NULL`,
    );
    expect(normalizedMigration).toContain(
      `CREATE TABLE "agent_preferences" ( "user_id" text NOT NULL, "agent_id" text NOT NULL, "hidden_at" timestamp with time zone,`,
    );
    expect(normalizedMigration).toContain(
      `CONSTRAINT "agent_preferences_user_id_agent_id_pk" PRIMARY KEY("user_id","agent_id")`,
    );
    expect(normalizedMigration).toContain(
      `ALTER TABLE "agent_profiles" ADD CONSTRAINT "agent_profiles_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action`,
    );
    expect(normalizedMigration).toContain(
      `ALTER TABLE "agent_profiles" ADD CONSTRAINT "agent_profiles_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action`,
    );
    expect(normalizedMigration).toContain(
      `ALTER TABLE "agent_preferences" ADD CONSTRAINT "agent_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action`,
    );
    expect(normalizedMigration).toContain(
      `ALTER TABLE "agent_preferences" ADD CONSTRAINT "agent_preferences_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action`,
    );
    expect(normalizedMigration).toContain(
      `CREATE INDEX "agent_profiles_visibility_deleted_idx" ON "agent_profiles" USING btree ("visibility","deleted_at")`,
    );
  });

  test("persists the Phase 5 loop on the existing channel", () => {
    expect(Object.keys(channels)).toEqual(expect.arrayContaining(["loop"]));
  });

  test("adds the goal loop column in its own migration", async () => {
    const migration = await readFile(
      new URL("../drizzle/0017_channel_loop.sql", import.meta.url),
      "utf8",
    );
    expect(migration).toContain(
      `ALTER TABLE "channels" ADD COLUMN "loop" jsonb`,
    );
  });
});
