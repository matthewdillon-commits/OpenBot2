import type { CrmSend, CrmSendKind, CrmStore } from "./store";

/**
 * How far a send actually went.
 *
 * SMTP and Twilio are optional. When they are not configured the row is still written — that is
 * the book of what this organization meant to send — and the status is `logged` rather than
 * pretending a message left the building.
 */
export type DeliveryResult = {
  status: "logged" | "sent" | "failed";
  provider: string;
  error?: string;
};

export function smtpConfigured(
  environment: NodeJS.ProcessEnv = process.env,
): boolean {
  return Boolean(
    environment.SMTP_URL?.trim() ||
      (environment.SMTP_HOST?.trim() && environment.SMTP_FROM?.trim()),
  );
}

export function twilioConfigured(
  environment: NodeJS.ProcessEnv = process.env,
): boolean {
  return Boolean(
    environment.TWILIO_ACCOUNT_SID?.trim() &&
      environment.TWILIO_AUTH_TOKEN?.trim() &&
      environment.TWILIO_FROM_NUMBER?.trim(),
  );
}

export async function deliverSend(options: {
  store: CrmStore;
  orgId: string;
  send: CrmSend;
  publicOrigin?: string;
  environment?: NodeJS.ProcessEnv;
}): Promise<CrmSend> {
  const environment = options.environment ?? process.env;
  const token = await options.store.getTrackingToken(
    options.orgId,
    options.send.id,
  );
  const result = await attemptDelivery(
    options.send,
    options.publicOrigin,
    environment,
    token,
  );
  const updated = await options.store.updateSend(options.orgId, options.send.id, {
    status: result.status,
    provider: result.provider,
    sentAt: result.status === "sent" ? new Date().toISOString() : null,
  });
  if (result.status === "sent") {
    await options.store.recordSendEvent({
      sendId: options.send.id,
      eventType: "sent",
    });
  }
  if (result.status === "failed") {
    await options.store.recordSendEvent({
      sendId: options.send.id,
      eventType: "failed",
    });
  }
  return (
    updated ??
    (await options.store.getSend(options.orgId, options.send.id)) ??
    options.send
  );
}

async function attemptDelivery(
  send: CrmSend,
  publicOrigin: string | undefined,
  environment: NodeJS.ProcessEnv,
  token: string | undefined,
): Promise<DeliveryResult> {
  if (send.kind === "call") {
    return { status: "logged", provider: "logged" };
  }
  if (send.kind === "email") {
    return deliverEmail(send, publicOrigin, environment, token);
  }
  return deliverSms(send, environment);
}

async function deliverEmail(
  send: CrmSend,
  publicOrigin: string | undefined,
  environment: NodeJS.ProcessEnv,
  token: string | undefined,
): Promise<DeliveryResult> {
  if (!smtpConfigured(environment)) {
    return { status: "logged", provider: "logged" };
  }
  const smtpUrl = environment.SMTP_URL?.trim();
  const host = environment.SMTP_HOST?.trim();
  const from = environment.SMTP_FROM?.trim() || "noreply@localhost";
  try {
    if (smtpUrl) {
      const url = new URL(smtpUrl);
      const user = decodeURIComponent(url.username);
      const pass = decodeURIComponent(url.password);
      const port = url.port ? Number(url.port) : 587;
      await smtpSend({
        host: url.hostname,
        port,
        user,
        pass,
        from,
        to: send.toAddress,
        subject: send.subject ?? "(no subject)",
        html: trackedHtml(send, publicOrigin, token),
        text: send.body ?? "",
      });
      return { status: "sent", provider: "smtp" };
    }
    if (host) {
      await smtpSend({
        host,
        port: Number(environment.SMTP_PORT ?? "587"),
        user: environment.SMTP_USER ?? "",
        pass: environment.SMTP_PASS ?? "",
        from,
        to: send.toAddress,
        subject: send.subject ?? "(no subject)",
        html: trackedHtml(send, publicOrigin, token),
        text: send.body ?? "",
      });
      return { status: "sent", provider: "smtp" };
    }
    return { status: "logged", provider: "logged" };
  } catch (error) {
    return {
      status: "failed",
      provider: "smtp",
      error: error instanceof Error ? error.message : "SMTP failed.",
    };
  }
}

async function deliverSms(
  send: CrmSend,
  environment: NodeJS.ProcessEnv,
): Promise<DeliveryResult> {
  if (!twilioConfigured(environment)) {
    return { status: "logged", provider: "logged" };
  }
  const sid = environment.TWILIO_ACCOUNT_SID?.trim() ?? "";
  const token = environment.TWILIO_AUTH_TOKEN?.trim() ?? "";
  const from = environment.TWILIO_FROM_NUMBER?.trim() ?? "";
  try {
    const body = new URLSearchParams({
      To: send.toAddress,
      From: from,
      Body: send.body ?? "",
    });
    const response = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`,
      {
        method: "POST",
        headers: {
          authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}`,
          "content-type": "application/x-www-form-urlencoded",
        },
        body,
      },
    );
    if (!response.ok) {
      return { status: "failed", provider: "twilio" };
    }
    return { status: "sent", provider: "twilio" };
  } catch {
    return { status: "failed", provider: "twilio" };
  }
}

/**
 * Minimal SMTP DATA over a TCP socket. Enough for a local Mailhog or a STARTTLS-less relay.
 *
 * A deployment that needs TLS should set SMTP_URL to a provider that accepts it, or leave SMTP
 * unset and keep the send as logged. This is not a general mailer.
 */
async function smtpSend(input: {
  host: string;
  port: number;
  user: string;
  pass: string;
  from: string;
  to: string;
  subject: string;
  html: string;
  text: string;
}): Promise<void> {
  const nodemailer = await import("nodemailer").catch(() => null);
  if (nodemailer && "createTransport" in nodemailer) {
    const transport = nodemailer.createTransport({
      host: input.host,
      port: input.port,
      ...(input.user
        ? { auth: { user: input.user, pass: input.pass } }
        : {}),
    });
    await transport.sendMail({
      from: input.from,
      to: input.to,
      subject: input.subject,
      text: input.text,
      html: input.html,
    });
    return;
  }
  throw new Error("SMTP is configured but nodemailer is not installed.");
}

export function trackedHtml(
  send: Pick<CrmSend, "id" | "body">,
  publicOrigin: string | undefined,
  token?: string,
): string {
  const body = escapeHtml(send.body ?? "").replace(/\n/g, "<br>");
  if (!publicOrigin || !token) return `<p>${body}</p>`;
  const open = `${publicOrigin.replace(/\/$/, "")}/api/crm/track/open/${token}.gif`;
  const rewritten = rewriteLinks(body, publicOrigin, token);
  return `${rewritten}<img src="${open}" width="1" height="1" alt="" />`;
}

export function rewriteLinks(
  html: string,
  publicOrigin: string,
  token: string,
): string {
  const origin = publicOrigin.replace(/\/$/, "");
  return html.replace(
    /\bhttps?:\/\/[^\s<]+/gi,
    (url) =>
      `${origin}/api/crm/track/click/${token}?u=${encodeURIComponent(url)}`,
  );
}

export function trackingOrigin(requestUrl: string, fallback?: string): string {
  try {
    return new URL(requestUrl).origin;
  } catch {
    return fallback?.replace(/\/$/, "") || "http://localhost:3001";
  }
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function kindNeedsAddress(kind: CrmSendKind): "email" | "phone" {
  return kind === "sms" || kind === "call" ? "phone" : "email";
}
