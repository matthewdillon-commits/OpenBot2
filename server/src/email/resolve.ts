import {
  type EmailCredentialSecretReader,
  decryptSecret,
} from "../credentials";
import {
  type EmailMailboxes,
  type EmailProvider,
  parseEmailMailboxSettings,
} from "./mailbox";

/**
 * Open the vaulted mailbox for this deployment, or say there is not one.
 *
 * Absent, revoked, or metadata that does not name a host: `null` for that protocol. The tools are
 * not offered when both sides are null — the same pattern as `TAVILY_API_KEY` and web search —
 * rather than offered and failing. A password that will not decrypt is treated the same way: this
 * is not a place to throw a vault error into a Bot's turn.
 */
export async function resolveEmailMailboxes(input: {
  encryptionKey: string;
  reader: EmailCredentialSecretReader;
}): Promise<EmailMailboxes> {
  return {
    smtp: await resolveOne(input, "smtp"),
    imap: await resolveOne(input, "imap"),
  };
}

async function resolveOne(
  input: {
    encryptionKey: string;
    reader: EmailCredentialSecretReader;
  },
  provider: EmailProvider,
) {
  const stored = await input.reader.readEmailSecret({ provider });
  if (!stored) return null;

  const settings = parseEmailMailboxSettings(stored.metadata, provider);
  if (!settings) return null;

  try {
    const password = await decryptSecret(
      input.encryptionKey,
      stored.encryptedValue,
    );
    if (!password) return null;
    return { ...settings, password };
  } catch {
    return null;
  }
}
