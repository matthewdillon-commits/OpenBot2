import type { Message } from "@ag-ui/core";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { canSend, type Recipient } from "@/components/channels/compose-state";
import {
  type ComposerDraft,
  toAgentOptions,
} from "@/components/channels/composer";
import { ConversationView } from "@/components/channels/conversation-view";
import { RecipientField } from "@/components/channels/recipient-field";
import { resolveSpeaker } from "@/components/channels/speaker";
import { seedMessage } from "@/components/channels/transcript-messages";
import { agentListQueryOptions, agentQueryOptions } from "@/lib/agents/queries";
import { useStartChannel } from "@/lib/channels/start";
import { useSkillCommands } from "@/lib/plugins/skill-commands";
import { newId } from "../../../../lib/new-id";

/**
 * Creates the channel on first send. `?agent=` seeds one coworker from a profile link; extra
 * picks live in this screen's state so a room can start without an invite API.
 */
export const Route = createFileRoute("/_authed/_app/channel/new")({
  validateSearch: (search: Record<string, unknown>): { agent?: string } => ({
    ...(typeof search.agent === "string" ? { agent: search.agent } : {}),
  }),
  component: RouteComponent,
});

function RouteComponent() {
  const { agent } = Route.useSearch();
  const { start, pending } = useStartChannel();
  const { data: profiles } = useQuery(agentListQueryOptions());

  const [error, setError] = useState<string | null>(null);
  // Optimistic seed shown before the first channel record exists.
  const [sent, setSent] = useState<Message | null>(null);
  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [channelName, setChannelName] = useState("");
  const [draft, setDraft] = useState<ComposerDraft | null>(null);
  const seededFromUrl = useRef<string | null>(null);

  // Stale or private `?agent=` values are ignored because the roster is permission-filtered.
  const listed = profiles?.find((profile) => profile.id === agent);
  /**
   * Hidden coworkers are omitted from the roster but may still be valid recipients from a profile
   * link, so fetch the URL-selected coworker when it is absent from the visible list.
   */
  const { data: fetched } = useQuery({
    ...agentQueryOptions(agent ?? ""),
    enabled: Boolean(agent) && !listed,
    retry: false,
  });
  const chosen = listed ?? (fetched?.id === agent ? fetched : undefined);

  useEffect(() => {
    if (!chosen || seededFromUrl.current === chosen.id) return;
    seededFromUrl.current = chosen.id;
    setRecipients((current) => {
      if (current.some((recipient) => recipient.id === chosen.id)) {
        return current;
      }
      return [{ id: chosen.id, name: chosen.name }, ...current];
    });
  }, [chosen]);

  const memberIds = recipients.map((recipient) => recipient.id);
  const speakingId =
    resolveSpeaker(memberIds, draft?.agentId) ?? memberIds[0] ?? "";
  const skillCommands = useSkillCommands(speakingId);

  return (
    <div className="flex h-full flex-col">
      <RecipientField onChange={setRecipients} recipients={recipients} />
      {recipients.length >= 2 ? (
        <div className="border-b border-border px-4 py-2">
          <div className="mx-auto flex w-full max-w-2xl items-center gap-2">
            <span className="text-sm text-muted-foreground">Name:</span>
            <input
              aria-label="Channel name"
              className="h-8 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
              onChange={(event) => setChannelName(event.target.value)}
              placeholder="Optional room name"
              value={channelName}
            />
          </div>
        </div>
      ) : null}
      <ConversationView
        agents={toAgentOptions(profiles)}
        // Commands must be loaded before the first channel message is sent.
        // Skills of who will speak — the lead, or a mentioned recipient — not a union of everyone.
        commands={skillCommands}
        disabled={recipients.length === 0}
        messages={sent ? [sent] : []}
        notice={
          error ? (
            <p className="pb-2 text-sm text-destructive" role="alert">
              {error}
            </p>
          ) : null
        }
        onDraftChange={setDraft}
        onSubmit={async (submitted) => {
          if (!canSend(recipients, submitted.text)) return;

          const speakerId =
            resolveSpeaker(memberIds, submitted.agentId) ??
            memberIds[0] ??
            null;

          setError(null);
          setSent(seedMessage(submitted.text, newId()));

          try {
            await start(
              memberIds,
              submitted.text,
              speakerId,
              channelName.trim() || undefined,
            );
          } catch (caught) {
            // Preserve the unsent draft when channel creation fails.
            setSent(null);
            setError(
              caught instanceof Error
                ? caught.message
                : "Could not start the conversation.",
            );
            throw caught;
          }
        }}
        pending={pending}
      />
    </div>
  );
}
