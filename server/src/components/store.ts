import { and, asc, eq, inArray, isNull, ne, or } from "drizzle-orm";
import type { Database } from "../db/client";
import {
  componentExclusions,
  componentFunctions,
  components,
} from "../db/schema";
import { LOCAL_ORGANIZATION_ID, orgIdOf } from "../orgs/constants";
import { dataFunction } from "./functions";

export type ComponentRecord = {
  name: string;
  title: string;
  kind: string;
  draftDescription: string;
  publishedDescription: string | null;
  published: boolean;
  publishedAt: string | null;
  updatedBy: string | null;
  updatedAt: string;
  /** Whether the draft says something the published version does not. */
  hasUnpublishedChanges: boolean;
  /** The Bots held back from this. Every other Bot, including ones added later, may use it. */
  withheldFrom: string[];
  /** The data functions this component may call. Empty means it may call none. */
  functions: string[];
};

/** What one Bot may answer with, which is all the app needs to register its tools. */
export type GrantedComponent = {
  name: string;
  /** The published description. A draft is never sent anywhere a model can read it. */
  description: string;
};

/**
 * The outcome of asking whether a Bot may use a component right now.
 *
 * `reason` is written to be read by the model and shown to the person, so it says what happened and
 * what it means rather than naming a table.
 */
export type ComponentDecision =
  | { allowed: true; description: string }
  | { allowed: false; reason: string };

export class ComponentNotFoundError extends Error {
  constructor(name: string) {
    super(`No component is called ${name}.`);
    this.name = "ComponentNotFoundError";
  }
}

/** What a build says it can draw. The app announces this; the server keeps no copy of its own. */
export type CatalogueEntry = {
  name: string;
  title: string;
  kind: string;
  description: string;
};

export type ComponentStore = {
  /**
   * Learn about components this deployment has not seen before.
   *
   * Additive, never overwriting. A row that already exists belongs to the deployment: its published
   * wording, its grants and whether it is published at all were decided here, and an upgrade that
   * quietly reset any of them would be this function undoing an administrator\'s work on every boot.
   * Safe to call on every page load for that reason.
   */
  syncCatalogue(entries: CatalogueEntry[]): Promise<{ added: string[] }>;
  list(orgId?: string): Promise<ComponentRecord[]>;
  /** What this Bot may answer with: everything published, less whatever it has been held back from. */
  listForAgent(agentId: string, orgId?: string): Promise<GrantedComponent[]>;
  /**
   * The one decision point. Everything that wants to know whether a Bot may use a component asks
   * here, so there is a single place where the answer is decided and a single place to audit it.
   */
  decide(name: string, agentId: string, orgId?: string): Promise<ComponentDecision>;
  /** Stop holding this Bot back from this component. Takes no actor: it writes no row. */
  grant(name: string, agentId: string, orgId?: string): Promise<void>;
  /** Hold this Bot back from this one component. Every other Bot is unaffected. */
  revoke(name: string, agentId: string, by: string, orgId?: string): Promise<void>;
  grantFunction(
    name: string,
    functionName: string,
    by: string,
    orgId?: string,
  ): Promise<void>;
  revokeFunction(
    name: string,
    functionName: string,
    orgId?: string,
  ): Promise<void>;
  /**
   * May this component call this function?
   *
   * Separate from {@link ComponentStore.decide} rather than folded into it, because they answer
   * different questions and a caller needs both: whether this Bot may use the component at all, and
   * whether the component may read this data. Answering them together would let a caller satisfy one
   * and believe it had satisfied the other.
   */
  mayCall(name: string, functionName: string, orgId?: string): Promise<boolean>;
  /** Run a data function against this deployment. Permission is the caller's question, not this one's. */
  callFunction(
    functionName: string,
    args: Record<string, unknown>,
  ): Promise<unknown>;
  publish(name: string, by: string, orgId?: string): Promise<void>;
  unpublish(name: string, by: string, orgId?: string): Promise<void>;
  saveDraft(
    name: string,
    description: string,
    by: string,
    orgId?: string,
  ): Promise<void>;
};

function scope(orgId?: string) {
  return orgIdOf({ orgId });
}

/** Compiled catalogue components stay shared; sandboxed ones stay in their org. */
function visibleComponents(orgId: string) {
  return orgId === LOCAL_ORGANIZATION_ID
    ? eq(components.orgId, LOCAL_ORGANIZATION_ID)
    : or(
        eq(components.orgId, orgId),
        and(
          eq(components.orgId, LOCAL_ORGANIZATION_ID),
          ne(components.kind, "sandboxed"),
        ),
      );
}

