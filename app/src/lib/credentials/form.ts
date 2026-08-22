import { z } from "zod";

export const credentialFormSchema = z
  .object({
    kind: z.enum(["model", "connector", "email"]),
    provider: z.string().trim().min(1, "Provider is required."),
    keyId: z.string().trim().min(1, "Key ID is required."),
    plaintext: z.string().min(1, "Secret is required."),
    host: z.string().optional(),
    port: z.string().optional(),
    user: z.string().optional(),
    from: z.string().optional(),
    secure: z.boolean().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.kind !== "email") return;
    if (value.provider !== "smtp" && value.provider !== "imap") {
      ctx.addIssue({
        code: "custom",
        path: ["provider"],
        message: "Choose SMTP or IMAP.",
      });
    }
    if (!value.host?.trim()) {
      ctx.addIssue({
        code: "custom",
        path: ["host"],
        message: "Host is required.",
      });
    }
    const port = Number(value.port);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      ctx.addIssue({
        code: "custom",
        path: ["port"],
        message: "Port must be a number from 1 to 65535.",
      });
    }
    if (!value.user?.trim()) {
      ctx.addIssue({
        code: "custom",
        path: ["user"],
        message: "Username is required.",
      });
    }
    if (value.provider === "smtp" && !value.from?.trim()) {
      ctx.addIssue({
        code: "custom",
        path: ["from"],
        message: "From address is required.",
      });
    }
  });

export type CredentialFormValues = z.infer<typeof credentialFormSchema>;

export const emptyCredentialForm: CredentialFormValues = {
  kind: "model",
  provider: "",
  keyId: "",
  plaintext: "",
  host: "",
  port: "",
  user: "",
  from: "",
  secure: false,
};

/**
 * Non-secret mailbox fields. The password stays in `plaintext` and never enters metadata —
 * metadata is what the credentials list will show.
 */
export function metadataFromCredentialForm(
  values: CredentialFormValues,
): Record<string, unknown> {
  if (values.kind !== "email") return {};
  const provider = values.provider === "imap" ? "imap" : "smtp";
  const port = Number(values.port);
  return {
    host: values.host?.trim() ?? "",
    port,
    user: values.user?.trim() ?? "",
    secure:
      values.secure ?? (provider === "smtp" ? port === 465 : port === 993),
    ...(provider === "smtp" && values.from?.trim()
      ? { from: values.from.trim() }
      : {}),
  };
}
