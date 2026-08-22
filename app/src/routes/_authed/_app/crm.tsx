import { IconPlus } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { type ReactNode, useState } from "react";
import { z } from "zod";
import {
  CampaignForm,
  CompanyForm,
  ConversationForm,
  OpportunityForm,
  PersonForm,
} from "@/components/crm/forms";
import {
  AvatarInitials,
  CompanyMark,
  createdByLabel,
  relativeTime,
} from "@/components/crm/helpers";
import { DetailPanel } from "@/components/layout/detail-panel";
import { Button } from "@/components/ui/button";
import { Empty, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import {
  crmCampaignsQueryOptions,
  crmCompaniesQueryOptions,
  crmConversationsQueryOptions,
  crmOpportunitiesQueryOptions,
  crmPeopleQueryOptions,
} from "@/lib/crm/queries";
import { cn } from "@/lib/utils";

/**
 * The deployment CRM. A table, not PageShell: the work is scanning rows the way an audit log is,
 * and prose width would wrap every contact. Tabs stay on one route so the list stays mounted.
 */
const TABS = [
  { id: "people", label: "People" },
  { id: "companies", label: "Companies" },
  { id: "opportunities", label: "Opportunities" },
  { id: "campaigns", label: "Campaigns" },
  { id: "conversations", label: "Conversations" },
] as const;

type CrmTab = (typeof TABS)[number]["id"];

const crmSearchSchema = z.object({
  tab: z
    .enum([
      "people",
      "companies",
      "opportunities",
      "campaigns",
      "conversations",
    ])
    .optional(),
  id: z.string().optional(),
  new: z.boolean().optional(),
});

export const Route = createFileRoute("/_authed/_app/crm")({
  validateSearch: crmSearchSchema,
  component: CrmPage,
});

function CrmPage() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const tab: CrmTab = search.tab ?? "people";
  const showCreate = search.new === true;
  const selectedId = showCreate ? undefined : search.id;
  const close = () => navigate({ search: { tab } });

  return (
    <DetailPanel
      detail={
        showCreate ? (
          <CreatePane tab={tab} onDone={close} />
        ) : selectedId ? (
          <EditPane tab={tab} id={selectedId} onDone={close} />
        ) : null
      }
      onClose={close}
      open={showCreate || selectedId !== undefined}
      title={
        <span className="truncate text-sm font-medium">
          {showCreate ? createTitle(tab) : "Details"}
        </span>
      }
    >
      <div className="flex h-full min-h-0 flex-col bg-muted/40">
        <header className="shrink-0 border-b border-border bg-background">
          <nav className="flex items-end gap-5 px-5 pt-3">
            {TABS.map((entry) => (
              <Link
                key={entry.id}
                className={cn(
                  "border-b-2 px-0.5 pb-2 text-sm",
                  tab === entry.id
                    ? "border-foreground font-medium text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground",
                )}
                search={{ tab: entry.id }}
                to="/crm"
              >
                {entry.label}
              </Link>
            ))}
          </nav>
        </header>
        {tab === "people" ? (
          <PeoplePane selectedId={selectedId} />
        ) : tab === "companies" ? (
          <CompaniesPane selectedId={selectedId} />
        ) : tab === "opportunities" ? (
          <OpportunitiesPane selectedId={selectedId} />
        ) : tab === "campaigns" ? (
          <CampaignsPane selectedId={selectedId} />
        ) : (
          <ConversationsPane selectedId={selectedId} />
        )}
      </div>
    </DetailPanel>
  );
}

function createTitle(tab: CrmTab) {
  switch (tab) {
    case "people":
      return "New person";
    case "companies":
      return "New company";
    case "opportunities":
      return "New opportunity";
    case "campaigns":
      return "New campaign";
    case "conversations":
      return "New conversation";
  }
}

function CreatePane({ tab, onDone }: { tab: CrmTab; onDone: () => void }) {
  return (
    <div className="flex flex-col gap-4 p-4">
      {tab === "people" ? (
        <PersonForm onDone={onDone} />
      ) : tab === "companies" ? (
        <CompanyForm onDone={onDone} />
      ) : tab === "opportunities" ? (
        <OpportunityForm onDone={onDone} />
      ) : tab === "campaigns" ? (
        <CampaignForm onDone={onDone} />
      ) : (
        <ConversationForm onDone={onDone} />
      )}
    </div>
  );
}

