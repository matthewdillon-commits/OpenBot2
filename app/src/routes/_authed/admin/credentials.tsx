import { IconPlus } from "@tabler/icons-react";
import { useForm } from "@tanstack/react-form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import {
  PageEmpty,
  PageRows,
  PageSection,
  PageShell,
} from "@/components/layout/page-shell";
import { StaggerItem } from "@/components/layout/stagger";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemTitle,
} from "@/components/ui/item";
import { Separator } from "@/components/ui/separator";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  credentialFormSchema,
  emptyCredentialForm,
  metadataFromCredentialForm,
} from "@/lib/credentials/form";
import {
  createCredentialMutationOptions,
  revokeCredentialMutationOptions,
} from "@/lib/credentials/mutations";
import { credentialListQueryOptions } from "@/lib/credentials/queries";

export const Route = createFileRoute("/_authed/admin/credentials")({
  component: CredentialsPage,
});

function CredentialsPage() {
  const [adding, setAdding] = useState(false);
  const queryClient = useQueryClient();
  const credentials = useQuery(credentialListQueryOptions());
  const createCredential = useMutation(
    createCredentialMutationOptions(queryClient),
  );
  const revokeCredential = useMutation(
    revokeCredentialMutationOptions(queryClient),
  );
  const form = useForm({
    defaultValues: emptyCredentialForm,
    validators: { onSubmit: credentialFormSchema },
    onSubmit: async ({ value }) => {
      await createCredential.mutateAsync({
        kind: value.kind,
        provider: value.provider,
        keyId: value.keyId,
        plaintext: value.plaintext,
        metadata: metadataFromCredentialForm(value),
      });
      form.reset();
      setAdding(false);
    },
  });

  return (
    <PageShell
      action={
        <Button onClick={() => setAdding(true)} size="sm" variant="ghost">
          <IconPlus />
          Add credential
        </Button>
      }
      description="Credentials are write-only. OpenBot never displays their secret values."
      title="Credentials"
    >
      {/*
       * THE FORM IS NOT ON THE PAGE. A credential is added once and then lived with, so a permanent
       * four-field form sat above the list somebody actually came to read, and the secret field
       * invited a password manager to fill it on every visit.
       */}
      <Dialog onOpenChange={setAdding} open={adding}>
        <DialogContent>
          <form
            noValidate
            onSubmit={(event) => {
              event.preventDefault();
              form.handleSubmit();
            }}
          >
            <DialogHeader>
              <DialogTitle>Add credential</DialogTitle>
              <DialogDescription>
                Held for this deployment and never shown again once saved.
              </DialogDescription>
            </DialogHeader>
            <DialogBody className="mt-4 overflow-y-auto">
              <FieldGroup className="sm:grid sm:grid-cols-2">
                <form.Field name="kind">
                  {(field) => {
                    const isInvalid =
                      field.state.meta.isTouched && !field.state.meta.isValid;
                    return (
                      <Field data-invalid={isInvalid}>
                        <FieldLabel htmlFor={field.name}>Type</FieldLabel>
                        <Select
                          onValueChange={(value) => {
                            const kind = value as
                              | "model"
                              | "connector"
                              | "email";
                            field.handleChange(kind);
                            if (
                              kind === "email" &&
                              form.getFieldValue("provider") !== "smtp" &&
                              form.getFieldValue("provider") !== "imap"
                            ) {
                              form.setFieldValue("provider", "smtp");
                              form.setFieldValue("port", "587");
                              form.setFieldValue("secure", false);
                            }
                          }}
                          value={field.state.value}
                        >
                          <SelectTrigger
                            aria-invalid={isInvalid}
                            id={field.name}
                          >
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectGroup>
                              <SelectItem value="model">Model</SelectItem>
                              <SelectItem value="connector">
                                Connector
                              </SelectItem>
                              <SelectItem value="email">Email</SelectItem>
                            </SelectGroup>
                          </SelectContent>
                        </Select>
                        {isInvalid ? (
                          <FieldError errors={field.state.meta.errors} />
                        ) : null}
                      </Field>
                    );
                  }}
                </form.Field>
                <form.Subscribe selector={(state) => state.values.kind}>
                  {(kind) =>
                    kind === "email" ? (
                      <form.Field name="provider">
                        {(field) => {
                          const isInvalid =
                            field.state.meta.isTouched &&
                            !field.state.meta.isValid;
                          return (
                            <Field data-invalid={isInvalid}>
                              <FieldLabel htmlFor={field.name}>
                                Protocol
                              </FieldLabel>
                              <Select
                                onValueChange={(value) => {
                                  const provider =
                                    value === "imap" ? "imap" : "smtp";
                                  field.handleChange(provider);
                                  if (provider === "imap") {
                                    form.setFieldValue("port", "993");
                                    form.setFieldValue("secure", true);
                                  } else {
                                    form.setFieldValue("port", "587");
                                    form.setFieldValue("secure", false);
                                  }
                                }}
                                value={field.state.value}
                              >
                                <SelectTrigger
                                  aria-invalid={isInvalid}
                                  id={field.name}
                                >
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectGroup>
                                    <SelectItem value="smtp">SMTP</SelectItem>
                                    <SelectItem value="imap">IMAP</SelectItem>
                                  </SelectGroup>
                                </SelectContent>
                              </Select>
                              <FieldDescription>
                                SMTP sends. IMAP reads the inbox. Store both to
                                offer both tools.
                              </FieldDescription>
                              {isInvalid ? (
                                <FieldError errors={field.state.meta.errors} />
                              ) : null}
                            </Field>
                          );
                        }}
                      </form.Field>
                    ) : (
                      <form.Field name="provider">
                        {(field) => {
                          const isInvalid =
                            field.state.meta.isTouched &&
                            !field.state.meta.isValid;
                          return (
                            <Field data-invalid={isInvalid}>
                              <FieldLabel htmlFor={field.name}>
                                Provider
                              </FieldLabel>
                              <Input
                                aria-invalid={isInvalid}
                                id={field.name}
                                name={field.name}
                                onBlur={field.handleBlur}
                                onChange={(event) =>
                                  field.handleChange(event.target.value)
                                }
                                placeholder="OpenAI"
                                value={field.state.value}
                              />
                              {isInvalid ? (
                                <FieldError errors={field.state.meta.errors} />
                              ) : null}
                            </Field>
                          );
                        }}
                      </form.Field>
                    )
                  }
                </form.Subscribe>
                <form.Field name="keyId">
                  {(field) => {
                    const isInvalid =
                      field.state.meta.isTouched && !field.state.meta.isValid;
                    return (
                      <Field data-invalid={isInvalid}>
                        <FieldLabel htmlFor={field.name}>Key ID</FieldLabel>
                        <Input
                          aria-invalid={isInvalid}
                          id={field.name}
                          name={field.name}
                          onBlur={field.handleBlur}
                          onChange={(event) =>
                            field.handleChange(event.target.value)
                          }
                          placeholder="production"
                          value={field.state.value}
                        />
                        {isInvalid ? (
                          <FieldError errors={field.state.meta.errors} />
                        ) : null}
                      </Field>
                    );
                  }}
                </form.Field>
                <form.Field name="plaintext">
                  {(field) => {
                    const isInvalid =
                      field.state.meta.isTouched && !field.state.meta.isValid;
                    return (
                      <Field data-invalid={isInvalid}>
                        <FieldLabel htmlFor={field.name}>
                          {form.getFieldValue("kind") === "email"
                            ? "Password"
                            : "Secret"}
                        </FieldLabel>
                        <Input
                          aria-invalid={isInvalid}
                          autoComplete="off"
                          id={field.name}
                          name={field.name}
                          onBlur={field.handleBlur}
                          onChange={(event) =>
                            field.handleChange(event.target.value)
                          }
                          type="password"
                          value={field.state.value}
                        />
                        {isInvalid ? (
                          <FieldError errors={field.state.meta.errors} />
                        ) : null}
                      </Field>
                    );
                  }}
                </form.Field>
                <form.Subscribe
                  selector={(state) =>
                    [state.values.kind, state.values.provider] as const
                  }
                >
                  {([kind, provider]) =>
                    kind !== "email" ? null : (
                      <>
                        <form.Field name="host">
                          {(field) => {
                            const isInvalid =
                              field.state.meta.isTouched &&
                              !field.state.meta.isValid;
                            return (
                              <Field data-invalid={isInvalid}>
                                <FieldLabel htmlFor={field.name}>
                                  Host
                                </FieldLabel>
                                <Input
                                  aria-invalid={isInvalid}
                                  id={field.name}
                                  name={field.name}
                                  onBlur={field.handleBlur}
                                  onChange={(event) =>
                                    field.handleChange(event.target.value)
                                  }
                                  placeholder="smtp.example.com"
                                  value={field.state.value ?? ""}
                                />
                                {isInvalid ? (
                                  <FieldError
                                    errors={field.state.meta.errors}
                                  />
                                ) : null}
                              </Field>
                            );
                          }}
                        </form.Field>
                        <form.Field name="port">
                          {(field) => {
                            const isInvalid =
                              field.state.meta.isTouched &&
                              !field.state.meta.isValid;
                            return (
                              <Field data-invalid={isInvalid}>
                                <FieldLabel htmlFor={field.name}>
                                  Port
                                </FieldLabel>
                                <Input
                                  aria-invalid={isInvalid}
                                  id={field.name}
                                  inputMode="numeric"
                                  name={field.name}
                                  onBlur={field.handleBlur}
                                  onChange={(event) =>
                                    field.handleChange(event.target.value)
                                  }
                                  placeholder="587"
                                  value={field.state.value ?? ""}
                                />
                                {isInvalid ? (
                                  <FieldError
                                    errors={field.state.meta.errors}
                                  />
                                ) : null}
                              </Field>
                            );
                          }}
                        </form.Field>
                        <form.Field name="user">
                          {(field) => {
                            const isInvalid =
                              field.state.meta.isTouched &&
                              !field.state.meta.isValid;
                            return (
                              <Field data-invalid={isInvalid}>
                                <FieldLabel htmlFor={field.name}>
                                  Username
                                </FieldLabel>
                                <Input
                                  aria-invalid={isInvalid}
                                  autoComplete="off"
                                  id={field.name}
                                  name={field.name}
                                  onBlur={field.handleBlur}
                                  onChange={(event) =>
                                    field.handleChange(event.target.value)
                                  }
                                  placeholder="bot@example.com"
                                  value={field.state.value ?? ""}
                                />
                                {isInvalid ? (
                                  <FieldError
                                    errors={field.state.meta.errors}
                                  />
                                ) : null}
                              </Field>
                            );
                          }}
                        </form.Field>
                        {provider === "smtp" ? (
                          <form.Field name="from">
                            {(field) => {
                              const isInvalid =
                                field.state.meta.isTouched &&
                                !field.state.meta.isValid;
                              return (
                                <Field data-invalid={isInvalid}>
                                  <FieldLabel htmlFor={field.name}>
                                    From
                                  </FieldLabel>
                                  <Input
                                    aria-invalid={isInvalid}
                                    id={field.name}
                                    name={field.name}
                                    onBlur={field.handleBlur}
                                    onChange={(event) =>
                                      field.handleChange(event.target.value)
                                    }
                                    placeholder="bot@example.com"
                                    value={field.state.value ?? ""}
                                  />
                                  {isInvalid ? (
                                    <FieldError
                                      errors={field.state.meta.errors}
                                    />
                                  ) : null}
                                </Field>
                              );
                            }}
                          </form.Field>
                        ) : null}
                        <form.Field name="secure">
                          {(field) => (
                            <Field>
                              <FieldLabel htmlFor={field.name}>
                                Implicit TLS
                              </FieldLabel>
                              <Switch
                                checked={field.state.value === true}
                                id={field.name}
                                onCheckedChange={(checked) =>
                                  field.handleChange(checked)
                                }
                              />
                              <FieldDescription>
                                On for ports 465 and 993. Off uses STARTTLS.
                              </FieldDescription>
                            </Field>
                          )}
                        </form.Field>
                      </>
                    )
                  }
                </form.Subscribe>
              </FieldGroup>
              {createCredential.error ? (
                <p className="text-destructive text-sm" role="alert">
                  Could not save the credential. Try again.
                </p>
              ) : null}
            </DialogBody>
            <DialogFooter className="mt-4">
              <Button
                onClick={() => setAdding(false)}
                size="sm"
                type="button"
                variant="ghost"
              >
                Cancel
              </Button>
              <form.Subscribe
                selector={(state) => [state.canSubmit, state.isSubmitting]}
              >
                {([canSubmit, isSubmitting]) => (
                  <Button
                    disabled={
                      !canSubmit || isSubmitting || createCredential.isPending
                    }
                    size="sm"
                    type="submit"
                  >
                    {isSubmitting || createCredential.isPending
                      ? "Saving…"
                      : "Save credential"}
                  </Button>
                )}
              </form.Subscribe>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <PageSection title="Configured credentials">
        {credentials.isPending ? null : credentials.error ? (
          <p className="mt-4 text-destructive text-sm" role="alert">
            Could not load credentials.
          </p>
        ) : credentials.data?.length === 0 ? (
          <PageEmpty>No credentials are configured.</PageEmpty>
        ) : (
          <PageRows>
            {credentials.data?.map((credential, index) => (
              <StaggerItem index={index} key={credential.id}>
                <Item size="sm">
                  <ItemContent>
                    <ItemTitle>{credential.provider}</ItemTitle>
                    <ItemDescription>
                      {credential.kind} · {credential.keyId}
                      {credential.kind === "email" &&
                      typeof credential.metadata.host === "string" &&
                      credential.metadata.host
                        ? ` · ${credential.metadata.host}`
                        : ""}{" "}
                      · {credential.revokedAt ? "revoked" : "active"}
                    </ItemDescription>
                  </ItemContent>
                  <ItemActions>
                    <Button
                      disabled={
                        Boolean(credential.revokedAt) ||
                        revokeCredential.isPending
                      }
                      onClick={() => revokeCredential.mutate(credential.id)}
                      size="sm"
                      variant="outline"
                    >
                      Revoke
                    </Button>
                  </ItemActions>
                </Item>
                {index !== (credentials.data?.length ?? 0) - 1 && <Separator />}
              </StaggerItem>
            ))}
          </PageRows>
        )}
      </PageSection>
    </PageShell>
  );
}
