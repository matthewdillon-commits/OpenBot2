import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import type { AgentChannel } from "@/lib/channels/queries";
import {
  inboundEmailUrl,
  inboundWebhookUrl,
  intervalLabel,
  wakeKindLabel,
  wakeSummary,
} from "@/lib/triggers/copy";
import {
  cronWakeFormSchema,
  cronWakeInputFrom,
  emailWakeFormSchema,
  emailWakeInputFrom,
  INTERVAL_PRESETS,
  webhookWakeFormSchema,
  webhookWakeInputFrom,
} from "@/lib/triggers/form";
import {
  type CreatedJobTrigger,
  createTriggerMutationOptions,
  deleteTriggerMutationOptions,
  setTriggerEnabledMutationOptions,
} from "@/lib/triggers/mutations";
import {
  type JobTriggerKind,
  type JobTriggerRecord,
  triggerListQueryOptions,
} from "@/lib/triggers/queries";
import { queryClient } from "@/query-client";

type AddKind = JobTriggerKind | null;

/**
 * Standing wakes on this goal's thread. Not a nav item. Cron, webhook, and
 * inbound email enqueue the same job the worker already runs.
 */
export function GoalWakesCard({ channel }: { channel: AgentChannel }) {
  const wakes = useQuery(triggerListQueryOptions(channel.id));
  const createWake = useMutation(createTriggerMutationOptions(queryClient));
  const setEnabled = useMutation(setTriggerEnabledMutationOptions(queryClient));
  const removeWake = useMutation(deleteTriggerMutationOptions(queryClient));
  const [adding, setAdding] = useState<AddKind>(null);
  const [revealed, setRevealed] = useState<CreatedJobTrigger | null>(null);
  const hasThread = Boolean(channel.threadId);
  const createError =
    createWake.error instanceof Error ? createWake.error.message : null;

  return (
    <section
      aria-label="Standing starts"
      className="border-b border-border px-3 py-3"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[12px] font-medium uppercase tracking-wide text-muted-foreground">
            When this goal starts on its own
          </p>
          <p className="mt-0.5 text-[12px] leading-4 text-muted-foreground">
            A schedule, a webhook, or a mapped mailbox starts the same work as
            Send-and-go — on this goal's existing thread.
          </p>
        </div>
        {hasThread ? (
          <div className="flex flex-wrap gap-1.5">
            <Button
              disabled={createWake.isPending}
              onClick={() => setAdding("cron")}
              size="sm"
              variant="outline"
            >
              Add a schedule
            </Button>
            <Button
              disabled={createWake.isPending}
              onClick={() => setAdding("webhook")}
              size="sm"
              variant="outline"
            >
              Add a webhook
            </Button>
            <Button
              disabled={createWake.isPending}
              onClick={() => setAdding("email")}
              size="sm"
              variant="outline"
            >
              Map a mailbox
            </Button>
          </div>
        ) : null}
      </div>

      {!hasThread ? (
        <p className="mt-2 text-sm text-muted-foreground">
          This goal has no Intelligence thread yet. Standing starts attach to
          the existing thread and do not mint one.
        </p>
      ) : wakes.isPending ? null : wakes.error ? (
        <p className="mt-2 text-sm text-destructive" role="alert">
          Could not load standing starts.
        </p>
      ) : wakes.data?.length === 0 ? (
        <p className="mt-2 text-sm text-muted-foreground">
          Nothing starts this goal on its own yet.
        </p>
      ) : (
        <ul className="mt-2 divide-y divide-border rounded-lg border border-border bg-card">
          {wakes.data?.map((trigger) => (
            <WakeRow
              key={trigger.id}
              deleting={
                removeWake.isPending && removeWake.variables === trigger.id
              }
              onDelete={() => removeWake.mutate(trigger.id)}
              onEnabled={(enabled) =>
                setEnabled.mutate({ triggerId: trigger.id, enabled })
              }
              toggling={
                setEnabled.isPending &&
                setEnabled.variables?.triggerId === trigger.id
              }
              trigger={trigger}
            />
          ))}
        </ul>
      )}

      {removeWake.error instanceof Error ? (
        <p className="mt-2 text-sm text-destructive" role="alert">
          {removeWake.error.message}
        </p>
      ) : null}
      {setEnabled.error instanceof Error ? (
        <p className="mt-2 text-sm text-destructive" role="alert">
          {setEnabled.error.message}
        </p>
      ) : null}

      <AddWakeDialog
        error={createError}
        kind={adding}
        onClose={() => {
          setAdding(null);
          createWake.reset();
        }}
        onCreate={async (kind, values) => {
          const created = await createWake.mutateAsync(
            kind === "cron"
              ? cronWakeInputFrom(channel.id, values.cron)
              : kind === "webhook"
                ? webhookWakeInputFrom(channel.id, values.webhook)
                : emailWakeInputFrom(channel.id, values.email),
          );
          setAdding(null);
          if (created.secret) setRevealed(created);
        }}
        pending={createWake.isPending}
      />

      <RevealSecretDialog
        created={revealed}
        onClose={() => setRevealed(null)}
      />
    </section>
  );
}