function EditPane({
  tab,
  id,
  onDone,
}: {
  tab: CrmTab;
  id: string;
  onDone: () => void;
}) {
  if (tab === "people") return <PersonEditor id={id} onDone={onDone} />;
  if (tab === "companies") return <CompanyEditor id={id} onDone={onDone} />;
  if (tab === "opportunities")
    return <OpportunityEditor id={id} onDone={onDone} />;
  if (tab === "campaigns") return <CampaignEditor id={id} onDone={onDone} />;
  return <ConversationEditor id={id} onDone={onDone} />;
}

function PersonEditor({ id, onDone }: { id: string; onDone: () => void }) {
  const people = useQuery(crmPeopleQueryOptions());
  const person = people.data?.items.find((entry) => entry.id === id);
  if (people.isPending) return null;
  if (!person) {
    return (
      <p className="text-muted-foreground text-sm">That person is not here.</p>
    );
  }
  return (
    <div className="flex flex-col gap-4 p-4">
      <PersonForm key={person.id} onDone={onDone} person={person} />
    </div>
  );
}

function CompanyEditor({ id, onDone }: { id: string; onDone: () => void }) {
  const companies = useQuery(crmCompaniesQueryOptions());
  const company = companies.data?.items.find((entry) => entry.id === id);
  if (companies.isPending) return null;
  if (!company) {
    return (
      <p className="text-muted-foreground text-sm">That company is not here.</p>
    );
  }
  return (
    <div className="flex flex-col gap-4 p-4">
      <CompanyForm company={company} key={company.id} onDone={onDone} />
    </div>
  );
}

