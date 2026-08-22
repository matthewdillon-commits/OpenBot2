import { expect, test } from "bun:test";
import {
  credentialFormSchema,
  metadataFromCredentialForm,
} from "@/lib/credentials/form";

test("requires credential type, provider, key ID, and secret", () => {
  expect(
    credentialFormSchema.safeParse({
      kind: "model",
      provider: "",
      keyId: "",
      plaintext: "",
    }).success,
  ).toBeFalse();
});

test("an email credential needs a mailbox, not only a password", () => {
  expect(
    credentialFormSchema.safeParse({
      kind: "email",
      provider: "smtp",
      keyId: "primary",
      plaintext: "app-password",
    }).success,
  ).toBeFalse();

  const parsed = credentialFormSchema.safeParse({
    kind: "email",
    provider: "smtp",
    keyId: "primary",
    plaintext: "app-password",
    host: "smtp.example.com",
    port: "587",
    user: "bot@example.com",
    from: "bot@example.com",
    secure: false,
  });
  expect(parsed.success).toBeTrue();
  if (!parsed.success) return;
  expect(metadataFromCredentialForm(parsed.data)).toEqual({
    host: "smtp.example.com",
    port: 587,
    user: "bot@example.com",
    secure: false,
    from: "bot@example.com",
  });
  expect(JSON.stringify(metadataFromCredentialForm(parsed.data))).not.toContain(
    "app-password",
  );
});

test("IMAP does not require a From address", () => {
  expect(
    credentialFormSchema.safeParse({
      kind: "email",
      provider: "imap",
      keyId: "inbox",
      plaintext: "app-password",
      host: "imap.example.com",
      port: "993",
      user: "bot@example.com",
      secure: true,
    }).success,
  ).toBeTrue();
});
