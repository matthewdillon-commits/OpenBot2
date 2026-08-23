import { IconMail, IconMessage, IconPhone, IconPlus } from "@tabler/icons-react";
import { useForm } from "@tanstack/react-form";
import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { z } from "zod";
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
  fieldErrorId,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemTitle,
} from "@/components/ui/item";
import { Separator } from "@/components/ui/separator";
import {
  campaignFormSchema,
  companyFormSchema,
  conversationFormSchema,
  opportunityFormSchema,
  personFormSchema,
  sendFormSchema,
  splitList,
} from "@/lib/crm/form";
import {
  createCrmCampaignMutationOptions,
  createCrmCompanyMutationOptions,
  createCrmConversationMutationOptions,
  createCrmOpportunityMutationOptions,
  createCrmPersonMutationOptions,
  createCrmSendMutationOptions,
} from "@/lib/crm/mutations";
import {
  crmCampaignsQueryOptions,
  crmCompaniesQueryOptions,
  crmConversationsQueryOptions,
  crmOpportunitiesQueryOptions,
  crmPeopleQueryOptions,
  crmSendsQueryOptions,
} from "@/lib/crm/queries";
import { queryClient } from "@/query-client";

/**
 * The organization's book of people, companies, opportunities, campaigns, and sends.
 *
 * This is not `/admin/people`. That screen is who may sign in. This one is who the organization
 * is talking to, including email, SMS, and calls with open/click tracking.
 *
 * Wide because a roster of contacts and sends is a table to scan, the same reason audit is wide.
 */
const tabs = [
  ["people", "People"],
  ["companies", "Companies"],
  ["opportunities", "Opportunities"],
  ["campaigns", "Campaigns"],
  ["sends", "Sends"],
  ["activity", "Activity"],
] as const;

type Tab = (typeof tabs)[number][0];
type DialogKind =
  | "person"
  | "company"
  | "opportunity"
  | "campaign"
  | "note"
  | "email"
  | "sms"
  | "call"
  | null;

const crmSearchSchema = z.object({
  tab: z.enum(tabs.map(([key]) => key) as [Tab, ...Tab[]]).optional(),
});

export const Route = createFileRoute("/_authed/_app/crm")({
  validateSearch: crmSearchSchema,
  component: CrmPage,
});

