import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { ChannelAvatar } from "@/components/channels/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { agentListQueryOptions } from "@/lib/agents/queries";
import { updateChannelMutationOptions } from "@/lib/channels/mutations";
import type { AgentChannel } from "@/lib/channels/queries";
import { queryClient } from "@/query-client";

/**
 * Rename a room and add or remove coworkers.
 *
 * Lives in the existing settings pane rather than a new screen. A channel already lists who
 * is in it; this is the write half of that fact.
 */
export function ChannelMembers({ channel }: { channel: AgentChannel }) {
  const { data: profiles } = useQuery(agentListQueryOptions());
  const update = useMutation(updateChannelMutationOptions(queryClient));
  const [name, setName] = useState(channel.name);
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setName(channel.name);
  }, [channel.name]);

  const members = (profiles ?? []).filter((profile) =>
    channel.agentIds.includes(profile.id),
  );
  const chosen = new Set(channel.agentIds);
  const matches = (profiles ?? [])
    .filter((profile) => !chosen.has(profile.id))
    .filter((profile) =>
      profile.name.toLowerCase().includes(search.trim().toLowerCase()),
    );

  const saveName = async () => {
    const trimmed = name.trim();
    if (!trimmed || trimmed === channel.name) return;
    setError(null);
    try {
      await update.mutateAsync({ channelId: channel.id, name: trimmed });
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Could not rename the channel.",
      );
    }
  };

  return (
    <div className="flex flex-col gap-4 px-4 pb-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="channel-name">Channel name</Label>
        <div className="flex gap-2">
          <Input
            id="channel-name"
            onBlur={() => void saveName()}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void saveName();
              }
            }}
            value={name}
          />
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <p className="text-sm font-medium">Coworkers</p>
        <ul className="flex flex-col gap-1">
          {members.map((member) => (
            <li
              className="flex items-center justify-between gap-2 rounded-md px-1 py-1"
              key={member.id}
            >
              <span className="flex min-w-0 items-center gap-2 text-sm">
                <ChannelAvatar participantIds={[member.id]} size={18} />
                <span className="truncate">{member.name}</span>
              </span>
              {channel.kind !== "direct" && channel.agentIds.length > 1 ? (
                <Button
                  disabled={update.isPending}
                  onClick={() => {
                    setError(null);
                    void update
                      .mutateAsync({
                        channelId: channel.id,
                        removeAgentIds: [member.id],
                      })
                      .catch((caught) => {
                        setError(
                          caught instanceof Error
                            ? caught.message
                            : "Could not remove that coworker.",
                        );
                      });
                  }}
                  size="xs"
                  variant="ghost"
                >
                  Remove
                </Button>
              ) : null}
            </li>
          ))}
        </ul>

        {channel.kind === "direct" || channel.agentIds.length >= 8 ? null : (
          <div className="flex flex-col gap-1">
            <Input
              aria-label="Add a coworker"
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Add a coworker…"
              value={search}
            />
            {search.trim().length === 0 ? null : (
              <ul>
                {matches.map((profile) => (
                  <li key={profile.id}>
                    <button
                      className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent"
                      onClick={() => {
                        setSearch("");
                        setError(null);
                        void update
                          .mutateAsync({
                            channelId: channel.id,
                            addAgentIds: [profile.id],
                          })
                          .catch((caught) => {
                            setError(
                              caught instanceof Error
                                ? caught.message
                                : "Could not add that coworker.",
                            );
                          });
                      }}
                      type="button"
                    >
                      <ChannelAvatar participantIds={[profile.id]} size={18} />
                      <span>{profile.name}</span>
                    </button>
                  </li>
                ))}
                {matches.length === 0 ? (
                  <li className="px-2 py-1.5 text-sm text-muted-foreground">
                    No coworker by that name.
                  </li>
                ) : null}
              </ul>
            )}
          </div>
        )}
      </div>

      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