function OpportunityEditor({ id, onDone }: { id: string; onDone: () => void }) {
  const opportunities = useQuery(crmOpportunitiesQueryOptions());
  const opportunity = opportunities.data?.items.find(
    (entry) => entry.id === id,
  );
  if (opportunities.isPending) return null;
  if (!opportunity) {
    return (
      <p className="text-muted-foreground text-sm">
        That opportunity is not here.
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-4 p-4">
      <OpportunityForm
        key={opportunity.id}
        onDone={onDone}
        opportunity={opportunity}
      />
    </div>
  );
}

function CampaignEditor({ id, onDone }: { id: string; onDone: () => void }) {
  const campaigns = useQuery(crmCampaignsQueryOptions());
  const campaign = campaigns.data?.items.find((entry) => entry.id === id);
  if (campaigns.isPending) return null;
  if (!campaign) {
    return (
      <p className="text-muted-foreground text-sm">
        That campaign is not here.
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-4 p-4">
      <CampaignForm campaign={campaign} key={campaign.id} onDone={onDone} />
    </div>
  );
}

function ConversationEditor({
  id,
  onDone,
}: {
  id: string;
  onDone: () => void;
}) {
  const conversations = useQuery(crmConversationsQueryOptions());
  const conversation = conversations.data?.items.find(
    (entry) => entry.id === id,
  );
  if (conversations.isPending) return null;
  if (!conversation) {
    return (
      <p className="text-muted-foreground text-sm">
        That conversation is not here.
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-4 p-4">
      <ConversationForm
        conversation={conversation}
        key={conversation.id}
        onDone={onDone}
      />
    </div>
  );
}

function Toolbar({
  filter,
  action,
}: {
  filter: string;
  action: { label: string; tab: CrmTab };
}) {
  return (
    <div className="flex shrink-0 items-center justify-between gap-3 px-5 py-3">
      <span className="rounded-md border border-border bg-background px-2.5 py-1 text-xs font-medium text-foreground">
        {filter}
      </span>
      <Button
        className="bg-blue-600 text-white hover:bg-blue-700"
        render={(props) => (
          <Link search={{ tab: action.tab, new: true }} to="/crm" {...props} />
        )}
        size="sm"
      >
        <IconPlus />
        {action.label}
      </Button>
    </div>
  );
}

function PeoplePane({ selectedId }: { selectedId?: string }) {
  const people = useQuery(crmPeopleQueryOptions());
  const [checked, setChecked] = useState<Record<string, boolean>>({});

  if (people.isPending) return null;
  if (people.error) {
    return (
      <p className="px-5 py-4 text-destructive text-sm" role="alert">
        Could not load people.
      </p>
    );
  }

  const rows = people.data?.items ?? [];
  const total = people.data?.total ?? 0;
  const allChecked = rows.length > 0 && rows.every((row) => checked[row.id]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Toolbar
        action={{ label: "New Person", tab: "people" }}
        filter={`All People ${total}`}
      />
      {rows.length === 0 ? (
        <div className="px-5 py-8">
          <Empty className="border border-dashed">
            <EmptyHeader>
              <EmptyTitle>No people yet</EmptyTitle>
            </EmptyHeader>
          </Empty>
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto px-5 pb-5">
          <table className="w-full min-w-[860px] border-separate border-spacing-0 overflow-hidden rounded-lg border border-border bg-background text-sm">
            <thead>
              <tr className="bg-muted/50 text-left text-xs text-muted-foreground">
                <th className="w-10 border-b border-border px-3 py-2 font-medium">
                  <input
                    aria-label="Select all people"
                    checked={allChecked}
                    onChange={(event) => {
                      const next = event.target.checked;
                      setChecked(
                        Object.fromEntries(rows.map((row) => [row.id, next])),
                      );
                    }}
                    type="checkbox"
                  />
                </th>
                <th className="border-b border-border px-3 py-2 font-medium">
                  Name
                </th>
                <th className="border-b border-border px-3 py-2 font-medium">
                  Emails
                </th>
                <th className="border-b border-border px-3 py-2 font-medium">
                  Created by
                </th>
                <th className="border-b border-border px-3 py-2 font-medium">
                  Company
                </th>
                <th className="border-b border-border px-3 py-2 font-medium">
                  Phones
                </th>
                <th className="border-b border-border px-3 py-2 font-medium">
                  Created
                </th>
                <th className="border-b border-border px-3 py-2 font-medium">
                  Job title
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((person) => (
                <tr
                  className={cn(
                    "cursor-pointer hover:bg-muted/40",
                    selectedId === person.id && "bg-muted/60",
                  )}
                  key={person.id}
                >
                  <td className="border-b border-border px-3 py-2">
                    <input
                      aria-label={`Select ${person.name}`}
                      checked={checked[person.id] === true}
                      onChange={(event) =>
                        setChecked((current) => ({
                          ...current,
                          [person.id]: event.target.checked,
                        }))
                      }
                      onClick={(event) => event.stopPropagation()}
                      type="checkbox"
                    />
                  </td>
                  <td className="border-b border-border px-3 py-2">
                    <Link
                      className="flex min-w-0 items-center gap-2 font-medium"
                      search={{ tab: "people", id: person.id }}
                      to="/crm"
                    >
                      <AvatarInitials name={person.name} />
                      <span className="truncate">{person.name}</span>
                    </Link>
                  </td>
                  <td className="border-b border-border px-3 py-2 text-muted-foreground">
                    {person.emails.join(", ") || "—"}
                  </td>
                  <td className="border-b border-border px-3 py-2 text-muted-foreground">
                    {createdByLabel(person.createdBy)}
                  </td>
                  <td className="border-b border-border px-3 py-2">
                    {person.company ? (
                      <CompanyMark
                        domain={person.company.domain}
                        name={person.company.name}
                      />
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="border-b border-border px-3 py-2 text-muted-foreground">
                    {person.phones.join(", ") || "—"}
                  </td>
                  <td className="border-b border-border px-3 py-2 text-muted-foreground whitespace-nowrap">
                    {relativeTime(person.createdAt)}
                  </td>
                  <td className="border-b border-border px-3 py-2 text-muted-foreground">
                    {person.jobTitle || "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function CompaniesPane({ selectedId }: { selectedId?: string }) {
  const companies = useQuery(crmCompaniesQueryOptions());
  if (companies.isPending) return null;
  if (companies.error) {
    return (
      <p className="px-5 py-4 text-destructive text-sm" role="alert">
        Could not load companies.
      </p>
    );
  }
  const rows = companies.data?.items ?? [];
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Toolbar
        action={{ label: "New Company", tab: "companies" }}
        filter={`All Companies ${companies.data?.total ?? 0}`}
      />
      {rows.length === 0 ? (
        <div className="px-5 py-8">
          <Empty className="border border-dashed">
            <EmptyHeader>
              <EmptyTitle>No companies yet</EmptyTitle>
            </EmptyHeader>
          </Empty>
        </div>
      ) : (
        <SimpleTable>
          <thead>
            <tr className="bg-muted/50 text-left text-xs text-muted-foreground">
              <th className="border-b border-border px-3 py-2 font-medium">
                Name
              </th>
              <th className="border-b border-border px-3 py-2 font-medium">
                Domain
              </th>
              <th className="border-b border-border px-3 py-2 font-medium">
                Industry
              </th>
              <th className="border-b border-border px-3 py-2 font-medium">
                Created by
              </th>
              <th className="border-b border-border px-3 py-2 font-medium">
                Created
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((company) => (
              <tr
                className={cn(
                  "hover:bg-muted/40",
                  selectedId === company.id && "bg-muted/60",
                )}
                key={company.id}
              >
                <td className="border-b border-border px-3 py-2">
                  <Link
                    className="font-medium"
                    search={{ tab: "companies", id: company.id }}
                    to="/crm"
                  >
                    <CompanyMark domain={company.domain} name={company.name} />
                  </Link>
                </td>
                <td className="border-b border-border px-3 py-2 text-muted-foreground">
                  {company.domain || "—"}
                </td>
                <td className="border-b border-border px-3 py-2 text-muted-foreground">
                  {company.industry || "—"}
                </td>
                <td className="border-b border-border px-3 py-2 text-muted-foreground">
                  {createdByLabel(company.createdBy)}
                </td>
                <td className="border-b border-border px-3 py-2 text-muted-foreground whitespace-nowrap">
                  {relativeTime(company.createdAt)}
                </td>
              </tr>
            ))}
          </tbody>
        </SimpleTable>
      )}
    </div>
  );
}

function OpportunitiesPane({ selectedId }: { selectedId?: string }) {
  const opportunities = useQuery(crmOpportunitiesQueryOptions());
  if (opportunities.isPending) return null;
  if (opportunities.error) {
    return (
      <p className="px-5 py-4 text-destructive text-sm" role="alert">
        Could not load opportunities.
      </p>
    );
  }
  const rows = opportunities.data?.items ?? [];
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Toolbar
        action={{ label: "New Opportunity", tab: "opportunities" }}
        filter={`All Opportunities ${opportunities.data?.total ?? 0}`}
      />
      {rows.length === 0 ? (
        <div className="px-5 py-8">
          <Empty className="border border-dashed">
            <EmptyHeader>
              <EmptyTitle>No opportunities yet</EmptyTitle>
            </EmptyHeader>
          </Empty>
        </div>
      ) : (
        <SimpleTable>
          <thead>
            <tr className="bg-muted/50 text-left text-xs text-muted-foreground">
              <th className="border-b border-border px-3 py-2 font-medium">
                Name
              </th>
              <th className="border-b border-border px-3 py-2 font-medium">
                Stage
              </th>
              <th className="border-b border-border px-3 py-2 font-medium">
                Company
              </th>
              <th className="border-b border-border px-3 py-2 font-medium">
                Person
              </th>
              <th className="border-b border-border px-3 py-2 font-medium">
                Amount
              </th>
              <th className="border-b border-border px-3 py-2 font-medium">
                Created
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((opportunity) => (
              <tr
                className={cn(
                  "hover:bg-muted/40",
                  selectedId === opportunity.id && "bg-muted/60",
                )}
                key={opportunity.id}
              >
                <td className="border-b border-border px-3 py-2">
                  <Link
                    className="font-medium"
                    search={{ tab: "opportunities", id: opportunity.id }}
                    to="/crm"
                  >
                    {opportunity.name}
                  </Link>
                </td>
                <td className="border-b border-border px-3 py-2 capitalize text-muted-foreground">
                  {opportunity.stage}
                </td>
                <td className="border-b border-border px-3 py-2 text-muted-foreground">
                  {opportunity.company?.name || "—"}
                </td>
                <td className="border-b border-border px-3 py-2 text-muted-foreground">
                  {opportunity.person?.name || "—"}
                </td>
                <td className="border-b border-border px-3 py-2 text-muted-foreground">
                  {opportunity.amountCents === null
                    ? "—"
                    : `${opportunity.currency} ${(opportunity.amountCents / 100).toLocaleString()}`}
                </td>
                <td className="border-b border-border px-3 py-2 text-muted-foreground whitespace-nowrap">
                  {relativeTime(opportunity.createdAt)}
                </td>
              </tr>
            ))}
          </tbody>
        </SimpleTable>
      )}
    </div>
  );
}

function CampaignsPane({ selectedId }: { selectedId?: string }) {
  const campaigns = useQuery(crmCampaignsQueryOptions());
  if (campaigns.isPending) return null;
  if (campaigns.error) {
    return (
      <p className="px-5 py-4 text-destructive text-sm" role="alert">
        Could not load campaigns.
      </p>
    );
  }
  const rows = campaigns.data?.items ?? [];
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Toolbar
        action={{ label: "New Campaign", tab: "campaigns" }}
        filter={`All Campaigns ${campaigns.data?.total ?? 0}`}
      />
      {rows.length === 0 ? (
        <div className="px-5 py-8">
          <Empty className="border border-dashed">
            <EmptyHeader>
              <EmptyTitle>No campaigns yet</EmptyTitle>
            </EmptyHeader>
          </Empty>
        </div>
      ) : (
        <SimpleTable>
          <thead>
            <tr className="bg-muted/50 text-left text-xs text-muted-foreground">
              <th className="border-b border-border px-3 py-2 font-medium">
                Name
              </th>
              <th className="border-b border-border px-3 py-2 font-medium">
                Status
              </th>
              <th className="border-b border-border px-3 py-2 font-medium">
                Description
              </th>
              <th className="border-b border-border px-3 py-2 font-medium">
                Created by
              </th>
              <th className="border-b border-border px-3 py-2 font-medium">
                Created
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((campaign) => (
              <tr
                className={cn(
                  "hover:bg-muted/40",
                  selectedId === campaign.id && "bg-muted/60",
                )}
                key={campaign.id}
              >
                <td className="border-b border-border px-3 py-2">
                  <Link
                    className="font-medium"
                    search={{ tab: "campaigns", id: campaign.id }}
                    to="/crm"
                  >
                    {campaign.name}
                  </Link>
                </td>
                <td className="border-b border-border px-3 py-2 capitalize text-muted-foreground">
                  {campaign.status}
                </td>
                <td className="border-b border-border px-3 py-2 text-muted-foreground">
                  {campaign.description || "—"}
                </td>
                <td className="border-b border-border px-3 py-2 text-muted-foreground">
                  {createdByLabel(campaign.createdBy)}
                </td>
                <td className="border-b border-border px-3 py-2 text-muted-foreground whitespace-nowrap">
                  {relativeTime(campaign.createdAt)}
                </td>
              </tr>
            ))}
          </tbody>
        </SimpleTable>
      )}
    </div>
  );
}

function ConversationsPane({ selectedId }: { selectedId?: string }) {
  const conversations = useQuery(crmConversationsQueryOptions());
  if (conversations.isPending) return null;
  if (conversations.error) {
    return (
      <p className="px-5 py-4 text-destructive text-sm" role="alert">
        Could not load conversations.
      </p>
    );
  }
  const rows = conversations.data?.items ?? [];
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Toolbar
        action={{ label: "New Conversation", tab: "conversations" }}
        filter={`All Conversations ${conversations.data?.total ?? 0}`}
      />
      {rows.length === 0 ? (
        <div className="px-5 py-8">
          <Empty className="border border-dashed">
            <EmptyHeader>
              <EmptyTitle>No conversations yet</EmptyTitle>
            </EmptyHeader>
          </Empty>
        </div>
      ) : (
        <SimpleTable>
          <thead>
            <tr className="bg-muted/50 text-left text-xs text-muted-foreground">
              <th className="border-b border-border px-3 py-2 font-medium">
                Subject
              </th>
              <th className="border-b border-border px-3 py-2 font-medium">
                Channel
              </th>
              <th className="border-b border-border px-3 py-2 font-medium">
                Person
              </th>
              <th className="border-b border-border px-3 py-2 font-medium">
                Company
              </th>
              <th className="border-b border-border px-3 py-2 font-medium">
                When
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((conversation) => (
              <tr
                className={cn(
                  "hover:bg-muted/40",
                  selectedId === conversation.id && "bg-muted/60",
                )}
                key={conversation.id}
              >
                <td className="border-b border-border px-3 py-2">
                  <Link
                    className="font-medium"
                    search={{ tab: "conversations", id: conversation.id }}
                    to="/crm"
                  >
                    {conversation.subject}
                  </Link>
                </td>
                <td className="border-b border-border px-3 py-2 capitalize text-muted-foreground">
                  {conversation.channel}
                </td>
                <td className="border-b border-border px-3 py-2 text-muted-foreground">
                  {conversation.person?.name || "—"}
                </td>
                <td className="border-b border-border px-3 py-2 text-muted-foreground">
                  {conversation.company?.name || "—"}
                </td>
                <td className="border-b border-border px-3 py-2 text-muted-foreground whitespace-nowrap">
                  {relativeTime(conversation.occurredAt)}
                </td>
              </tr>
            ))}
          </tbody>
        </SimpleTable>
      )}
    </div>
  );
}

function SimpleTable({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-0 flex-1 overflow-auto px-5 pb-5">
      <table className="w-full min-w-[720px] border-separate border-spacing-0 overflow-hidden rounded-lg border border-border bg-background text-sm">
        {children}
      </table>
    </div>
  );
}