function WakeRow({
  trigger,
  toggling,
  deleting,
  onEnabled,
  onDelete,
}: {
  trigger: JobTriggerRecord;
  toggling: boolean;
  deleting: boolean;
  onEnabled: (enabled: boolean) => void;
  onDelete: () => void;
}) {
  const summary = wakeSummary(trigger);
  return (
    <li className="flex flex-wrap items-center gap-2 px-3 py-2.5">
      <div className="min-w-0 flex-1">
        <p className="text-sm tracking-tight">{wakeKindLabel(trigger.kind)}</p>
        <p className="line-clamp-2 text-[12px] leading-4 text-muted-foreground">
          {trigger.kind === "cron"
            ? trigger.prompt
            : trigger.kind === "email"
              ? trigger.mailbox
              : trigger.prompt}
        </p>
        {summary ? (
          <p className="mt-0.5 text-[12px] leading-4 text-muted-foreground">
            {summary}
          </p>
        ) : null}
      </div>
      <Switch
        aria-label={
          trigger.enabled
            ? `Turn off this ${wakeKindLabel(trigger.kind).toLowerCase()}`
            : `Turn on this ${wakeKindLabel(trigger.kind).toLowerCase()}`
        }
        checked={trigger.enabled}
        disabled={toggling || deleting}
        onCheckedChange={onEnabled}
      />
      <Button
        disabled={deleting || toggling}
        onClick={onDelete}
        size="sm"
        variant="ghost"
      >
        {deleting ? "Removing…" : "Remove"}
      </Button>
    </li>
  );
}

