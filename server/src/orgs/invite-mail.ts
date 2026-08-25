/**
 * Email the organization invite link. The token used to live only in the JSON
 * response; this phase actually sends it.
 *
 * Missing SMTP config fails closed: the invite is not treated as sent.
 * Same SMTP variables CRM uses (`SMTP_URL` or `SMTP_HOST` + `SMTP_FROM`).
 * Replica B has no local outbox — the mail provider is the shared sink.
 */
import { smtpConfigured } from "../crm/deliver";

export class MailNotConfiguredError extends Error {
  constructor() {
    super(
      "Invite email is not configured. Set SMTP_URL or SMTP_HOST and SMTP_FROM. The invite was not sent.",
    );
    this.name = "MailNotConfiguredError";
  }
}

export class MailSendFailedError extends Error {
  constructor(cause?: string) {
    super(
      cause
        ? `The invite email could not be sent. ${cause}`
        : "The invite email could not be sent.",
    );
    this.name = "MailSendFailedError";
  }
}

export type InviteMail = {
  to: string;
  orgName: string;
  role: string;
  token: string;
  invitedBy: string;
};

export type InviteMailer = {
  configured: () => boolean;
  send: (mail: InviteMail) => Promise<void>;
};

function inviteUrl(publicOrigin: string, token: string): string {
  const origin = publicOrigin.replace(/\/$/, "");
  return `${origin}/invite/${token}`;
}

export function createInviteMailer(
  environment: NodeJS.ProcessEnv = process.env,
  publicOrigin = "http://localhost:3010",
): InviteMailer {
  return {
    configured: () => smtpConfigured(environment),
    async send(mail) {
      if (!smtpConfigured(environment)) {
        throw new MailNotConfiguredError();
      }
      const link = inviteUrl(publicOrigin, mail.token);
      const text = [
        `You are invited to join ${mail.orgName} on LimitlessAI as ${mail.role}.`,
        `Open this link to accept: ${link}`,
      ].join("\n\n");
      const html = `<p>You are invited to join <strong>${escapeHtml(mail.orgName)}</strong> on LimitlessAI as ${escapeHtml(mail.role)}.</p><p><a href="${escapeHtml(link)}">Accept the invite</a></p>`;
      await sendSmtp(environment, {
        to: mail.to,
        subject: `Join ${mail.orgName} on LimitlessAI`,
        text,
        html,
      });
    },
  };
}

async function sendSmtp(
  environment: NodeJS.ProcessEnv,
  input: { to: string; subject: string; text: string; html: string },
): Promise<void> {
  const smtpUrl = environment.SMTP_URL?.trim();
  const from = environment.SMTP_FROM?.trim() || "noreply@localhost";
  const nodemailer = await import("nodemailer").catch(() => null);
  if (!nodemailer || !("createTransport" in nodemailer)) {
    throw new MailSendFailedError("nodemailer is not installed.");
  }
  let host = environment.SMTP_HOST?.trim() ?? "";
  let port = Number(environment.SMTP_PORT ?? "587");
  let user = environment.SMTP_USER ?? "";
  let pass = environment.SMTP_PASS ?? "";
  if (smtpUrl) {
    const url = new URL(smtpUrl);
    host = url.hostname;
    port = url.port ? Number(url.port) : 587;
    user = decodeURIComponent(url.username);
    pass = decodeURIComponent(url.password);
  }
  if (!host) {
    throw new MailNotConfiguredError();
  }
  try {
    const transport = nodemailer.createTransport({
      host,
      port,
      ...(user ? { auth: { user, pass } } : {}),
    });
    await transport.sendMail({
      from,
      to: input.to,
      subject: input.subject,
      text: input.text,
      html: input.html,
    });
  } catch (error) {
    if (error instanceof MailNotConfiguredError) throw error;
    throw new MailSendFailedError(
      error instanceof Error ? error.message : String(error),
    );
  }
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