function CrmPage() {
  const { tab: tabParam } = Route.useSearch();
  const navigate = Route.useNavigate();
  const tab: Tab = tabParam ?? "people";
  const [dialog, setDialog] = useState<DialogKind>(null);
  const [error, setError] = useState<string | null>(null);

  const people = useQuery(crmPeopleQueryOptions());
  const companies = useQuery(crmCompaniesQueryOptions());
  const opportunities = useQuery(crmOpportunitiesQueryOptions());
  const campaigns = useQuery(crmCampaignsQueryOptions());
  const conversations = useQuery(crmConversationsQueryOptions());
  const sends = useQuery(crmSendsQueryOptions());

  const createPerson = useMutation(createCrmPersonMutationOptions(queryClient));
  const createCompany = useMutation(
    createCrmCompanyMutationOptions(queryClient),
  );
  const createOpportunity = useMutation(
    createCrmOpportunityMutationOptions(queryClient),
  );
  const createCampaign = useMutation(
    createCrmCampaignMutationOptions(queryClient),
  );
  const createConversation = useMutation(
    createCrmConversationMutationOptions(queryClient),
  );
  const createSend = useMutation(createCrmSendMutationOptions(queryClient));

  const primary = primaryAction(tab);

  return (
    <PageShell
      width="wide"
      title="CRM"
      description="People, companies, opportunities, and every email, SMS, or call this organization sent — with open and click tracking."
      action={
        tab === "sends" ? (
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              type="button"
              onClick={() => {
                setError(null);
                setDialog("email");
              }}
            >
              <IconMail />
              Email
            </Button>
            <Button
              size="sm"
              type="button"
              variant="outline"
              onClick={() => {
                setError(null);
                setDialog("sms");
              }}
            >
              <IconMessage />
              SMS
            </Button>
            <Button
              size="sm"
              type="button"
              variant="outline"
              onClick={() => {
                setError(null);
                setDialog("call");
              }}
            >
              <IconPhone />
              Call
            </Button>
          </div>
        ) : (
          <Button
            size="sm"
            type="button"
            onClick={() => {
              setError(null);
              setDialog(primary.kind);
            }}
          >
            <IconPlus />
            {primary.label}
          </Button>
        )
      }
    >
      <PageSection>
        <div className="flex flex-wrap gap-2">
          {tabs.map(([key, label]) => (
            <Button
              key={key}
              size="sm"
              type="button"
              variant={tab === key ? "default" : "outline"}
              onClick={() => navigate({ search: { tab: key } })}
            >
              {label}
            </Button>
          ))}
        </div>
        {error ? (
          <p className="mt-4 text-destructive text-sm" role="alert">
            {error}
          </p>
        ) : null}
      </PageSection>

      {tab === "people" ? (
        <CrmList
          pending={people.isPending}
          error={people.error}
          empty="No people yet."
          items={people.data?.items ?? []}
          render={(person, index, last) => (
            <StaggerItem index={index} key={person.id}>
              <Item size="sm">
                <ItemContent>
                  <ItemTitle>{person.name}</ItemTitle>
                  <ItemDescription className="line-clamp-none">
                    {[
                      person.emails[0],
                      person.phones[0],
                      person.company?.name,
                      person.jobTitle,
                    ]
                      .filter(Boolean)
                      .join(" · ") || "No contact details"}
                  </ItemDescription>
                </ItemContent>
                <ItemActions>
                  <span className="text-muted-foreground text-xs tabular-nums">
                    {person.createdBy.name}
                  </span>
                </ItemActions>
              </Item>
              {!last ? <Separator /> : null}
            </StaggerItem>
          )}
        />
      ) : null}

      {tab === "companies" ? (
        <CrmList
          pending={companies.isPending}
          error={companies.error}
          empty="No companies yet."
          items={companies.data?.items ?? []}
          render={(company, index, last) => (
            <StaggerItem index={index} key={company.id}>
              <Item size="sm">
                <ItemContent>
                  <ItemTitle>{company.name}</ItemTitle>
                  <ItemDescription className="line-clamp-none">
                    {[company.domain, company.industry, company.phone]
                      .filter(Boolean)
                      .join(" · ") || "No company details"}
                  </ItemDescription>
                </ItemContent>
                <ItemActions>
                  <span className="text-muted-foreground text-xs">
                    {company.createdBy.name}
                  </span>
                </ItemActions>
              </Item>
              {!last ? <Separator /> : null}
            </StaggerItem>
          )}
        />
      ) : null}

      {tab === "opportunities" ? (
        <CrmList
          pending={opportunities.isPending}
          error={opportunities.error}
          empty="No opportunities yet."
          items={opportunities.data?.items ?? []}
          render={(opportunity, index, last) => (
            <StaggerItem index={index} key={opportunity.id}>
              <Item size="sm">
                <ItemContent>
                  <ItemTitle>{opportunity.name}</ItemTitle>
                  <ItemDescription className="line-clamp-none">
                    {[
                      opportunity.stage,
                      opportunity.company?.name,
                      opportunity.person?.name,
                      formatAmount(
                        opportunity.amountCents,
                        opportunity.currency,
                      ),
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </ItemDescription>
                </ItemContent>
              </Item>
              {!last ? <Separator /> : null}
            </StaggerItem>
          )}
        />
      ) : null}

      {tab === "campaigns" ? (
        <CrmList
          pending={campaigns.isPending}
          error={campaigns.error}
          empty="No campaigns yet."
          items={campaigns.data?.items ?? []}
          render={(campaign, index, last) => (
            <StaggerItem index={index} key={campaign.id}>
              <Item size="sm">
                <ItemContent>
                  <ItemTitle>{campaign.name}</ItemTitle>
                  <ItemDescription className="line-clamp-none">
                    {[campaign.status, campaign.description]
                      .filter(Boolean)
                      .join(" · ") || "Draft campaign"}
                  </ItemDescription>
                </ItemContent>
              </Item>
              {!last ? <Separator /> : null}
            </StaggerItem>
          )}
        />
      ) : null}

      {tab === "sends" ? (
        <CrmList
          pending={sends.isPending}
          error={sends.error}
          empty="No emails, texts, or calls recorded yet."
          items={sends.data?.items ?? []}
          render={(send, index, last) => (
            <StaggerItem index={index} key={send.id}>
              <Item size="sm">
                <ItemContent>
                  <ItemTitle>
                    {send.kind === "email"
                      ? "Email"
                      : send.kind === "sms"
                        ? "SMS"
                        : "Call"}{" "}
                    to {send.person?.name ?? send.toAddress}
                  </ItemTitle>
                  <ItemDescription className="line-clamp-none">
                    {[
                      send.subject,
                      send.status,
                      send.provider === "logged"
                        ? "recorded locally"
                        : send.provider,
                      send.kind === "email"
                        ? `${send.tracking.uniqueOpens} opens · ${send.tracking.uniqueClicks} clicks`
                        : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </ItemDescription>
                </ItemContent>
                <ItemActions>
                  {send.kind === "email" ? (
                    <IconMail className="size-4 text-muted-foreground" />
                  ) : send.kind === "sms" ? (
                    <IconMessage className="size-4 text-muted-foreground" />
                  ) : (
                    <IconPhone className="size-4 text-muted-foreground" />
                  )}
                </ItemActions>
              </Item>
              {!last ? <Separator /> : null}
            </StaggerItem>
          )}
        />
      ) : null}

      {tab === "activity" ? (
        <CrmList
          pending={conversations.isPending}
          error={conversations.error}
          empty="No activity yet."
          items={conversations.data?.items ?? []}
          render={(conversation, index, last) => (
            <StaggerItem index={index} key={conversation.id}>
              <Item size="sm">
                <ItemContent>
                  <ItemTitle>{conversation.subject}</ItemTitle>
                  <ItemDescription className="line-clamp-none">
                    {[
                      conversation.channel,
                      conversation.person?.name,
                      conversation.company?.name,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </ItemDescription>
                </ItemContent>
                <ItemActions>
                  <span className="text-muted-foreground text-xs tabular-nums">
                    {relativeDay(conversation.occurredAt)}
                  </span>
                </ItemActions>
              </Item>
              {!last ? <Separator /> : null}
            </StaggerItem>
          )}
        />
      ) : null}

      <Dialog
        open={dialog !== null}
        onOpenChange={(open) => {
          if (!open) setDialog(null);
        }}
      >
        <DialogContent>
          {dialog === "person" ? (
            <PersonDialog
              companies={companies.data?.items ?? []}
              busy={createPerson.isPending}
              onSubmit={async (values) => {
                try {
                  await createPerson.mutateAsync({
                    name: values.name,
                    emails: splitList(values.emails),
                    phones: splitList(values.phones),
                    jobTitle: values.jobTitle || null,
                    companyId: values.companyId || null,
                    notes: values.notes || null,
                  });
                  setDialog(null);
                } catch (thrown) {
                  setError((thrown as Error).message);
                }
              }}
            />
          ) : null}
          {dialog === "company" ? (
            <CompanyDialog
              busy={createCompany.isPending}
              onSubmit={async (values) => {
                try {
                  await createCompany.mutateAsync({
                    name: values.name,
                    domain: values.domain || null,
                    website: values.website || null,
                    industry: values.industry || null,
                    phone: values.phone || null,
                    notes: values.notes || null,
                  });
                  setDialog(null);
                } catch (thrown) {
                  setError((thrown as Error).message);
                }
              }}
            />
          ) : null}
          {dialog === "opportunity" ? (
            <OpportunityDialog
              people={people.data?.items ?? []}
              companies={companies.data?.items ?? []}
              busy={createOpportunity.isPending}
              onSubmit={async (values) => {
                try {
                  await createOpportunity.mutateAsync({
                    name: values.name,
                    stage: values.stage || "new",
                    amountCents: dollarsToCents(values.amount),
                    personId: values.personId || null,
                    companyId: values.companyId || null,
                    notes: values.notes || null,
                  });
                  setDialog(null);
                } catch (thrown) {
                  setError((thrown as Error).message);
                }
              }}
            />
          ) : null}
          {dialog === "campaign" ? (
            <CampaignDialog
              busy={createCampaign.isPending}
              onSubmit={async (values) => {
                try {
                  await createCampaign.mutateAsync({
                    name: values.name,
                    status: values.status || "draft",
                    description: values.description || null,
                    notes: values.notes || null,
                  });
                  setDialog(null);
                } catch (thrown) {
                  setError((thrown as Error).message);
                }
              }}
            />
          ) : null}
          {dialog === "note" ? (
            <NoteDialog
              people={people.data?.items ?? []}
              companies={companies.data?.items ?? []}
              busy={createConversation.isPending}
              onSubmit={async (values) => {
                try {
                  await createConversation.mutateAsync({
                    subject: values.subject,
                    channel: values.channel || "note",
                    body: values.body || null,
                    personId: values.personId || null,
                    companyId: values.companyId || null,
                  });
                  setDialog(null);
                } catch (thrown) {
                  setError((thrown as Error).message);
                }
              }}
            />
          ) : null}
          {dialog === "email" || dialog === "sms" || dialog === "call" ? (
            <SendDialog
              kind={dialog}
              people={people.data?.items ?? []}
              campaigns={campaigns.data?.items ?? []}
              busy={createSend.isPending}
              onSubmit={async (values) => {
                try {
                  await createSend.mutateAsync({
                    kind: values.kind,
                    toAddress: values.toAddress,
                    subject: values.subject || null,
                    body: values.body || null,
                    personId: values.personId || null,
                    campaignId: values.campaignId || null,
                  });
                  setDialog(null);
                } catch (thrown) {
                  setError((thrown as Error).message);
                }
              }}
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </PageShell>
  );
}

/**
 * Shared field helper; each dialog's `useForm` names a different field union, so the helpers take
 * the form as `any` rather than a generated type that cannot be shared.
 */
// biome-ignore lint/suspicious/noExplicitAny: TanStack Form field-name unions cannot be shared
type AnyCrmForm = any;

type CrmField = {
  name: string;
  state: { value: string; meta: { errors: unknown[] } };
  handleChange: (value: string) => void;
  handleBlur: () => void;
};

function CrmList<T>({
  pending,
  error,
  empty,
  items,
  render,
}: {
  pending: boolean;
  error: unknown;
  empty: string;
  items: T[];
  render: (item: T, index: number, last: boolean) => React.ReactNode;
}) {
  if (pending) return null;
  if (error) {
    return (
      <p className="text-destructive text-sm" role="alert">
        Could not load this list.
      </p>
    );
  }
  if (items.length === 0) return <PageEmpty>{empty}</PageEmpty>;
  return (
    <PageRows>
      {items.map((item, index) => render(item, index, index === items.length - 1))}
    </PageRows>
  );
}

function primaryAction(tab: Tab): { kind: Exclude<DialogKind, null>; label: string } {
  if (tab === "companies") return { kind: "company", label: "New company" };
  if (tab === "opportunities")
    return { kind: "opportunity", label: "New opportunity" };
  if (tab === "campaigns") return { kind: "campaign", label: "New campaign" };
  if (tab === "sends") return { kind: "email", label: "New send" };
  if (tab === "activity") return { kind: "note", label: "New note" };
  return { kind: "person", label: "New person" };
}

function PersonDialog({
  companies,
  busy,
  onSubmit,
}: {
  companies: { id: string; name: string }[];
  busy: boolean;
  onSubmit: (values: z.infer<typeof personFormSchema>) => Promise<void>;
}) {
  const form = useForm({
    defaultValues: {
      name: "",
      emails: "",
      phones: "",
      jobTitle: "",
      companyId: "",
      notes: "",
    },
    validators: { onSubmit: personFormSchema },
    onSubmit: async ({ value }) => onSubmit(value),
  });
  return (
    <>
      <DialogHeader>
        <DialogTitle>New person</DialogTitle>
        <DialogDescription>
          A contact this organization is talking to — not someone who signs in.
        </DialogDescription>
      </DialogHeader>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void form.handleSubmit();
        }}
      >
        <DialogBody className="mt-4 overflow-y-auto">
          <FieldGroup>
            <TextField form={form} name="name" label="Name" />
            <TextField
              form={form}
              name="emails"
              label="Emails"
              placeholder="one, or several separated by commas"
            />
            <TextField
              form={form}
              name="phones"
              label="Phones"
              placeholder="one, or several separated by commas"
            />
            <TextField form={form} name="jobTitle" label="Job title" />
            <SelectField
              form={form}
              name="companyId"
              label="Company"
              options={companies.map((company) => ({
                value: company.id,
                label: company.name,
              }))}
            />
            <TextField form={form} name="notes" label="Notes" />
          </FieldGroup>
        </DialogBody>
        <DialogFooter className="mt-4">
          <Button disabled={busy} size="sm" type="submit">
            {busy ? "Saving…" : "Save person"}
          </Button>
        </DialogFooter>
      </form>
    </>
  );
}

function CompanyDialog({
  busy,
  onSubmit,
}: {
  busy: boolean;
  onSubmit: (values: z.infer<typeof companyFormSchema>) => Promise<void>;
}) {
  const form = useForm({
    defaultValues: {
      name: "",
      domain: "",
      website: "",
      industry: "",
      phone: "",
      notes: "",
    },
    validators: { onSubmit: companyFormSchema },
    onSubmit: async ({ value }) => onSubmit(value),
  });
  return (
    <>
      <DialogHeader>
        <DialogTitle>New company</DialogTitle>
        <DialogDescription>
          A firm people in this CRM belong to.
        </DialogDescription>
      </DialogHeader>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void form.handleSubmit();
        }}
      >
        <DialogBody className="mt-4 overflow-y-auto">
          <FieldGroup>
            <TextField form={form} name="name" label="Name" />
            <TextField form={form} name="domain" label="Domain" />
            <TextField form={form} name="website" label="Website" />
            <TextField form={form} name="industry" label="Industry" />
            <TextField form={form} name="phone" label="Phone" />
            <TextField form={form} name="notes" label="Notes" />
          </FieldGroup>
        </DialogBody>
        <DialogFooter className="mt-4">
          <Button disabled={busy} size="sm" type="submit">
            {busy ? "Saving…" : "Save company"}
          </Button>
        </DialogFooter>
      </form>
    </>
  );
}

function OpportunityDialog({
  people,
  companies,
  busy,
  onSubmit,
}: {
  people: { id: string; name: string }[];
  companies: { id: string; name: string }[];
  busy: boolean;
  onSubmit: (values: z.infer<typeof opportunityFormSchema>) => Promise<void>;
}) {
  const form = useForm({
    defaultValues: {
      name: "",
      stage: "new",
      amount: "",
      personId: "",
      companyId: "",
      notes: "",
    },
    validators: { onSubmit: opportunityFormSchema },
    onSubmit: async ({ value }) => onSubmit(value),
  });
  return (
    <>
      <DialogHeader>
        <DialogTitle>New opportunity</DialogTitle>
        <DialogDescription>A deal this organization is working.</DialogDescription>
      </DialogHeader>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void form.handleSubmit();
        }}
      >
        <DialogBody className="mt-4 overflow-y-auto">
          <FieldGroup>
            <TextField form={form} name="name" label="Name" />
            <TextField form={form} name="stage" label="Stage" />
            <TextField form={form} name="amount" label="Amount" />
            <SelectField
              form={form}
              name="personId"
              label="Person"
              options={people.map((person) => ({
                value: person.id,
                label: person.name,
              }))}
            />
            <SelectField
              form={form}
              name="companyId"
              label="Company"
              options={companies.map((company) => ({
                value: company.id,
                label: company.name,
              }))}
            />
            <TextField form={form} name="notes" label="Notes" />
          </FieldGroup>
        </DialogBody>
        <DialogFooter className="mt-4">
          <Button disabled={busy} size="sm" type="submit">
            {busy ? "Saving…" : "Save opportunity"}
          </Button>
        </DialogFooter>
      </form>
    </>
  );
}

function CampaignDialog({
  busy,
  onSubmit,
}: {
  busy: boolean;
  onSubmit: (values: z.infer<typeof campaignFormSchema>) => Promise<void>;
}) {
  const form = useForm({
    defaultValues: { name: "", status: "draft", description: "", notes: "" },
    validators: { onSubmit: campaignFormSchema },
    onSubmit: async ({ value }) => onSubmit(value),
  });
  return (
    <>
      <DialogHeader>
        <DialogTitle>New campaign</DialogTitle>
        <DialogDescription>
          A batch of outreach. Sends can be attached to it.
        </DialogDescription>
      </DialogHeader>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void form.handleSubmit();
        }}
      >
        <DialogBody className="mt-4 overflow-y-auto">
          <FieldGroup>
            <TextField form={form} name="name" label="Name" />
            <SelectField
              form={form}
              name="status"
              label="Status"
              options={[
                { value: "draft", label: "Draft" },
                { value: "running", label: "Running" },
                { value: "completed", label: "Completed" },
              ]}
            />
            <TextField form={form} name="description" label="Description" />
            <TextField form={form} name="notes" label="Notes" />
          </FieldGroup>
        </DialogBody>
        <DialogFooter className="mt-4">
          <Button disabled={busy} size="sm" type="submit">
            {busy ? "Saving…" : "Save campaign"}
          </Button>
        </DialogFooter>
      </form>
    </>
  );
}

