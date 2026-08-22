import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  campaignFormFrom,
  campaignInputFrom,
  companyFormFrom,
  companyInputFrom,
  conversationFormFrom,
  conversationInputFrom,
  emptyCampaignForm,
  emptyCompanyForm,
  emptyConversationForm,
  emptyOpportunityForm,
  emptyPersonForm,
  opportunityFormFrom,
  opportunityInputFrom,
  personFormFrom,
  personInputFrom,
} from "@/lib/crm/form";
import {
  createCampaignMutationOptions,
  createCompanyMutationOptions,
  createConversationMutationOptions,
  createOpportunityMutationOptions,
  createPersonMutationOptions,
  updateCampaignMutationOptions,
  updateCompanyMutationOptions,
  updateConversationMutationOptions,
  updateOpportunityMutationOptions,
  updatePersonMutationOptions,
} from "@/lib/crm/mutations";
import {
  type CrmCampaign,
  type CrmCompany,
  crmCompaniesQueryOptions,
  type CrmConversation,
  type CrmOpportunity,
  type CrmPerson,
  crmPeopleQueryOptions,
} from "@/lib/crm/queries";
import { queryClient } from "@/query-client";

function FieldError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p className="text-destructive text-sm" role="alert">
      {message}
    </p>
  );
}

export function PersonForm({
  person,
  onDone,
}: {
  person?: CrmPerson;
  onDone: () => void;
}) {
  const companies = useQuery(crmCompaniesQueryOptions());
  const create = useMutation(createPersonMutationOptions(queryClient));
  const update = useMutation(updatePersonMutationOptions(queryClient));
  const [values, setValues] = useState(
    person ? personFormFrom(person) : emptyPersonForm,
  );
  const [error, setError] = useState<string | null>(null);
  const pending = create.isPending || update.isPending;

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={async (event) => {
        event.preventDefault();
        setError(null);
        try {
          const input = personInputFrom(values);
          if (person) {
            await update.mutateAsync({ id: person.id, input });
          } else {
            await create.mutateAsync(input);
          }
          onDone();
        } catch (caught) {
          setError(
            caught instanceof Error ? caught.message : "Could not save.",
          );
        }
      }}
    >
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="person-name">Name</FieldLabel>
          <Input
            id="person-name"
            onChange={(event) =>
              setValues((current) => ({ ...current, name: event.target.value }))
            }
            required
            value={values.name}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="person-emails">Emails</FieldLabel>
          <Input
            id="person-emails"
            onChange={(event) =>
              setValues((current) => ({
                ...current,
                emails: event.target.value,
              }))
            }
            placeholder="one@example.com, two@example.com"
            value={values.emails}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="person-phones">Phones</FieldLabel>
          <Input
            id="person-phones"
            onChange={(event) =>
              setValues((current) => ({
                ...current,
                phones: event.target.value,
              }))
            }
            value={values.phones}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="person-title">Job title</FieldLabel>
          <Input
            id="person-title"
            onChange={(event) =>
              setValues((current) => ({
                ...current,
                jobTitle: event.target.value,
              }))
            }
            value={values.jobTitle}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="person-company">Company</FieldLabel>
          <select
            className="h-9 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm"
            id="person-company"
            onChange={(event) =>
              setValues((current) => ({
                ...current,
                companyId: event.target.value,
              }))
            }
            value={values.companyId}
          >
            <option value="">No company</option>
            {companies.data?.items.map((company) => (
              <option key={company.id} value={company.id}>
                {company.name}
              </option>
            ))}
          </select>
        </Field>
        <Field>
          <FieldLabel htmlFor="person-notes">Notes</FieldLabel>
          <Textarea
            id="person-notes"
            onChange={(event) =>
              setValues((current) => ({
                ...current,
                notes: event.target.value,
              }))
            }
            value={values.notes}
          />
        </Field>
      </FieldGroup>
      <FieldError message={error} />
      <Button disabled={pending} size="sm" type="submit">
        {pending ? "Saving…" : person ? "Save person" : "Create person"}
      </Button>
    </form>
  );
}

