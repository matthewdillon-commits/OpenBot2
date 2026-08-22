/**
 * CRM tables: people, companies, opportunities, campaigns, conversations.
 *
 * This is the deployment's customer record, not the signed-in directory. `/admin/people` is who
 * may use OpenBot. These rows are who the deployment is talking to — a prospect, a vendor, a
 * contact a Bot wrote down. Split into its own schema file so a parallel track can add email or
 * schedule tables without colliding here.
 */
import {
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

const createdAt = () =>
  timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();

/**
 * Who wrote the row, as a kind rather than a foreign key.
 *
 * A Bot and a person are not the same table, and a system import has no row at all. Storing the
 * display name beside the id means a later rename or a deleted Bot still reads as who created it.
 */
export const crmCreatedByKind = pgEnum("crm_created_by_kind", [
  "user",
  "bot",
  "system",
]);

const createdByColumns = () => ({
  createdByKind: crmCreatedByKind("created_by_kind")
    .notNull()
    .default("system"),
  createdById: text("created_by_id").notNull().default("system"),
  createdByName: text("created_by_name").notNull().default("System"),
});

export const crmCompanies = pgTable(
  "crm_companies",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    /** Host used for the favicon and for matching a person to a company. */
    domain: text("domain"),
    website: text("website"),
    industry: text("industry"),
    phone: text("phone"),
    notes: text("notes"),
    ...createdByColumns(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index("crm_companies_name_idx").on(table.name),
    index("crm_companies_created_at_idx").on(
      table.createdAt.desc(),
      table.id.desc(),
    ),
  ],
);

export const crmPeople = pgTable(
  "crm_people",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    emails: text("emails").array().notNull().default([]),
    phones: text("phones").array().notNull().default([]),
    jobTitle: text("job_title"),
    companyId: uuid("company_id").references(() => crmCompanies.id, {
      onDelete: "set null",
    }),
    notes: text("notes"),
    ...createdByColumns(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index("crm_people_name_idx").on(table.name),
    index("crm_people_company_idx").on(table.companyId),
    index("crm_people_created_at_idx").on(
      table.createdAt.desc(),
      table.id.desc(),
    ),
  ],
);

export const crmOpportunities = pgTable(
  "crm_opportunities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    stage: text("stage").notNull().default("new"),
    amountCents: integer("amount_cents"),
    currency: text("currency").notNull().default("USD"),
    companyId: uuid("company_id").references(() => crmCompanies.id, {
      onDelete: "set null",
    }),
    personId: uuid("person_id").references(() => crmPeople.id, {
      onDelete: "set null",
    }),
    expectedCloseAt: timestamp("expected_close_at", { withTimezone: true }),
    notes: text("notes"),
    ...createdByColumns(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index("crm_opportunities_stage_idx").on(table.stage),
    index("crm_opportunities_created_at_idx").on(
      table.createdAt.desc(),
      table.id.desc(),
    ),
  ],
);

export const crmCampaigns = pgTable(
  "crm_campaigns",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    status: text("status").notNull().default("draft"),
    description: text("description"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    notes: text("notes"),
    ...createdByColumns(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index("crm_campaigns_status_idx").on(table.status),
    index("crm_campaigns_created_at_idx").on(
      table.createdAt.desc(),
      table.id.desc(),
    ),
  ],
);

export const crmConversations = pgTable(
  "crm_conversations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    subject: text("subject").notNull(),
    /**
     * How the conversation happened: email, call, meeting, chat, note.
     *
     * A label, not a foreign key into a messaging system. This track does not own inbound mail
     * or channel threads; it records that a conversation existed so a person or a Bot can find it.
     */
    channel: text("channel").notNull().default("note"),
    body: text("body"),
    personId: uuid("person_id").references(() => crmPeople.id, {
      onDelete: "set null",
    }),
    companyId: uuid("company_id").references(() => crmCompanies.id, {
      onDelete: "set null",
    }),
    occurredAt: timestamp("occurred_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    ...createdByColumns(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index("crm_conversations_occurred_at_idx").on(
      table.occurredAt.desc(),
      table.id.desc(),
    ),
    index("crm_conversations_person_idx").on(table.personId),
  ],
);
