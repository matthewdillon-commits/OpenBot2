import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { campaignStatusStyle, stageLabel, stageStyle } from "@/lib/crm/colors";
import {
  createCrmCampaignMutationOptions,
  updateCrmCampaignMutationOptions,
} from "@/lib/crm/mutations";
import {
  crmCampaignsQueryOptions,
  crmPeopleQueryOptions,
  crmSendsQueryOptions,
} from "@/lib/crm/queries";
import { cn } from "@/lib/utils";
import { queryClient } from "@/query-client";

export function CampaignsPanel({
  onSelectContact,
}: {
  onSelectContact?: (contactId: string) => void;
}) {
  const campaignsQuery = useQuery(crmCampaignsQueryOptions());
  const peopleQuery = useQuery(crmPeopleQueryOptions());
  const createCampaign = useMutation(createCrmCampaignMutationOptions(queryClient));
  const updateCampaign = useMutation(updateCrmCampaignMutationOptions(queryClient));
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [newGoal, setNewGoal] = useState("");

  const campaigns = campaignsQuery.data?.items ?? [];
  const selected = campaigns.find((campaign) => campaign.id === selectedId) || null;
  const sends = useQuery({
    ...crmSendsQueryOptions("", "", "", selected?.id ?? ""),
    enabled: Boolean(selected?.id),
  });

  const memberIds = new Set(
    (sends.data?.items ?? [])
      .map((send) => send.personId)
      .filter((id): id is string => Boolean(id)),
  );
  const members = (peopleQuery.data?.items ?? []).filter((person) =>
    memberIds.has(person.id),
  );

  async function saveCampaign() {
    if (!newName.trim()) return;
    try {
      const campaign = await createCampaign.mutateAsync({
        name: newName.trim(),
        description: newGoal.trim() || null,
        status: "active",
      });
      setNewName("");
      setNewGoal("");
      setSelectedId(campaign.id);
      toast.success("Campaign created");
    } catch {
      toast.error("Couldn’t create campaign");
    }
  }

  return (
    <div className="ui-crm-panes flex min-h-0 flex-1">
      <div className="ui-crm-pane-fixed flex w-[260px] shrink-0 flex-col bg-[var(--bg-solid)] shadow-[inset_-1px_0_0_var(--hairline)]">
        <div className="px-3 py-3 shadow-[inset_0_-1px_0_var(--hairline)]">
          <div className="text-13 font-medium tracking-[-0.01em] text-[var(--text)]">
            Start a campaign
          </div>
          <p className="mt-0.5 text-12 text-[var(--text-muted)] text-pretty">
            Group people into lists your agents can work.
          </p>
          <input
            value={newName}
            onChange={(event) => setNewName(event.target.value)}
            placeholder="Campaign name"
            className="ui-field mt-3 h-9 min-h-9 w-full !rounded-[var(--radius-control)] text-13"
          />
          <input
            value={newGoal}
            onChange={(event) => setNewGoal(event.target.value)}
            placeholder="What success looks like (optional)"
            className="ui-field mt-2 h-9 min-h-9 w-full !rounded-[var(--radius-control)] text-13"
          />
          <button
            type="button"
            disabled={createCampaign.isPending || !newName.trim()}
            onClick={() => void saveCampaign()}
            className="ui-cta mt-3 !min-h-9 w-full text-12"
          >
            {createCampaign.isPending ? "Creating…" : "Create campaign"}
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
          {campaignsQuery.isPending ? null : campaigns.length === 0 ? (
            <p className="px-2.5 py-3 text-13 text-[var(--text-muted)] text-pretty">
              No campaigns yet. Create one above to organize outreach.
            </p>
          ) : (
            campaigns.map((campaign) => {
              const status = campaignStatusStyle(campaign.status);
              return (
                <button
                  key={campaign.id}
                  type="button"
                  onClick={() => setSelectedId(campaign.id)}
                  className={cn(
                    "flex w-full flex-col rounded-[var(--radius-control)] px-2.5 py-2 text-left transition-[background-color] duration-[var(--duration-quick)] ease-[var(--ease-apple)]",
                    selectedId === campaign.id
                      ? "bg-[var(--bg-muted)]"
                      : "hover:bg-[var(--bg-hover)]",
                  )}
                >
                  <span className="text-13 font-medium tracking-[-0.01em] text-[var(--text)]">
                    {campaign.name}
                  </span>
                  <span
                    className="mt-1 w-fit rounded-[6px] px-1.5 py-0.5 text-[11px] font-medium"
                    style={{ color: status.fg, background: status.bg }}
                  >
                    {status.label}
                  </span>
                </button>
              );
            })
          )}
        </div>
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        {!selected ? (
          <div className="ui-prose p-6">
            <p className="text-14 font-medium text-[var(--text)]">
              Pick a campaign
            </p>
            <p className="mt-1 text-13 text-[var(--text-muted)]">
              Manage lists and members here. Agents add people; you decide when
              emails go out.
            </p>
          </div>
        ) : (
          <>
            <div className="px-4 py-3 shadow-[inset_0_-1px_0_var(--hairline)]">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-14 font-medium tracking-[-0.01em] text-[var(--text)]">
                      {selected.name}
                    </h3>
                    <span
                      className="rounded-[6px] px-1.5 py-0.5 text-[11px] font-medium"
                      style={{
                        color: campaignStatusStyle(selected.status).fg,
                        background: campaignStatusStyle(selected.status).bg,
                      }}
                    >
                      {campaignStatusStyle(selected.status).label}
                    </span>
                  </div>
                  <p className="mt-0.5 text-13 text-[var(--text-secondary)] text-pretty">
                    {selected.description || selected.notes || "No goal set yet"}
                  </p>
                </div>
                <label className="shrink-0">
                  <span className="sr-only">Campaign status</span>
                  <select
                    value={selected.status}
                    onChange={(event) => {
                      void updateCampaign
                        .mutateAsync({
                          id: selected.id,
                          input: { status: event.target.value },
                        })
                        .catch(() => toast.error("Couldn’t update status"));
                    }}
                    className="ui-crm-select"
                  >
                    {(
                      [
                        ["draft", "Draft"],
                        ["active", "Active"],
                        ["paused", "Paused"],
                        ["archived", "Archived"],
                      ] as const
                    ).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </div>

            <div className="ui-crm-panes flex min-h-0 flex-1">
              <div className="ui-crm-pane-fixed flex w-[200px] shrink-0 flex-col shadow-[inset_-1px_0_0_var(--hairline)]">
                <div className="ui-label px-3 py-2">Lists</div>
                <div className="min-h-0 flex-1 overflow-y-auto px-1">
                  <button
                    type="button"
                    className="flex w-full items-center justify-between rounded-[var(--radius-control)] bg-[var(--bg-muted)] px-2.5 py-2 text-left text-13 font-medium"
                  >
                    <span className="truncate text-[var(--text)]">Audience</span>
                    <span className="tabular text-12 text-[var(--text-muted)]">
                      {members.length}
                    </span>
                  </button>
                </div>
              </div>

              <div className="min-w-0 flex-1 overflow-auto">
                <div className="flex items-center justify-between px-4 py-2.5 text-12 text-[var(--text-muted)]">
                  <span>Members</span>
                  <span className="tabular">{members.length}</span>
                </div>
                {members.length === 0 ? (
                  <p className="px-4 py-3 text-13 text-[var(--text-muted)] text-pretty">
                    No members yet. Ask an agent to research people into this
                    list, or add contacts from the board.
                  </p>
                ) : (
                  <table className="w-full text-left text-13">
                    <thead className="sticky top-0 bg-[var(--bg)] text-12 text-[var(--text-muted)]">
                      <tr className="border-b border-[var(--border)]">
                        <th className="px-4 py-2 font-medium">Name</th>
                        <th className="px-4 py-2 font-medium">Company</th>
                        <th className="px-4 py-2 font-medium">Stage</th>
                      </tr>
                    </thead>
                    <tbody>
                      {members.map((person) => {
                        const stage = stageStyle(person.stageKey);
                        return (
                          <tr
                            key={person.id}
                            className="border-b border-[var(--border)]"
                          >
                            <td className="px-4 py-2">
                              <button
                                type="button"
                                onClick={() => onSelectContact?.(person.id)}
                                className="font-medium text-[var(--text)] hover:underline"
                              >
                                {person.name}
                              </button>
                            </td>
                            <td className="px-4 py-2 text-[var(--text-secondary)]">
                              {person.company?.name || "—"}
                            </td>
                            <td className="px-4 py-2">
                              <span className="inline-flex items-center gap-1.5 text-12 text-[var(--text-secondary)]">
                                <span
                                  className="h-2 w-2 rounded-full"
                                  style={{ background: stage.solid }}
                                  aria-hidden
                                />
                                {stageLabel(person.stageKey)}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