function NoteDialog({
  people,
  companies,
  busy,
  onSubmit,
}: {
  people: { id: string; name: string }[];
  companies: { id: string; name: string }[];
  busy: boolean;
  onSubmit: (values: z.infer<typeof conversationFormSchema>) => Promise<void>;
}) {
  const form = useForm({
    defaultValues: {
      subject: "",
      channel: "note",
      body: "",
      personId: "",
      companyId: "",
    },
    validators: { onSubmit: conversationFormSchema },
    onSubmit: async ({ value }) => onSubmit(value),
  });
  return (
    <>
      <DialogHeader>
        <DialogTitle>New note</DialogTitle>
        <DialogDescription>
          A conversation that already happened — a call, a meeting, a chat.
        </DialogDescription>
      </DialogHeader>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void form.handleSubmit();
        }}
      >
        <DialogBody className="mt-4 overflow-y-auto">
          <FieldGroup>
            <TextField form={form} name="subject" label="Subject" />
            <SelectField
              form={form}
              name="channel"
              label="Channel"
              options={[
                { value: "note", label: "Note" },
                { value: "call", label: "Call" },
                { value: "email", label: "Email" },
                { value: "chat", label: "Chat" },
                { value: "meeting", label: "Meeting" },
              ]}
            />
            <TextField form={form} name="body" label="What was said" />
            <SelectField
              form={form}
              name="personId"
              label="Person"
              options={people.map((person) => ({
                value: person.id,
                label: person.name,
              }))}
            />
            <SelectField
              form={form}
              name="companyId"
              label="Company"
              options={companies.map((company) => ({
                value: company.id,
                label: company.name,
              }))}
            />
          </FieldGroup>
        </DialogBody>
        <DialogFooter className="mt-4">
          <Button disabled={busy} size="sm" type="submit">
            {busy ? "Saving…" : "Save note"}
          </Button>
        </DialogFooter>
      </form>
    </>
  );
}

