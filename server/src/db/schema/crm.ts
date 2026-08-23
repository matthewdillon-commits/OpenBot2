/**
 * CRM tables: people, companies, opportunities, campaigns, conversations, and sends.
 *
 * This is the organization's customer record, not the signed-in directory. `/admin/people` is who
 * may use the product. These rows are who the organization is talking to — a prospect, a vendor, a
 * contact a Bot wrote down. Sends are the email, SMS, and call records with open/click tracking.
 */
import {
  boolean,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { organizationIdColumn } from "./core";

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

export const crmSendKind = pgEnum("crm_send_kind", ["email", "sms", "call"]);

export const crmSendStatus = pgEnum("crm_send_status", [
  "draft",
  "queued",
  "logged",
  "sent",
  "delivered",
  "opened",
  "clicked",
  "failed",
  "answered",
  "no_answer",
]);

export const crmSendEventType = pgEnum("crm_send_event_type", [
  "sent",
  "delivered",
  "opened",
  "clicked",
  "failed",
  "answered",
  "no_answer",
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
    orgId: organizationIdColumn(),
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
    index("crm_companies_org_name_idx").on(table.orgId, table.name),
    index("crm_companies_org_created_at_idx").on(
      table.orgId,
      table.createdAt.desc(),
      table.id.desc(),
    ),
  ],
);

export const crmPeople = pgTable(
  "crm_people",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: organizationIdColumn(),
    name: text("name").notNull(),
    emails: text("emails").array().notNull().default([]),
    phones: text("phones").array().notNull().default([]),
    jobTitle: text("job_title"),
    companyId: uuid("company_id").references(() => crmCompanies.id, {
      onDelete: "set null",
    }),
    /**
     * LimitlessAI-2 outreach stage. Default New. DNC is both a stage and a hard flag.
     */
    stageKey: text("stage_key").notNull().default("new"),
    doNotContact: boolean("do_not_contact").notNull().default(false),
    notes: text("notes"),
    ...createdByColumns(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index("crm_people_org_name_idx").on(table.orgId, table.name),
    index("crm_people_org_company_idx").on(table.orgId, table.companyId),
    index("crm_people_org_stage_idx").on(table.orgId, table.stageKey),
    index("crm_people_org_created_at_idx").on(
      table.orgId,
      table.createdAt.desc(),
      table.id.desc(),
    ),
  ],
);

export const crmOpportunities = pgTable(
  "crm_opportunities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: organizationIdColumn(),
    name: text("name").notNull(),
    /** LimitlessAI-2 deal board: qualify, proposal, negotiation, won, lost. */
    stage: text("stage").notNull().default("qualify"),
    /** Order inside a board column. */
    position: integer("position").notNull().default(0),
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
    index("crm_opportunities_org_stage_idx").on(table.orgId, table.stage),
    index("crm_opportunities_org_created_at_idx").on(
      table.orgId,
      table.createdAt.desc(),
      table.id.desc(),
    ),
  ],
);

export const crmCampaigns = pgTable(
  "crm_campaigns",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: organizationIdColumn(),
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
    index("crm_campaigns_org_status_idx").on(table.orgId, table.status),
    index("crm_campaigns_org_created_at_idx").on(
      table.orgId,
      table.createdAt.desc(),
      table.id.desc(),
    ),
  ],
);

export const crmConversations = pgTable(
  "crm_conversations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: organizationIdColumn(),
    subject: text("subject").notNull(),
    /**
     * How the conversation happened: email, call, meeting, chat, note.
     *
     * A label, not a foreign key into a messaging system. This records that a conversation existed
     * so a person or a Bot can find it.
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
    index("crm_conversations_org_occurred_at_idx").on(
      table.orgId,
      table.occurredAt.desc(),
      table.id.desc(),
    ),
    index("crm_conversations_org_person_idx").on(table.orgId, table.personId),
  ],
);

/**
 * An email, SMS, or call this organization sent or logged, with delivery and open/click events.
 *
 * LimitlessAI-2 tracked transactional mail as sent / opened / clicked / failed, and outbound
 * campaigns as a dial list with per-contact status. This table is that book: one row per send,
 * events beside it, a tracking token for the open pixel and click rewrite.
 */
export const crmSends = pgTable(
  "crm_sends",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: organizationIdColumn(),
    kind: crmSendKind("kind").notNull(),
    status: crmSendStatus("status").notNull().default("queued"),
    subject: text("subject"),
    body: text("body"),
    toAddress: text("to_address").notNull(),
    personId: uuid("person_id").references(() => crmPeople.id, {
      onDelete: "set null",
    }),
    companyId: uuid("company_id").references(() => crmCompanies.id, {
      onDelete: "set null",
    }),
    campaignId: uuid("campaign_id").references(() => crmCampaigns.id, {
      onDelete: "set null",
    }),
    /**
     * Unguessable token for the open pixel and click redirect. The public tracker looks this up;
     * it is not a session and it is never shown on the list.
     */
    trackingToken: text("tracking_token").notNull(),
    provider: text("provider").notNull().default("logged"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    ...createdByColumns(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex("crm_sends_tracking_token_key").on(table.trackingToken),
    index("crm_sends_org_created_at_idx").on(
      table.orgId,
      table.createdAt.desc(),
      table.id.desc(),
    ),
    index("crm_sends_org_person_idx").on(table.orgId, table.personId),
    index("crm_sends_org_campaign_idx").on(table.orgId, table.campaignId),
  ],
);

export const crmSendEvents = pgTable(
  "crm_send_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: organizationIdColumn(),
    sendId: uuid("send_id")
      .notNull()
      .references(() => crmSends.id, { onDelete: "cascade" }),
    eventType: crmSendEventType("event_type").notNull(),
    linkUrl: text("link_url"),
    createdAt: createdAt(),
  },
  (table) => [
    index("crm_send_events_send_idx").on(table.sendId, table.createdAt.desc()),
    index("crm_send_events_org_type_idx").on(table.orgId, table.eventType),
  ],
);
