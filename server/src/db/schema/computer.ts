/**
 * Computer tables: agent computers, sessions, computer-use audit.
 *
 * Split by owner so two people can add tables all day without touching the same lines. Add tables
 * here; never edit core.ts or coworker.ts to do it.
 */
import {
  boolean,
  integer,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { organizationIdColumn } from "./core";
import { jsonb } from "./json";

/**
 * The boundary this deployment is enforcing, kept where a restart cannot lose it.
 *
 * This table keeps policy across restarts. The policy can be changed while running, and a restart
 * must not silently return to the default.
 *
 * One row per organization. `id` is the org id (it used to be the literal `current` when
 * a deployment had one boundary).
 *
 * Memory is still the cache. The gateway asks for the policy on every action, so it reads from
 * memory; this is the record that survives a restart, not something on the path of a click.
 */
export const actionPolicy = pgTable("action_policy", {
  /** The organization this boundary belongs to. Was the literal `current` before tenancy. */
  id: text("id").primaryKey(),
  orgId: organizationIdColumn(),
  /** `enforce` or `dry-run`. Not an enum: the policy module owns that vocabulary. */
  mode: text("mode").notNull(),
  deny: text("deny").array().notNull(),
  allow: text("allow").array().notNull(),
  /**
   * Whether Bots are offered a browser. Null is on, which is what every row written before this
   * column existed meant. The application treats null as true; do not tighten this to NOT NULL in
   * the same release that adds it.
   */
  browserEnabled: boolean("browser_enabled"),
  /** Who last changed it, for the Admin page and the trail. */
  updatedBy: text("updated_by"),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * Which organization first used the one shared Chromium.
 *
 * One row (`id = shared`). Insert-on-conflict so two replicas cannot both
 * believe they are first. A second org is refused until a supervisor can make
 * computers one per org×bot. Customer-facing copy must not name the env var.
 */
export const SHARED_COMPUTER_CLAIM_ID = "shared";

export const sharedComputerClaim = pgTable("shared_computer_claim", {
  id: text("id").primaryKey(),
  orgId: organizationIdColumn(),
  claimedAt: timestamp("claimed_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * The last snapshot a computer produced, kept where every replica can read it.
 *
 * The gateway resolves the opaque ref in an acting call into the element it points at, and it must
 * resolve it against the snapshot the ref came from, never against a label the caller supplied. That
 * mapping used to live in a `Map` inside one process. OpenBot runs several processes behind a load
 * balancer, and the process that took the snapshot is rarely the one that handles the click that
 * follows it, so the mapping was absent exactly when a click arrived on another replica: the policy
 * then decided with no element in front of it and the audit row could not name what was touched. The
 * boundary the whole gateway exists for stopped applying, and nothing said so.
 *
 * One row per computer, upserted on every snapshot: the newest one wins, because a ref is only ever
 * resolved against the snapshot that is current. `snapshot_id` is the generation the far-side
 * computer stamped on it, so a ref carrying an older generation does not resolve to whatever now
 * holds that ref — the staleness a persisted cache is rightly warned about is answered by matching
 * the generation, not by keeping the cache in memory.
 *
 * Kept small on purpose: only the interactive elements a policy can match on, keyed by ref. It is a
 * resolution table for the boundary, not a history of pages, and the next snapshot replaces it.
 */
export const computerSnapshot = pgTable("computer_snapshot", {
  /** The computer these refs belong to. One live snapshot each, so it is the key. */
  computerId: text("computer_id").primaryKey(),
  orgId: organizationIdColumn(),
  /** The generation the computer stamped on this snapshot. A ref names the one it came from. */
  snapshotId: integer("snapshot_id").notNull(),
  /** The page it was taken on, so a rule about the host still has a page to match after a handover. */
  url: text("url").notNull(),
  /** The interactive elements, keyed by ref. The one thing resolve looks a ref up in. */
  elements: jsonb("elements").notNull(),
  takenAt: timestamp("taken_at", { withTimezone: true }).notNull().defaultNow(),
});