function SendDialog({
  kind,
  people,
  campaigns,
  busy,
  onSubmit,
}: {
  kind: "email" | "sms" | "call";
  people: { id: string; name: string; emails: string[]; phones: string[] }[];
  campaigns: { id: string; name: string }[];
  busy: boolean;
  onSubmit: (values: z.infer<typeof sendFormSchema>) => Promise<void>;
}) {
  const form = useForm({
    defaultValues: {
      kind,
      toAddress: "",
      subject: "",
      body: "",
      personId: "",
      campaignId: "",
    },
    validators: { onSubmit: sendFormSchema },
    onSubmit: async ({ value }) => onSubmit(value),
  });
  const title =
    kind === "email" ? "Send email" : kind === "sms" ? "Send SMS" : "Log call";
  return (
    <>
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>
          {kind === "call"
            ? "Record a call that happened. Delivery is not placed from here."
            : "SMTP or Twilio delivers when configured; otherwise this is recorded and tracked."}
        </DialogDescription>
      </DialogHeader>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void form.handleSubmit();
        }}
      >
        <DialogBody className="mt-4 overflow-y-auto">
          <FieldGroup>
            <SelectField
              form={form}
              name="personId"
              label="Person"
              options={people.map((person) => ({
                value: person.id,
                label: person.name,
              }))}
              onPicked={(id) => {
                const person = people.find((entry) => entry.id === id);
                if (!person) return;
                const address =
                  kind === "email" ? person.emails[0] : person.phones[0];
                if (address) form.setFieldValue("toAddress", address);
              }}
            />
            <TextField
              form={form}
              name="toAddress"
              label={kind === "email" ? "Email" : "Phone"}
            />
            {kind === "email" ? (
              <TextField form={form} name="subject" label="Subject" />
            ) : null}
            <TextField
              form={form}
              name="body"
              label={kind === "call" ? "Notes" : "Message"}
            />
            <SelectField
              form={form}
              name="campaignId"
              label="Campaign"
              options={campaigns.map((campaign) => ({
                value: campaign.id,
                label: campaign.name,
              }))}
            />
          </FieldGroup>
        </DialogBody>
        <DialogFooter className="mt-4">
          <Button disabled={busy} size="sm" type="submit">
            {busy ? "Saving…" : title}
          </Button>
        </DialogFooter>
      </form>
    </>
  );
}