export function CompanyForm({
  company,
  onDone,
}: {
  company?: CrmCompany;
  onDone: () => void;
}) {
  const create = useMutation(createCompanyMutationOptions(queryClient));
  const update = useMutation(updateCompanyMutationOptions(queryClient));
  const [values, setValues] = useState(
    company ? companyFormFrom(company) : emptyCompanyForm,
  );
  const [error, setError] = useState<string | null>(null);
  const pending = create.isPending || update.isPending;

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={async (event) => {
        event.preventDefault();
        setError(null);
        try {
          const input = companyInputFrom(values);
          if (company) {
            await update.mutateAsync({ id: company.id, input });
          } else {
            await create.mutateAsync(input);
          }
          onDone();
        } catch (caught) {
          setError(
            caught instanceof Error ? caught.message : "Could not save.",
          );
        }
      }}
    >
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="company-name">Name</FieldLabel>
          <Input
            id="company-name"
            onChange={(event) =>
              setValues((current) => ({ ...current, name: event.target.value }))
            }
            required
            value={values.name}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="company-domain">Domain</FieldLabel>
          <Input
            id="company-domain"
            onChange={(event) =>
              setValues((current) => ({
                ...current,
                domain: event.target.value,
              }))
            }
            placeholder="acme.com"
            value={values.domain}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="company-website">Website</FieldLabel>
          <Input
            id="company-website"
            onChange={(event) =>
              setValues((current) => ({
                ...current,
                website: event.target.value,
              }))
            }
            value={values.website}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="company-industry">Industry</FieldLabel>
          <Input
            id="company-industry"
            onChange={(event) =>
              setValues((current) => ({
                ...current,
                industry: event.target.value,
              }))
            }
            value={values.industry}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="company-phone">Phone</FieldLabel>
          <Input
            id="company-phone"
            onChange={(event) =>
              setValues((current) => ({
                ...current,
                phone: event.target.value,
              }))
            }
            value={values.phone}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="company-notes">Notes</FieldLabel>
          <Textarea
            id="company-notes"
            onChange={(event) =>
              setValues((current) => ({
                ...current,
                notes: event.target.value,
              }))
            }
            value={values.notes}
          />
        </Field>
      </FieldGroup>
      <FieldError message={error} />
      <Button disabled={pending} size="sm" type="submit">
        {pending ? "Saving…" : company ? "Save company" : "Create company"}
      </Button>
    </form>
  );
}

