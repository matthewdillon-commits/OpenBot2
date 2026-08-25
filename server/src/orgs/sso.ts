/**
 * Per-organization SSO. Google / Microsoft / Okta / email are still configured
 * deployment-wide; this table is which of those an organization admits, and
 * which email domains route here.
 *
 * Stored in Postgres. Replica B reads the same row. Org A's config does not
 * apply to org B.
 */
import { eq, sql } from "drizzle-orm";
import type { AuthConfig, AuthProviderId } from "../config";
import type { Database } from "../db/client";
import { organizationSso } from "../db/schema";

export type OrganizationSsoRecord = {
  orgId: string;
  googleEnabled: boolean;
  microsoftEnabled: boolean;
  oktaEnabled: boolean;
  emailEnabled: boolean;
  domains: string[];
};

export type ResolvedSso = {
  orgId: string | null;
  google: boolean;
  microsoft: boolean;
  okta: boolean;
  email: boolean;
};

export type OrganizationSsoStore = {
  get: (orgId: string) => Promise<OrganizationSsoRecord>;
  set: (
    orgId: string,
    input: {
      googleEnabled?: boolean;
      microsoftEnabled?: boolean;
      oktaEnabled?: boolean;
      emailEnabled?: boolean;
      domains?: string[];
    },
  ) => Promise<OrganizationSsoRecord>;
  /** The org that claimed this email domain, if any. */
  forDomain: (domain: string) => Promise<OrganizationSsoRecord | null>;
  /**
   * Methods this address may use. A domain claimed by org A returns A's flags
   * intersected with what the deployment actually configured. An unclaimed
   * domain returns the deployment-wide set.
   */
  resolveForEmail: (
    email: string,
    auth: AuthConfig | undefined,
  ) => Promise<ResolvedSso>;
  resolveForOrg: (
    orgId: string,
    auth: AuthConfig | undefined,
  ) => Promise<ResolvedSso>;
};

function normalizeDomain(value: string): string {
  return value.trim().toLowerCase().replace(/^@/, "");
}

function domainsFrom(email: string): string {
  const at = email.trim().toLowerCase().lastIndexOf("@");
  return at >= 0
    ? email
        .trim()
        .toLowerCase()
        .slice(at + 1)
    : "";
}

function mapRow(row: {
  orgId: string;
  googleEnabled: boolean;
  microsoftEnabled: boolean;
  oktaEnabled: boolean;
  emailEnabled: boolean;
  domains: string[] | null;
}): OrganizationSsoRecord {
  return {
    orgId: row.orgId,
    googleEnabled: row.googleEnabled,
    microsoftEnabled: row.microsoftEnabled,
    oktaEnabled: row.oktaEnabled,
    emailEnabled: row.emailEnabled,
    domains: row.domains ?? [],
  };
}

const DEFAULTS: Omit<OrganizationSsoRecord, "orgId"> = {
  googleEnabled: true,
  microsoftEnabled: true,
  oktaEnabled: true,
  emailEnabled: true,
  domains: [],
};

export class SsoDomainTakenError extends Error {
  constructor(domain: string) {
    super(`The domain ${domain} already belongs to another organization.`);
    this.name = "SsoDomainTakenError";
  }
}

export function createOrganizationSsoStore(
  database: Database,
): OrganizationSsoStore {
  async function get(orgId: string): Promise<OrganizationSsoRecord> {
    const [row] = await database
      .select()
      .from(organizationSso)
      .where(eq(organizationSso.orgId, orgId))
      .limit(1);
    if (row) return mapRow(row);
    const [created] = await database
      .insert(organizationSso)
      .values({ orgId, domains: [] })
      .onConflictDoNothing()
      .returning();
    if (created) return mapRow(created);
    const [again] = await database
      .select()
      .from(organizationSso)
      .where(eq(organizationSso.orgId, orgId))
      .limit(1);
    return again ? mapRow(again) : { orgId, ...DEFAULTS };
  }

  async function forDomain(
    domain: string,
  ): Promise<OrganizationSsoRecord | null> {
    const normalized = normalizeDomain(domain);
    if (!normalized) return null;
    const [row] = await database
      .select()
      .from(organizationSso)
      .where(sql`${normalized} = any(${organizationSso.domains})`)
      .limit(1);
    return row ? mapRow(row) : null;
  }

  function intersect(
    record: OrganizationSsoRecord | null,
    auth: AuthConfig | undefined,
  ): ResolvedSso {
    const googleOn = Boolean(auth?.google);
    const microsoftOn = Boolean(auth?.microsoft);
    const oktaOn = Boolean(auth?.okta);
    const emailOn = auth?.emailPassword === true;
    if (!record) {
      return {
        orgId: null,
        google: googleOn,
        microsoft: microsoftOn,
        okta: oktaOn,
        email: emailOn,
      };
    }
    return {
      orgId: record.orgId,
      google: googleOn && record.googleEnabled,
      microsoft: microsoftOn && record.microsoftEnabled,
      okta: oktaOn && record.oktaEnabled,
      email: emailOn && record.emailEnabled,
    };
  }

  return {
    get,
    forDomain,

    async set(orgId, input) {
      const current = await get(orgId);
      const domains = (input.domains ?? current.domains).map(normalizeDomain);
      for (const domain of domains) {
        if (!domain) continue;
        const owner = await forDomain(domain);
        if (owner && owner.orgId !== orgId) {
          throw new SsoDomainTakenError(domain);
        }
      }
      const [row] = await database
        .insert(organizationSso)
        .values({
          orgId,
          googleEnabled: input.googleEnabled ?? current.googleEnabled,
          microsoftEnabled: input.microsoftEnabled ?? current.microsoftEnabled,
          oktaEnabled: input.oktaEnabled ?? current.oktaEnabled,
          emailEnabled: input.emailEnabled ?? current.emailEnabled,
          domains,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: organizationSso.orgId,
          set: {
            googleEnabled: input.googleEnabled ?? current.googleEnabled,
            microsoftEnabled:
              input.microsoftEnabled ?? current.microsoftEnabled,
            oktaEnabled: input.oktaEnabled ?? current.oktaEnabled,
            emailEnabled: input.emailEnabled ?? current.emailEnabled,
            domains,
            updatedAt: new Date(),
          },
        })
        .returning();
      return row ? mapRow(row) : { orgId, ...DEFAULTS, domains };
    },

    async resolveForEmail(email, auth) {
      const domain = domainsFrom(email);
      const record = domain ? await forDomain(domain) : null;
      return intersect(record, auth);
    },

    async resolveForOrg(orgId, auth) {
      return intersect(await get(orgId), auth);
    },
  };
}

export function providerAllowed(
  resolved: ResolvedSso,
  provider: AuthProviderId | "email",
): boolean {
  if (provider === "email") return resolved.email;
  return resolved[provider] === true;
}