function AddWakeDialog({
  kind,
  pending,
  error,
  onClose,
  onCreate,
}: {
  kind: AddKind;
  pending: boolean;
  error: string | null;
  onClose: () => void;
  onCreate: (
    kind: JobTriggerKind,
    values: {
      cron: { prompt: string; everySeconds: number };
      webhook: { prompt: string };
      email: { mailbox: string; prompt: string };
    },
  ) => Promise<void>;
}) {
  const [prompt, setPrompt] = useState("");
  const [everySeconds, setEverySeconds] = useState(3600);
  const [mailbox, setMailbox] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);

  const open = kind !== null;
  const title =
    kind === "cron"
      ? "Add a schedule"
      : kind === "webhook"
        ? "Add a webhook"
        : "Map a mailbox";

  return (
    <Dialog
      onOpenChange={(next) => {
        if (!next) {
          setPrompt("");
          setEverySeconds(3600);
          setMailbox("");
          setFieldError(null);
          onClose();
        }
      }}
      open={open}
    >
      <DialogContent>
        <form
          noValidate
          onSubmit={async (event) => {
            event.preventDefault();
            if (!kind) return;
            setFieldError(null);
            const parsed =
              kind === "cron"
                ? cronWakeFormSchema.safeParse({ prompt, everySeconds })
                : kind === "webhook"
                  ? webhookWakeFormSchema.safeParse({ prompt })
                  : emailWakeFormSchema.safeParse({ mailbox, prompt });
            if (!parsed.success) {
              setFieldError(
                parsed.error.issues[0]?.message ?? "Check the form.",
              );
              return;
            }
            try {
              await onCreate(kind, {
                cron: { prompt, everySeconds },
                webhook: { prompt },
                email: { mailbox, prompt },
              });
              setPrompt("");
              setEverySeconds(3600);
              setMailbox("");
            } catch {
              // The mutation error is shown below.
            }
          }}
        >
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>
              {kind === "cron"
                ? "A standing prompt on a clock. When it is due, this goal's existing thread starts the same way Send-and-go does."
                : kind === "webhook"
                  ? "Something else can start this goal by posting to a URL. The secret is shown once."
                  : "Map a mailbox. Inbound mail is a signed POST to this deployment (Mailgun or SendGrid can send it). This does not open a live inbox."}
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="mt-4">
            {kind === "email" ? (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="wake-mailbox">Mailbox</Label>
                <Input
                  autoComplete="off"
                  id="wake-mailbox"
                  onChange={(event) => setMailbox(event.target.value)}
                  placeholder="work@company.com"
                  type="email"
                  value={mailbox}
                />
              </div>
            ) : null}
            {kind === "cron" ? (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="wake-interval">How often</Label>
                <Select
                  onValueChange={(value) =>
                    setEverySeconds(Number(value ?? everySeconds))
                  }
                  value={String(everySeconds)}
                >
                  <SelectTrigger className="w-full" id="wake-interval">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {INTERVAL_PRESETS.map((preset) => (
                        <SelectItem
                          key={preset.seconds}
                          value={String(preset.seconds)}
                        >
                          {preset.label}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
                <p className="text-[12px] text-muted-foreground">
                  {intervalLabel(everySeconds)}
                </p>
              </div>
            ) : null}
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="wake-prompt">
                {kind === "email"
                  ? "Standing prompt (optional)"
                  : "Standing prompt"}
              </Label>
              <Textarea
                className="min-h-16 text-sm"
                id="wake-prompt"
                onChange={(event) => setPrompt(event.target.value)}
                placeholder={
                  kind === "email"
                    ? "Handle this inbound email as work on this thread."
                    : "What should this goal do when it starts?"
                }
                value={prompt}
              />
            </div>
            {fieldError || error ? (
              <p className="text-sm text-destructive" role="alert">
                {fieldError ?? error}
              </p>
            ) : null}
          </DialogBody>
          <DialogFooter className="mt-4">
            <Button
              disabled={pending}
              onClick={onClose}
              size="sm"
              type="button"
              variant="outline"
            >
              Cancel
            </Button>
            <Button disabled={pending} size="sm" type="submit">
              {pending ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function RevealSecretDialog({
  created,
  onClose,
}: {
  created: CreatedJobTrigger | null;
  onClose: () => void;
}) {
  const trigger = created?.trigger;
  const secret = created?.secret;
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const webhookUrl =
    trigger?.kind === "webhook" && origin
      ? inboundWebhookUrl(origin, trigger.id)
      : "";
  const emailUrl =
    trigger?.kind === "email" && origin ? inboundEmailUrl(origin) : "";

  return (
    <Dialog
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      open={Boolean(created && secret)}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Copy this now</DialogTitle>
          <DialogDescription>
            The secret is not shown again. This deployment keeps only a hash of
            it.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="mt-4">
          {trigger?.kind === "webhook" && webhookUrl ? (
            <CopyField label="Webhook URL" value={webhookUrl} />
          ) : null}
          {trigger?.kind === "email" && emailUrl ? (
            <>
              <CopyField label="Inbound URL" value={emailUrl} />
              {trigger.mailbox ? (
                <CopyField label="Mailbox" value={trigger.mailbox} />
              ) : null}
              <p className="text-[12px] leading-4 text-muted-foreground">
                A provider posts JSON to that URL with the secret. This is not a
                live inbox on this screen.
              </p>
            </>
          ) : null}
          {secret ? <CopyField label="Secret" value={secret} /> : null}
        </DialogBody>
        <DialogFooter className="mt-4">
          <Button onClick={onClose} size="sm">
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CopyField({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="grid gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
        <Button
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(value);
              setCopied(true);
            } catch {
              setCopied(false);
            }
          }}
          size="sm"
          type="button"
          variant="outline"
        >
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
      <code className="block break-all rounded bg-foreground/5 p-2 font-mono text-xs">
        {value}
      </code>
    </div>
  );
}