export function OpportunityForm({
  opportunity,
  onDone,
}: {
  opportunity?: CrmOpportunity;
  onDone: () => void;
}) {
  const companies = useQuery(crmCompaniesQueryOptions());
  const people = useQuery(crmPeopleQueryOptions());
  const create = useMutation(createOpportunityMutationOptions(queryClient));
  const update = useMutation(updateOpportunityMutationOptions(queryClient));
  const [values, setValues] = useState(
    opportunity ? opportunityFormFrom(opportunity) : emptyOpportunityForm,
  );
  const [error, setError] = useState<string | null>(null);
  const pending = create.isPending || update.isPending;

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={async (event) => {
        event.preventDefault();
        setError(null);
        try {
          const input = opportunityInputFrom(values);
          if (opportunity) {
            await update.mutateAsync({ id: opportunity.id, input });
          } else {
            await create.mutateAsync(input);
          }
          onDone();
        } catch (caught) {
          setError(
            caught instanceof Error ? caught.message : "Could not save.",
          );
        }
      }}
    >
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="opp-name">Name</FieldLabel>
          <Input
            id="opp-name"
            onChange={(event) =>
              setValues((current) => ({ ...current, name: event.target.value }))
            }
            required
            value={values.name}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="opp-stage">Stage</FieldLabel>
          <select
            className="h-9 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm"
            id="opp-stage"
            onChange={(event) =>
              setValues((current) => ({
                ...current,
                stage: event.target.value,
              }))
            }
            value={values.stage}
          >
            <option value="new">New</option>
            <option value="qualified">Qualified</option>
            <option value="proposal">Proposal</option>
            <option value="negotiation">Negotiation</option>
            <option value="won">Won</option>
            <option value="lost">Lost</option>
          </select>
        </Field>
        <Field>
          <FieldLabel htmlFor="opp-amount">Amount</FieldLabel>
          <Input
            id="opp-amount"
            inputMode="decimal"
            onChange={(event) =>
              setValues((current) => ({
                ...current,
                amount: event.target.value,
              }))
            }
            value={values.amount}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="opp-company">Company</FieldLabel>
          <select
            className="h-9 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm"
            id="opp-company"
            onChange={(event) =>
              setValues((current) => ({
                ...current,
                companyId: event.target.value,
              }))
            }
            value={values.companyId}
          >
            <option value="">No company</option>
            {companies.data?.items.map((company) => (
              <option key={company.id} value={company.id}>
                {company.name}
              </option>
            ))}
          </select>
        </Field>
        <Field>
          <FieldLabel htmlFor="opp-person">Person</FieldLabel>
          <select
            className="h-9 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm"
            id="opp-person"
            onChange={(event) =>
              setValues((current) => ({
                ...current,
                personId: event.target.value,
              }))
            }
            value={values.personId}
          >
            <option value="">No person</option>
            {people.data?.items.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.name}
              </option>
            ))}
          </select>
        </Field>
        <Field>
          <FieldLabel htmlFor="opp-close">Expected close</FieldLabel>
          <Input
            id="opp-close"
            onChange={(event) =>
              setValues((current) => ({
                ...current,
                expectedCloseAt: event.target.value,
              }))
            }
            type="date"
            value={values.expectedCloseAt}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="opp-notes">Notes</FieldLabel>
          <Textarea
            id="opp-notes"
            onChange={(event) =>
              setValues((current) => ({
                ...current,
                notes: event.target.value,
              }))
            }
            value={values.notes}
          />
        </Field>
      </FieldGroup>
      <FieldError message={error} />
      <Button disabled={pending} size="sm" type="submit">
        {pending
          ? "Saving…"
          : opportunity
            ? "Save opportunity"
            : "Create opportunity"}
      </Button>
    </form>
  );
}

export function CampaignForm({
  campaign,
  onDone,
}: {
  campaign?: CrmCampaign;
  onDone: () => void;
}) {
  const create = useMutation(createCampaignMutationOptions(queryClient));
  const update = useMutation(updateCampaignMutationOptions(queryClient));
  const [values, setValues] = useState(
    campaign ? campaignFormFrom(campaign) : emptyCampaignForm,
  );
  const [error, setError] = useState<string | null>(null);
  const pending = create.isPending || update.isPending;

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={async (event) => {
        event.preventDefault();
        setError(null);
        try {
          const input = campaignInputFrom(values);
          if (campaign) {
            await update.mutateAsync({ id: campaign.id, input });
          } else {
            await create.mutateAsync(input);
          }
          onDone();
        } catch (caught) {
          setError(
            caught instanceof Error ? caught.message : "Could not save.",
          );
        }
      }}
    >
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="campaign-name">Name</FieldLabel>
          <Input
            id="campaign-name"
            onChange={(event) =>
              setValues((current) => ({ ...current, name: event.target.value }))
            }
            required
            value={values.name}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="campaign-status">Status</FieldLabel>
          <select
            className="h-9 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm"
            id="campaign-status"
            onChange={(event) =>
              setValues((current) => ({
                ...current,
                status: event.target.value,
              }))
            }
            value={values.status}
          >
            <option value="draft">Draft</option>
            <option value="active">Active</option>
            <option value="paused">Paused</option>
            <option value="completed">Completed</option>
          </select>
        </Field>
        <Field>
          <FieldLabel htmlFor="campaign-description">Description</FieldLabel>
          <Textarea
            id="campaign-description"
            onChange={(event) =>
              setValues((current) => ({
                ...current,
                description: event.target.value,
              }))
            }
            value={values.description}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="campaign-started">Started</FieldLabel>
          <Input
            id="campaign-started"
            onChange={(event) =>
              setValues((current) => ({
                ...current,
                startedAt: event.target.value,
              }))
            }
            type="date"
            value={values.startedAt}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="campaign-ended">Ended</FieldLabel>
          <Input
            id="campaign-ended"
            onChange={(event) =>
              setValues((current) => ({
                ...current,
                endedAt: event.target.value,
              }))
            }
            type="date"
            value={values.endedAt}
          />
        </Field>
      </FieldGroup>
      <FieldError message={error} />
      <Button disabled={pending} size="sm" type="submit">
        {pending ? "Saving…" : campaign ? "Save campaign" : "Create campaign"}
      </Button>
    </form>
  );
}

