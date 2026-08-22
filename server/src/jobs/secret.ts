import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/** Recognisable on sight, so a leaked one can be found in a log or by a secret scanner. */
const TOKEN_PREFIX = "obot_job_";
const TOKEN_BYTES = 32;

export function mintJobSecret(): string {
  return `${TOKEN_PREFIX}${randomBytes(TOKEN_BYTES).toString("base64url")}`;
}

export function hashJobSecret(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

export function looksLikeJobSecret(value: string): boolean {
  return (
    value.startsWith(TOKEN_PREFIX) && value.length > TOKEN_PREFIX.length + 20
  );
}

export function sameSecretHash(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}
