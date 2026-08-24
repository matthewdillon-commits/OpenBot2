import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { CrmError, crmControlClassName } from "@/components/crm/crm-ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { campaignStatusStyle, stageLabel, stageStyle } from "@/lib/crm/colors";
import {
  createCrmCampaignListMutationOptions,
  createCrmCampaignMutationOptions,
  removeCrmListMembersMutationOptions,
  updateCrmCampaignMutationOptions,
} from "@/lib/crm/mutations";
import {
  crmCampaignListMembersQueryOptions,
  crmCampaignListsQueryOptions,
  crmCampaignsQueryOptions,
} from "@/lib/crm/queries";
import { cn } from "@/lib/utils";
import { queryClient } from "@/query-client";

export function CampaignsPanel({
  onSelectContact,
}: {
  onSelectContact?: (contactId: string) => void;
}) {
  const campaignsQuery = useQuery(crmCampaignsQueryOptions());
  const createCampaign = useMutation(
    createCrmCampaignMutationOptions(queryClient),
  );
  const updateCampaign = useMutation(
    updateCrmCampaignMutationOptions(queryClient),
  );
  const createList = useMutation(
    createCrmCampaignListMutationOptions(queryClient),
  );
  const removeMembers = useMutation(
    removeCrmListMembersMutationOptions(queryClient),
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedListId, setSelectedListId] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [newListName, setNewListName] = useState("");

  const campaigns = campaignsQuery.data?.items ?? [];
  const selected =
    campaigns.find((campaign) => campaign.id === selectedId) || null;
  const listsQuery = useQuery({
    ...crmCampaignListsQueryOptions(selected?.id ?? ""),
    enabled: Boolean(selected?.id),
  });
  const lists = listsQuery.data ?? [];
  const membersQuery = useQuery({
    ...crmCampaignListMembersQueryOptions(selectedListId ?? ""),
    enabled: Boolean(selectedListId),
  });
  const members = membersQuery.data?.items ?? [];
  const memberTotal = membersQuery.data?.total ?? 0;

  useEffect(() => {
    if (!selectedId) {
      setSelectedListId(null);
      return;
    }
    if (selectedListId && lists.some((list) => list.id === selectedListId)) {
      return;
    }
    setSelectedListId(lists[0]?.id ?? null);
  }, [lists, selectedId, selectedListId]);

  async function saveCampaign(event: FormEvent) {
    event.preventDefault();
    if (!newName.trim()) return;
    try {
      const campaign = await createCampaign.mutateAsync({
        name: newName.trim(),
        status: "active",
      });
      setNewName("");
      setSelectedId(campaign.id);
      toast.success("Campaign created");
    } catch {
      toast.error("Couldn’t create campaign");
    }
  }

  async function addList() {
    if (!selectedId || !newListName.trim()) return;
    try {
      const list = await createList.mutateAsync({
        campaignId: selectedId,
        name: newListName.trim(),
      });
      setNewListName("");
      setSelectedListId(list.id);
      toast.success("List created");
    } catch {
      toast.error("Couldn’t create list");
    }
  }

  async function removeMember(personId: string) {
    if (!selectedListId) return;
    try {
      await removeMembers.mutateAsync({
        listId: selectedListId,
        personIds: [personId],
      });
    } catch {
      toast.error("Couldn’t remove contact");
    }
  }

  if (campaignsQuery.isPending) return null;
  if (campaignsQuery.error) {
    return (
      <CrmError
        label="campaigns"
        error={campaignsQuery.error.message}
        onRetry={() => void campaignsQuery.refetch()}
      />
    );
  }

  return (
    <div className="flex min-h-0 flex-1">
      <div className="flex w-64 shrink-0 flex-col border-e border-border">
        <form
          className="flex flex-col gap-2 border-b border-border p-4"
          onSubmit={(event) => void saveCampaign(event)}
        >
          <Input
            value={newName}
            onChange={(event) => setNewName(event.target.value)}
            placeholder="Campaign name"
            aria-label="Campaign name"
          />
          <Button
            disabled={createCampaign.isPending || !newName.trim()}
            size="sm"
            type="submit"
          >
            {createCampaign.isPending ? "Creating…" : "Create"}
          </Button>
        </form>
        <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
          {campaigns.length === 0 ? (
            <p className="text-pretty px-2.5 py-3 text-muted-foreground text-sm">
              No campaigns yet.
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
                    "flex w-full flex-col rounded-lg px-2.5 py-2 text-left",
                    "focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
                    selectedId === campaign.id
                      ? "bg-muted"
                      : "hover:bg-muted/60",
                  )}
                >
                  <span className="text-sm font-medium">{campaign.name}</span>
                  <span className="mt-1 text-xs text-muted-foreground">
                    <span
                      aria-hidden
                      className="me-1.5 inline-block size-1.5 rounded-full align-middle"
                      style={{ background: status.fg }}
                    />
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
          <p className="p-6 text-muted-foreground text-sm">Select a campaign</p>
        ) : (
          <>
            <div className="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
              <div className="min-w-0">
                <h3 className="font-bold text-sm tracking-tight text-balance">
                  {selected.name}
                </h3>
                {selected.description || selected.notes ? (
                  <p className="mt-0.5 text-pretty text-muted-foreground text-sm">
                    {selected.description || selected.notes}
                  </p>
                ) : null}
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
                  className={cn(crmControlClassName, "w-auto")}
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

            <div className="flex min-h-0 flex-1">
              <div className="flex w-48 shrink-0 flex-col border-e border-border">
                <p className="px-3 py-2 text-xs font-medium text-muted-foreground">
                  Lists
                </p>
                <div className="min-h-0 flex-1 overflow-y-auto px-1">
                  {lists.map((list) => (
                    <button
                      key={list.id}
                      type="button"
                      onClick={() => setSelectedListId(list.id)}
                      className={cn(
                        "flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-left text-sm",
                        "focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
                        selectedListId === list.id
                          ? "bg-muted font-medium"
                          : "hover:bg-muted/60",
                      )}
                    >
                      <span className="truncate">{list.name}</span>
                      <span className="tabular-nums text-muted-foreground text-xs">
                        {list.memberCount}
                      </span>
                    </button>
                  ))}
                </div>
                <form
                  className="border-t border-border p-2"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void addList();
                  }}
                >
                  <Input
                    value={newListName}
                    onChange={(event) => setNewListName(event.target.value)}
                    placeholder="New list name"
                    aria-label="New list name"
                  />
                  <Button
                    className="mt-1.5 w-full"
                    disabled={!newListName.trim() || createList.isPending}
                    size="sm"
                    type="submit"
                    variant="outline"
                  >
                    Add list
                  </Button>
                </form>
              </div>

              <div className="min-w-0 flex-1 overflow-auto">
                <div className="flex items-center justify-between px-4 py-2.5 text-muted-foreground text-xs">
                  <span>Members</span>
                  <span className="tabular-nums">{memberTotal}</span>
                </div>
                {members.length === 0 ? (
                  <p className="px-4 py-3 text-muted-foreground text-sm">
                    No members
                  </p>
                ) : (
                  <table className="crm-table">
                    <thead>
                      <tr>
                        <th>Name</th>
                        <th>Company</th>
                        <th>Stage</th>
                        <th>
                          <span className="sr-only">Actions</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {members.map((person) => {
                        const stage = stageStyle(person.stageKey);
                        return (
                          <tr key={person.id} className="cursor-default">
                            <td>
                              <button
                                type="button"
                                onClick={() => onSelectContact?.(person.id)}
                                className="font-medium underline-offset-4 hover:underline"
                              >
                                {person.name}
                              </button>
                            </td>
                            <td className="text-muted-foreground">
                              {person.company?.name || "—"}
                            </td>
                            <td>
                              <span className="inline-flex items-center gap-1.5 text-sm">
                                <span
                                  className="size-1.5 rounded-full"
                                  style={{ background: stage.solid }}
                                  aria-hidden
                                />
                                {stageLabel(person.stageKey)}
                              </span>
                            </td>
                            <td className="text-end">
                              <Button
                                onClick={() => void removeMember(person.id)}
                                size="sm"
                                variant="ghost"
                              >
                                Remove
                              </Button>
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
