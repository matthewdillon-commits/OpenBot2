import { createHmac } from "node:crypto";

/**
 * Message mixed with `KEY_ENCRYPTION_KEY` so the API, the worker, and
 * `agent-computer` mint the same secret when `COMPUTER_TOKEN` was not set.
 *
 * Keep this string stable. Changing it desynchronises a running container:
 * the computer still holds the old digest and every call is refused.
 */
export const SAME_IMAGE_COMPUTER_TOKEN_MESSAGE = "openbot-same-image-computer";

/**
 * Secret the API presents to the computer in this container when COMPUTER_TOKEN
 * was not set.
 *
 * Both processes live in the image. The computer refuses unauthenticated
 * callers, so an empty token is a silent break: tools are offered, every call
 * is 401. Derive from the vault key that is already required to boot, rather
 * than inventing a second secret the operator has to copy.
 */
export function sameImageComputerToken(keyEncryptionKey: string): string {
  return createHmac("sha256", keyEncryptionKey)
    .update(SAME_IMAGE_COMPUTER_TOKEN_MESSAGE)
    .digest("hex");
}
