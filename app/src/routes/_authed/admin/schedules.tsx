import { IconCalendarTime, IconPlus } from "@tabler/icons-react";
import { useForm } from "@tanstack/react-form";
import { useMutation, useQuery } from "@tanstack/react-query";
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
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { agentListQueryOptions } from "@/lib/agents/queries";
import {
  type ScheduleFormValues,
  scheduleFormSchema,
  scheduleInputFrom,
} from "@/lib/schedules/form";
import {
  createScheduleMutationOptions,
  deleteScheduleMutationOptions,
  pauseScheduleMutationOptions,
} from "@/lib/schedules/mutations";
import {
  type ScheduleRecord,
  scheduleListQueryOptions,
} from "@/lib/schedules/queries";
import { queryClient } from "@/query-client";

export const Route = createFileRoute("/_authed/admin/schedules")({
  component: SchedulesPage,
});

function SchedulesPage() {
  const [adding, setAdding] = useState(false);
  const [issuedSecret, setIssuedSecret] = useState<string | null>(null);
  const schedules = useQuery(scheduleListQueryOptions());
  const agents = useQuery(agentListQueryOptions());
  const createSchedule = useMutation(
    createScheduleMutationOptions(queryClient),
  );
  const pauseSchedule = useMutation(pauseScheduleMutationOptions(queryClient));
  const deleteSchedule = useMutation(
    deleteScheduleMutationOptions(queryClient),
  );

  const defaultValues: ScheduleFormValues = {
    name: "",
    agentId: "",
    kind: "cron",
    brief: "",
    cronExpr: "0 9 * * *",
    weekdayBounded: true,
    matchFrom: "",
    matchTo: "",
    matchSubject: "",
  };
  const form = useForm({
    defaultValues,
    validators: { onSubmit: scheduleFormSchema },
    onSubmit: async ({ value }) => {
      const created = await createSchedule.mutateAsync(
        scheduleInputFrom(value),
      );
      form.reset();
      setAdding(false);
      setIssuedSecret(created.webhookSecret ?? null);
    },
  });

  const coworkers = agents.data ?? [];

  return (
    <PageShell
      action={
        <Button onClick={() => setAdding(true)} size="sm" variant="ghost">
          <IconPlus />
          Add schedule
        </Button>
      }
      description="Standing work that outlives a chat turn. A cron job fires in this deployment's timezone, weekdays only unless you say otherwise. A webhook needs a one-time secret. Inbound email needs an IMAP credential under Admin → Credentials and wakes the coworker when a matching message arrives."
      title="Schedules"
    >
      <Dialog
        onOpenChange={(open) => {
          setAdding(open);
          if (!open) form.reset();
        }}
        open={adding}
      >
        <DialogContent>
          <form
            noValidate
            onSubmit={(event) => {
              event.preventDefault();
              form.handleSubmit();
            }}
          >
            <DialogHeader>
              <DialogTitle>Add schedule</DialogTitle>
              <DialogDescription>
                Creating a job is a governed action. A deny rule on{" "}
                <code>intent == "schedule"</code> creates nothing.
              </DialogDescription>
            </DialogHeader>
            <DialogBody className="mt-4 overflow-y-auto">
              <FieldGroup>
                <form.Field name="name">
                  {(field) => {
                    const isInvalid =
                      field.state.meta.isTouched && !field.state.meta.isValid;
                    return (
                      <Field data-invalid={isInvalid}>
                        <FieldLabel htmlFor={field.name}>Name</FieldLabel>
                        <Input
                          aria-invalid={isInvalid}
                          id={field.name}
                          onBlur={field.handleBlur}
                          onChange={(event) =>
                            field.handleChange(event.target.value)
                          }
                          value={field.state.value}
                        />
                        {isInvalid ? (
                          <FieldError errors={field.state.meta.errors} />
                        ) : null}
                      </Field>
                    );
                  }}
                </form.Field>
                <form.Field name="agentId">
                  {(field) => {
                    const isInvalid =
                      field.state.meta.isTouched && !field.state.meta.isValid;
                    return (
                      <Field data-invalid={isInvalid}>
                        <FieldLabel htmlFor={field.name}>Coworker</FieldLabel>
                        <Select
                          onValueChange={(value) => {
                            if (value) field.handleChange(value);
                          }}
                          value={field.state.value}
                        >
                          <SelectTrigger
                            aria-invalid={isInvalid}
                            id={field.name}
                          >
                            <SelectValue placeholder="Choose a coworker" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectGroup>
                              {coworkers.map((coworker) => (
                                <SelectItem
                                  key={coworker.id}
                                  value={coworker.id}
                                >
                                  {coworker.name}
                                </SelectItem>
                              ))}
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
                <form.Field name="kind">
                  {(field) => (
                    <Field>
                      <FieldLabel htmlFor={field.name}>When</FieldLabel>
                      <Select
                        onValueChange={(value) => {
                          if (
                            value === "cron" ||
                            value === "webhook" ||
                            value === "email"
                          ) {
                            field.handleChange(value);
                          }
                        }}
                        value={field.state.value}
                      >
                        <SelectTrigger id={field.name}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectGroup>
                            <SelectItem value="cron">On a cron</SelectItem>
                            <SelectItem value="webhook">
                              On a webhook
                            </SelectItem>
                            <SelectItem value="email">
                              On inbound email
                            </SelectItem>
                          </SelectGroup>
                        </SelectContent>
                      </Select>
                    </Field>
                  )}
                </form.Field>
                <form.Field name="cronExpr">
                  {(field) => {
                    const isInvalid =
                      field.state.meta.isTouched && !field.state.meta.isValid;
                    return (
                      <form.Subscribe selector={(state) => state.values.kind}>
                        {(kind) =>
                          kind === "cron" ? (
                            <Field data-invalid={isInvalid}>
                              <FieldLabel htmlFor={field.name}>Cron</FieldLabel>
                              <Input
                                aria-invalid={isInvalid}
                                id={field.name}
                                onBlur={field.handleBlur}
                                onChange={(event) =>
                                  field.handleChange(event.target.value)
                                }
                                spellCheck={false}
                                value={field.state.value}
                              />
                              {isInvalid ? (
                                <FieldError errors={field.state.meta.errors} />
                              ) : null}
                            </Field>
                          ) : null
                        }
                      </form.Subscribe>
                    );
                  }}
                </form.Field>
                <form.Field name="weekdayBounded">
                  {(field) => (
                    <form.Subscribe selector={(state) => state.values.kind}>
                      {(kind) =>
                        kind === "cron" ? (
                          <Field>
                            <FieldLabel htmlFor={field.name}>
                              Weekdays only
                            </FieldLabel>
                            <Switch
                              aria-label="Weekdays only"
                              checked={field.state.value}
                              id={field.name}
                              onCheckedChange={field.handleChange}
                            />
                          </Field>
                        ) : null
                      }
                    </form.Subscribe>
                  )}
                </form.Field>
                <form.Field name="matchFrom">
                  {(field) => (
                    <form.Subscribe selector={(state) => state.values.kind}>
                      {(kind) =>
                        kind === "email" ? (
                          <Field>
                            <FieldLabel htmlFor={field.name}>
                              From contains
                            </FieldLabel>
                            <Input
                              id={field.name}
                              onBlur={field.handleBlur}
                              onChange={(event) =>
                                field.handleChange(event.target.value)
                              }
                              placeholder="Optional"
                              value={field.state.value}
                            />
                          </Field>
                        ) : null
                      }
                    </form.Subscribe>
                  )}
                </form.Field>
                <form.Field name="matchTo">
                  {(field) => (
                    <form.Subscribe selector={(state) => state.values.kind}>
                      {(kind) =>
                        kind === "email" ? (
                          <Field>
                            <FieldLabel htmlFor={field.name}>
                              To contains
                            </FieldLabel>
                            <Input
                              id={field.name}
                              onBlur={field.handleBlur}
                              onChange={(event) =>
                                field.handleChange(event.target.value)
                              }
                              placeholder="Optional"
                              value={field.state.value}
                            />
                          </Field>
                        ) : null
                      }
                    </form.Subscribe>
                  )}
                </form.Field>
                <form.Field name="matchSubject">
                  {(field) => (
                    <form.Subscribe selector={(state) => state.values.kind}>
                      {(kind) =>
                        kind === "email" ? (
                          <Field>
                            <FieldLabel htmlFor={field.name}>
                              Subject contains
                            </FieldLabel>
                            <Input
                              id={field.name}
                              onBlur={field.handleBlur}
                              onChange={(event) =>
                                field.handleChange(event.target.value)
                              }
                              placeholder="Optional"
                              value={field.state.value}
                            />
                          </Field>
                        ) : null
                      }
                    </form.Subscribe>
                  )}
                </form.Field>
                <form.Field name="brief">
                  {(field) => {
                    const isInvalid =
                      field.state.meta.isTouched && !field.state.meta.isValid;
                    return (
                      <Field data-invalid={isInvalid}>
                        <FieldLabel htmlFor={field.name}>Brief</FieldLabel>
                        <Textarea
                          aria-invalid={isInvalid}
                          id={field.name}
                          onBlur={field.handleBlur}
                          onChange={(event) =>
                            field.handleChange(event.target.value)
                          }
                          value={field.state.value}
                        />
                        {isInvalid ? (
                          <FieldError errors={field.state.meta.errors} />
                        ) : null}
                      </Field>
                    );
                  }}
                </form.Field>
              </FieldGroup>
            </DialogBody>
            <DialogFooter className="mt-4">
              <Button
                disabled={createSchedule.isPending}
                size="sm"
                type="submit"
              >
                {createSchedule.isPending ? "Saving…" : "Create"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        onOpenChange={(open) => {
          if (!open) setIssuedSecret(null);
        }}
        open={Boolean(issuedSecret)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Webhook secret</DialogTitle>
            <DialogDescription>
              Shown once. POST /api/triggers/&lt;id&gt; with this as a Bearer
              token. Inbound email jobs do not use this secret — they fire from
              the IMAP poller.
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="mt-4">
            <p className="break-all font-mono text-sm">{issuedSecret}</p>
          </DialogBody>
          <DialogFooter className="mt-4">
            <Button onClick={() => setIssuedSecret(null)} size="sm">
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <PageSection title="Standing jobs">
        {schedules.isPending ? null : schedules.error ? (
          <p className="text-destructive text-sm" role="alert">
            Could not load schedules.
          </p>
        ) : schedules.data?.length === 0 ? (
          <PageEmpty>No schedules are configured.</PageEmpty>
        ) : (
          <PageRows>
            {schedules.data?.map((schedule, index) => (
              <StaggerItem index={index} key={schedule.id}>
                <ScheduleRow
                  agents={coworkers}
                  busy={pauseSchedule.isPending || deleteSchedule.isPending}
                  onDelete={() => deleteSchedule.mutate(schedule.id)}
                  onPause={(paused) =>
                    pauseSchedule.mutate({
                      scheduleId: schedule.id,
                      paused,
                    })
                  }
                  schedule={schedule}
                />
                {index !== (schedules.data?.length ?? 0) - 1 && <Separator />}
              </StaggerItem>
            ))}
          </PageRows>
        )}
      </PageSection>
    </PageShell>
  );
}

function ScheduleRow(props: {
  schedule: ScheduleRecord;
  agents: { id: string; name: string }[];
  busy: boolean;
  onPause: (paused: boolean) => void;
  onDelete: () => void;
}) {
  const { schedule, agents, busy, onPause, onDelete } = props;
  const coworker =
    agents.find((agent) => agent.id === schedule.agentId)?.name ??
    schedule.agentId;
  const summary = scheduleSummary(schedule, coworker);

  return (
    <Item size="sm">
      <ItemMedia>
        <IconCalendarTime className="size-4 text-muted-foreground" />
      </ItemMedia>
      <ItemContent>
        <ItemTitle>{schedule.name}</ItemTitle>
        <ItemDescription className="line-clamp-none">{summary}</ItemDescription>
      </ItemContent>
      <ItemActions>
        <Button disabled={busy} onClick={onDelete} size="sm" variant="ghost">
          Delete
        </Button>
        <Switch
          aria-label={`Active: ${schedule.name}`}
          checked={schedule.status === "active"}
          disabled={busy}
          onCheckedChange={(checked) => onPause(!checked)}
        />
      </ItemActions>
    </Item>
  );
}

function scheduleSummary(schedule: ScheduleRecord, coworker: string): string {
  const when =
    schedule.kind === "cron"
      ? `${schedule.cronExpr ?? "cron"} in ${schedule.timezone}${
          schedule.weekdayBounded ? ", weekdays" : ""
        }`
      : schedule.kind === "webhook"
        ? "webhook trigger"
        : emailTriggerSummary(schedule);
  const next = schedule.nextRunAt
    ? ` Next ${new Date(schedule.nextRunAt).toLocaleString()}.`
    : "";
  const last = schedule.lastRunAt
    ? ` Last ${new Date(schedule.lastRunAt).toLocaleString()}.`
    : "";
  return `${coworker} · ${when}.${next}${last} ${schedule.brief}`;
}

function emailTriggerSummary(schedule: ScheduleRecord): string {
  const filters = [
    schedule.matchFrom ? `from ${schedule.matchFrom}` : null,
    schedule.matchTo ? `to ${schedule.matchTo}` : null,
    schedule.matchSubject ? `subject ${schedule.matchSubject}` : null,
  ].filter(Boolean);
  return filters.length > 0
    ? `inbound email (${filters.join(", ")})`
    : "inbound email trigger";
}