function TextField({
  form,
  name,
  label,
  placeholder,
}: {
  form: AnyCrmForm;
  name: string;
  label: string;
  placeholder?: string;
}) {
  return (
    <form.Field name={name}>
      {(field: CrmField) => {
        const errorId = fieldErrorId(field.name);
        const message = fieldMessage(field.state.meta.errors);
        return (
          <Field>
            <FieldLabel htmlFor={field.name}>{label}</FieldLabel>
            <Input
              id={field.name}
              name={field.name}
              value={field.state.value}
              placeholder={placeholder}
              aria-describedby={message ? errorId : undefined}
              onBlur={field.handleBlur}
              onChange={(event) => field.handleChange(event.target.value)}
            />
            {message ? (
              <FieldError id={errorId}>{message}</FieldError>
            ) : null}
          </Field>
        );
      }}
    </form.Field>
  );
}

function SelectField({
  form,
  name,
  label,
  options,
  onPicked,
}: {
  form: AnyCrmForm;
  name: string;
  label: string;
  options: { value: string; label: string }[];
  onPicked?: (value: string) => void;
}) {
  return (
    <form.Field name={name}>
      {(field: CrmField) => (
        <Field>
          <FieldLabel htmlFor={field.name}>{label}</FieldLabel>
          <select
            id={field.name}
            name={field.name}
            className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
            value={field.state.value}
            onChange={(event) => {
              field.handleChange(event.target.value);
              onPicked?.(event.target.value);
            }}
          >
            <option value="">None</option>
            {options.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </Field>
      )}
    </form.Field>
  );
}

function fieldMessage(errors: unknown[]): string | null {
  const first = errors[0];
  if (!first) return null;
  if (typeof first === "string") return first;
  if (first && typeof first === "object" && "message" in first) {
    return String((first as { message: string }).message);
  }
  return null;
}

function dollarsToCents(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const amount = Number.parseFloat(trimmed);
  if (!Number.isFinite(amount)) return null;
  return Math.round(amount * 100);
}

function formatAmount(cents: number | null, currency: string): string | null {
  if (cents === null) return null;
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency,
  }).format(cents / 100);
}

function relativeDay(iso: string): string {
  const then = new Date(iso).getTime();
  const days = Math.round((Date.now() - then) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  return `${days}d ago`;
}