const iso = (value: Date | string | null): string | null =>
  value === null ? null : value instanceof Date ? value.toISOString() : value;

export function createComponentStore(database: Database): ComponentStore {
  async function requireComponent(name: string, orgId = LOCAL_ORGANIZATION_ID) {
    const [row] = await database
      .select()
      .from(components)
      .where(and(eq(components.name, name), visibleComponents(orgId)))
      .limit(1);
    if (!row) throw new ComponentNotFoundError(name);
    return row;
  }

  return {
    async syncCatalogue(entries) {
      if (entries.length === 0) return { added: [] };

      const existing = await database
        .select({ name: components.name })
        .from(components);
      const known = new Set(existing.map((row) => row.name));
      const missing = entries.filter((entry) => !known.has(entry.name));
      if (missing.length === 0) return { added: [] };

      await database
        .insert(components)
        .values(
          missing.map((entry) => ({
            name: entry.name,
            orgId: LOCAL_ORGANIZATION_ID,
            title: entry.title,
            kind: entry.kind,
            draftDescription: entry.description,
            // Published on arrival, so a fresh install can draw from the moment it starts.
            publishedDescription: entry.description,
            published: true,
            publishedAt: new Date(),
            updatedBy: "the build",
          })),
        )
        // Two browsers announcing the same new component at once is ordinary, not a fault: whichever
        // arrives second must be a no-op rather than a duplicate-key error thrown at a page load.
        .onConflictDoNothing();

      return { added: missing.map((entry) => entry.name) };
    },

    async list(orgId) {
      const scoped = scope(orgId);
      const rows = await database
        .select()
        .from(components)
        .where(visibleComponents(scoped))
        .orderBy(asc(components.kind), asc(components.title));
      if (rows.length === 0) return [];

      const functionRows = await database
        .select()
        .from(componentFunctions)
        .where(
          and(
            eq(componentFunctions.orgId, scoped),
            inArray(
              componentFunctions.componentName,
              rows.map((row) => row.name),
            ),
          ),
        );
      const functionsByComponent = new Map<string, string[]>();
      for (const row of functionRows) {
        const list = functionsByComponent.get(row.componentName) ?? [];
        list.push(row.functionName);
        functionsByComponent.set(row.componentName, list);
      }

      const exclusionRows = await database
        .select()
        .from(componentExclusions)
        .where(
          and(
            eq(componentExclusions.orgId, scoped),
            inArray(
              componentExclusions.componentName,
              rows.map((row) => row.name),
            ),
          ),
        );

      const byComponent = new Map<string, string[]>();
      for (const exclusion of exclusionRows) {
        const list = byComponent.get(exclusion.componentName) ?? [];
        list.push(exclusion.agentId);
        byComponent.set(exclusion.componentName, list);
      }

      return rows.map((row) => ({
        name: row.name,
        title: row.title,
        kind: row.kind,
        draftDescription: row.draftDescription,
        publishedDescription: row.publishedDescription,
        published: row.published,
        publishedAt: iso(row.publishedAt),
        updatedBy: row.updatedBy,
        updatedAt: iso(row.updatedAt) as string,
        hasUnpublishedChanges:
          row.draftDescription !== (row.publishedDescription ?? ""),
        withheldFrom: (byComponent.get(row.name) ?? []).sort(),
        functions: (functionsByComponent.get(row.name) ?? []).sort(),
      }));
    },

    async listForAgent(agentId, orgId) {
      const scoped = scope(orgId);
      const rows = await database
        .select({
          name: components.name,
          description: components.publishedDescription,
        })
        .from(components)
        // Joined on this Bot specifically, so another Bot's withholding cannot remove a row here.
        .leftJoin(
          componentExclusions,
          and(
            eq(componentExclusions.componentName, components.name),
            eq(componentExclusions.agentId, agentId),
            eq(componentExclusions.orgId, scoped),
          ),
        )
        .where(
          and(
            visibleComponents(scoped),
            eq(components.published, true),
            isNull(componentExclusions.agentId),
          ),
        )
        .orderBy(asc(components.name));

      // A published row with no description is not a thing the model can be told about, so it is left
      // out rather than sent as an empty string it would have to guess the meaning of.
      return rows.flatMap((row) =>
        row.description
          ? [{ name: row.name, description: row.description }]
          : [],
      );
    },

    async decide(name, agentId, orgId) {
      const scoped = scope(orgId);
      const [row] = await database
        .select({
          published: components.published,
          description: components.publishedDescription,
          title: components.title,
          withheldFrom: componentExclusions.agentId,
        })
        .from(components)
        .leftJoin(
          componentExclusions,
          and(
            eq(componentExclusions.componentName, components.name),
            eq(componentExclusions.agentId, agentId),
            eq(componentExclusions.orgId, scoped),
          ),
        )
        .where(and(eq(components.name, name), visibleComponents(scoped)))
        .limit(1);

      // Every refusal says which one it is. "Not allowed" sends a model round the same loop; naming
      // the cause lets it either pick a different component or tell the person what to change.
      if (!row) {
        return {
          allowed: false,
          reason: `There is no component called ${name} in this deployment. Answer in prose instead.`,
        };
      }
      if (!row.published || !row.description) {
        return {
          allowed: false,
          reason: `${row.title} is not published in this deployment, so no Bot may use it. Answer in prose instead.`,
        };
      }
      if (row.withheldFrom) {
        return {
          allowed: false,
          reason: `${row.title} has been withheld from this Bot in this deployment, though other Bots may use it. Answer in prose instead.`,
        };
      }
      return { allowed: true, description: row.description };
    },

    async grant(name, agentId, orgId) {
      const scoped = scope(orgId);
      await requireComponent(name, scoped);
      await database
        .delete(componentExclusions)
        .where(
          and(
            eq(componentExclusions.componentName, name),
            eq(componentExclusions.agentId, agentId),
            eq(componentExclusions.orgId, scoped),
          ),
        );
    },

    async revoke(name, agentId, by, orgId) {
      const scoped = scope(orgId);
      await requireComponent(name, scoped);
      await database
        .insert(componentExclusions)
        .values({
          orgId: scoped,
          componentName: name,
          agentId,
          withheldBy: by,
        })
        // Withholding twice must not move the date.
        .onConflictDoNothing();
    },

    async publish(name, by, orgId) {
      const scoped = scope(orgId);
      const row = await requireComponent(name, scoped);
      await database
        .update(components)
        .set({
          // Promotes the draft, which is the whole of what publishing means here.
          publishedDescription: row.draftDescription,
          published: true,
          publishedAt: new Date(),
          updatedBy: by,
          updatedAt: new Date(),
        })
        .where(and(eq(components.name, name), eq(components.orgId, row.orgId)));
    },

    async unpublish(name, by, orgId) {
      const row = await requireComponent(name, scope(orgId));
      await database
        .update(components)
        .set({ published: false, updatedBy: by, updatedAt: new Date() })
        // Grants are left alone. Unpublishing is "nobody may use this for now", not "forget who was
        // trusted with it", clearing them would silently destroy an administrator's work and make
        // re-publishing a re-grant of everything.
        .where(and(eq(components.name, name), eq(components.orgId, row.orgId)));
    },

    async grantFunction(name, functionName, by, orgId) {
      const scoped = scope(orgId);
      await requireComponent(name, scoped);
      await database
        .insert(componentFunctions)
        .values({
          orgId: scoped,
          componentName: name,
          functionName,
          grantedBy: by,
        })
        .onConflictDoNothing();
    },

    async revokeFunction(name, functionName, orgId) {
      await database
        .delete(componentFunctions)
        .where(
          and(
            eq(componentFunctions.componentName, name),
            eq(componentFunctions.functionName, functionName),
            eq(componentFunctions.orgId, scope(orgId)),
          ),
        );
    },

    async mayCall(name, functionName, orgId) {
      const [row] = await database
        .select({ granted: componentFunctions.functionName })
        .from(componentFunctions)
        .where(
          and(
            eq(componentFunctions.componentName, name),
            eq(componentFunctions.functionName, functionName),
            eq(componentFunctions.orgId, scope(orgId)),
          ),
        )
        .limit(1);
      // A row is the permission. No row, no call, including for a component nobody has granted
      // anything, which is every component the moment it is added.
      return Boolean(row);
    },

    async callFunction(functionName, args) {
      const fn = dataFunction(functionName);
      // Unreachable through the route, which resolves the function before asking about permission.
      // Kept because a store that runs whatever name it is handed is one refactor away from being the
      // hole this whole file exists to close.
      if (!fn) throw new ComponentNotFoundError(functionName);
      return fn.run(database, args);
    },

    async saveDraft(name, description, by, orgId) {
      const row = await requireComponent(name, scope(orgId));
      await database
        .update(components)
        .set({
          draftDescription: description,
          updatedBy: by,
          updatedAt: new Date(),
        })
        .where(and(eq(components.name, name), eq(components.orgId, row.orgId)));
    },
  };
}
