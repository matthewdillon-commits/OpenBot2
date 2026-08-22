/**
 * What a mailbox credential holds besides the password.
 *
 * The password is the vault's `plaintext`. Everything a Bot needs to open SMTP or IMAP — host, port,
 * user, From — lives in metadata, which the credentials page will show and the list API will return.
 * A password that landed in metadata would be displayed; this parser never reads one.
 */

export const EMAIL_PROVIDERS = ["smtp", "imap"] as const;
export type EmailProvider = (typeof EMAIL_PROVIDERS)[number];

export type EmailMailboxSettings = {
  host: string;
  port: number;
  /** Implicit TLS (465 / 993). Off means STARTTLS (587 / 143). */
  secure: boolean;
  user: string;
  /** Required on SMTP: the address a send is From. */
  from?: string;
};

export type EmailMailbox = EmailMailboxSettings & {
  password: string;
};

export type EmailMailboxes = {
  smtp: EmailMailbox | null;
  imap: EmailMailbox | null;
};

export function isEmailProvider(value: unknown): value is EmailProvider {
  return value === "smtp" || value === "imap";
}

export function defaultSecure(provider: EmailProvider, port: number): boolean {
  if (provider === "smtp") return port === 465;
  return port === 993;
}

export function defaultPort(provider: EmailProvider, secure: boolean): number {
  if (provider === "smtp") return secure ? 465 : 587;
  return secure ? 993 : 143;
}

/**
 * Connection details from credential metadata. `null` is unusable, not a default:
 * a mailbox with no host is not a mailbox, and guessing one would send a password to the wrong
 * server.
 */
export function parseEmailMailboxSettings(
  metadata: Record<string, unknown>,
  provider: EmailProvider,
): EmailMailboxSettings | null {
  const host = asTrimmed(metadata.host);
  const user = asTrimmed(metadata.user);
  const port = asPort(metadata.port);
  if (!host || !user || port === null) return null;

  const secure =
    typeof metadata.secure === "boolean"
      ? metadata.secure
      : defaultSecure(provider, port);
  const from = asTrimmed(metadata.from);
  if (provider === "smtp" && !from) return null;

  return {
    host,
    port,
    secure,
    user,
    ...(from ? { from } : {}),
  };
}

/** Recipients the way a person writes them: one address, or several comma-separated. */
export function parseAddressList(value: string): string[] {
  const seen = new Set<string>();
  const addresses: string[] = [];
  for (const part of value.split(",")) {
    const address = part.trim();
    if (!address.includes("@") || seen.has(address.toLowerCase())) continue;
    seen.add(address.toLowerCase());
    addresses.push(address);
  }
  return addresses;
}

function asTrimmed(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function asPort(value: unknown): number | null {
  const port = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
  return port;
}