export function ConversationForm({
  conversation,
  onDone,
}: {
  conversation?: CrmConversation;
  onDone: () => void;
}) {
  const companies = useQuery(crmCompaniesQueryOptions());
  const people = useQuery(crmPeopleQueryOptions());
  const create = useMutation(createConversationMutationOptions(queryClient));
  const update = useMutation(updateConversationMutationOptions(queryClient));
  const [values, setValues] = useState(
    conversation ? conversationFormFrom(conversation) : emptyConversationForm,
  );
  const [error, setError] = useState<string | null>(null);
  const pending = create.isPending || update.isPending;

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={async (event) => {
        event.preventDefault();
        setError(null);
        try {
          const input = conversationInputFrom(values);
          if (conversation) {
            await update.mutateAsync({ id: conversation.id, input });
          } else {
            await create.mutateAsync(input);
          }
          onDone();
        } catch (caught) {
          setError(
            caught instanceof Error ? caught.message : "Could not save.",
          );
        }
      }}
    >
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="conv-subject">Subject</FieldLabel>
          <Input
            id="conv-subject"
            onChange={(event) =>
              setValues((current) => ({
                ...current,
                subject: event.target.value,
              }))
            }
            required
            value={values.subject}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="conv-channel">Channel</FieldLabel>
          <select
            className="h-9 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm"
            id="conv-channel"
            onChange={(event) =>
              setValues((current) => ({
                ...current,
                channel: event.target.value,
              }))
            }
            value={values.channel}
          >
            <option value="note">Note</option>
            <option value="email">Email</option>
            <option value="call">Call</option>
            <option value="meeting">Meeting</option>
            <option value="chat">Chat</option>
          </select>
        </Field>
        <Field>
          <FieldLabel htmlFor="conv-person">Person</FieldLabel>
          <select
            className="h-9 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm"
            id="conv-person"
            onChange={(event) =>
              setValues((current) => ({
                ...current,
                personId: event.target.value,
              }))
            }
            value={values.personId}
          >
            <option value="">No person</option>
            {people.data?.items.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.name}
              </option>
            ))}
          </select>
        </Field>
        <Field>
          <FieldLabel htmlFor="conv-company">Company</FieldLabel>
          <select
            className="h-9 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm"
            id="conv-company"
            onChange={(event) =>
              setValues((current) => ({
                ...current,
                companyId: event.target.value,
              }))
            }
            value={values.companyId}
          >
            <option value="">No company</option>
            {companies.data?.items.map((company) => (
              <option key={company.id} value={company.id}>
                {company.name}
              </option>
            ))}
          </select>
        </Field>
        <Field>
          <FieldLabel htmlFor="conv-body">Body</FieldLabel>
          <Textarea
            id="conv-body"
            onChange={(event) =>
              setValues((current) => ({
                ...current,
                body: event.target.value,
              }))
            }
            value={values.body}
          />
        </Field>
      </FieldGroup>
      <FieldError message={error} />
      <Button disabled={pending} size="sm" type="submit">
        {pending
          ? "Saving…"
          : conversation
            ? "Save conversation"
            : "Create conversation"}
      </Button>
    </form>
  );
}
