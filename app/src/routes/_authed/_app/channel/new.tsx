import type { Message } from "@ag-ui/core";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { toAgentOptions } from "@/components/channels/composer";
import { ConversationView } from "@/components/channels/conversation-view";
import { seedMessage } from "@/components/channels/transcript-messages";
import { agentListQueryOptions } from "@/lib/agents/queries";
import { useStartChannel } from "@/lib/channels/start";
import { appConfig } from "@/lib/generated/application-config";
import { coworkerDisplayName, pickOrchestrator } from "@/lib/orchestrator";
import { useSkillCommands } from "@/lib/plugins/skill-commands";
import { newId } from "../../../../lib/new-id";

/**
 * First-run never tours the roster. A goal always starts with LimitlessAI.
 * `?agent=` is ignored so a profile link cannot reopen the recipient picker.
 */
export const Route = createFileRoute("/_authed/_app/channel/new")({
  validateSearch: (search: Record<string, unknown>): { agent?: string } => ({
    ...(typeof search.agent === "string" ? { agent: search.agent } : {}),
  }),
  component: RouteComponent,
});

function RouteComponent() {
  const { start, pending } = useStartChannel();
  const { data: profiles } = useQuery(agentListQueryOptions());
  const orchestrator = pickOrchestrator(profiles);
  const productName = appConfig.brand.productName;
  const mentionAgents = orchestrator
    ? toAgentOptions([
        {
          ...orchestrator,
          name: coworkerDisplayName(orchestrator, productName),
        },
      ])
    : [];

  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<Message | null>(null);
  const speakingId = orchestrator?.id ?? "";
  const skillCommands = useSkillCommands(speakingId);

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-12 items-center border-b border-border px-3">
        <span className="text-sm tracking-tight">{productName}</span>
      </div>
      <ConversationView
        agents={mentionAgents}
        commands={skillCommands}
        disabled={!orchestrator}
        messages={sent ? [sent] : []}
        notice={
          error ? (
            <p className="pb-2 text-sm text-destructive" role="alert">
              {error}
            </p>
          ) : null
        }
        onSubmit={async (submitted) => {
          if (!orchestrator || !submitted.text.trim()) return;

          setError(null);
          setSent(seedMessage(submitted.text, newId()));

          try {
            await start([orchestrator.id], submitted.text, orchestrator.id);
          } catch (caught) {
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
