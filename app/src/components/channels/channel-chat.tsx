import type { Message } from "@ag-ui/core";
import {
  UseAgentUpdate,
  useAgent,
  useCopilotKit,
} from "@copilotkit/react-core/v2";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  type ComposerDraft,
  toAgentOptions,
} from "@/components/channels/composer";
import { ConversationView } from "@/components/channels/conversation-view";
import { resolveSpeaker } from "@/components/channels/speaker";
import {
  seedMessage,
  takeFirstMessage,
  transcriptMessages,
  withOutgoingEcho,
} from "@/components/channels/transcript-messages";
import { agentListQueryOptions } from "@/lib/agents/queries";
import { currentUserQueryOptions } from "@/lib/auth/queries";
import { recordChannelActivityMutationOptions } from "@/lib/channels/mutations";
import type { AgentChannel } from "@/lib/channels/queries";
import { useActiveBot } from "@/lib/copilot/active-bot";
import { ConversationProvider } from "@/lib/copilot/conversation";
import { repairUnansweredToolCalls } from "@/lib/copilot/repair-history";
import {
  isUnknownThreadError,
  stoppedReason,
} from "@/lib/copilot/stopped-turn";
import { readThreadMessages } from "@/lib/copilot/thread-messages";
import { appConfig } from "@/lib/generated/application-config";
import { enqueueJobMutationOptions } from "@/lib/jobs/mutations";
import { jobQueryOptions } from "@/lib/jobs/queries";
import {
  agentIsOrchestrator,
  coworkerDisplayName,
  pickOrchestratorId,
} from "@/lib/orchestrator";
import { useSkillCommands } from "@/lib/plugins/skill-commands";
import { queryClient } from "@/query-client";
import { newId } from "../../lib/new-id";

/**
 * Backstop for the first message of a new channel; a stalled join must not lose the message.
 */
const SEND_WITHOUT_JOIN_AFTER_MS = 1500;

type PendingSend = {
  text: string;
  skills: string[];
  speakerId: string;
  resolve: () => void;
  reject: (error: unknown) => void;
};

/**
 * One channel's conversation. Several coworkers share the thread; one of them speaks per turn.
 *
 * The local agent id is channel-scoped so two channels with the same coworker keep separate
 * durable threads. The runtime agent is whoever is speaking this turn.
 */
export function ChannelChat({
  channel,
  focusAgentId,
  onSpeakerChange,
}: {
  channel: AgentChannel;
  /** Switch the speaker to this member (needs-you / computer activity). */
  focusAgentId?: string;
  onSpeakerChange?: (agentId: string) => void;
}) {
  // The core attaches the frontend tool registry; direct agent runs do not.
  const { copilotkit } = useCopilotKit();
  const { data: agentProfiles } = useQuery(agentListQueryOptions());
  const { data: currentUser } = useQuery(currentUserQueryOptions());
  const productName = appConfig.brand.productName;
  /**
   * First-message seed from the compose screen. It is taken once per mount and retained until the
   * agent has its own messages because joining a fresh thread can temporarily empty the agent.
   *
   * Who should answer is taken here too, so the first `useAgent` is already bound to that coworker
   * rather than the lead and a later switch.
   */
  const [seed] = useState<{
    message: Message | null;
    speakerId: string | null;
  }>(() => {
    const pending = takeFirstMessage(channel.id);
    if (!pending) return { message: null, speakerId: null };
    return {
      message: seedMessage(pending.text, newId()),
      speakerId: pending.agentId,
    };
  });

  const leadId =
    pickOrchestratorId(agentProfiles, channel.agentIds) ??
    channel.agentIds[0] ??
    "";
  const [speaker, setSpeaker] = useState(
    () =>
      resolveSpeaker(channel.agentIds, seed.speakerId) ??
      pickOrchestratorId(undefined, channel.agentIds) ??
      leadId,
  );
  const [composerDraft, setComposerDraft] = useState<ComposerDraft | null>(
    null,
  );
  /**
   * True while a new channel still has its first message on screen and has not yet been allowed
   * to start the run. Join can take a second and a half; without this the seed sits there with
   * no working line.
   */
  const [seedSending, setSeedSending] = useState(() => seed.message !== null);
  /** Words just sent, until CopilotKit's message list includes them. */
  const [outgoing, setOutgoing] = useState<Message | null>(null);

  useEffect(() => {
    onSpeakerChange?.(speaker);
  }, [onSpeakerChange, speaker]);

  const { agent, isReady } = useAgent({
    agentId: `channel:${channel.id}`,
    runtimeAgentId: speaker,
    threadId: channel.threadId,
    updates: [
      UseAgentUpdate.OnMessagesChanged,
      UseAgentUpdate.OnRunStatusChanged,
    ],
  });

  /** Cleared by the send-on-mount effect without restarting it. */
  const seedRef = useRef(seed.message);
  seedRef.current = seed.message;

  /**
   * Messages from the previous speaker binding. `useAgent` re-joins when the speaker changes; if
   * CopilotKit treats that as a new empty agent, this is what puts the thread back.
   */
  const snapshotRef = useRef<Message[] | null>(null);
  const pendingSendRef = useRef<PendingSend | null>(null);
  const joinedOnceRef = useRef(false);

  const snapshotMessages = () => {
    snapshotRef.current = agent.messages.map((message) => ({ ...message }));
  };
  const messagesRef = useRef(agent.messages);
  messagesRef.current = agent.messages;

  /** Promise gate for ordering the first message after the thread join when possible. */
  const openJoinGate = useRef<() => void>(() => {});
  const joinGate = useRef<Promise<void> | null>(null);
  if (joinGate.current === null) {
    joinGate.current = new Promise<void>((resolve) => {
      openJoinGate.current = resolve;
    });
  }
  const joinGatePromise = joinGate.current;

  /** Promise gate so messages typed before runtime readiness wait instead of being discarded. */
  const openReadyGate = useRef<() => void>(() => {});
  const readyGate = useRef<Promise<void> | null>(null);
  if (readyGate.current === null) {
    readyGate.current = new Promise<void>((resolve) => {
      openReadyGate.current = resolve;
    });
  }
  const readyGatePromise = readyGate.current;
  const isReadyRef = useRef(isReady);
  isReadyRef.current = isReady;
  useEffect(() => {
    if (isReady) openReadyGate.current();
  }, [isReady]);

  // Restore a snapshot synchronously if the hook comes back empty after a speaker switch.
  useEffect(() => {
    if (!speaker) return;
    if (agent.messages.length === 0 && snapshotRef.current?.length) {
      agent.setMessages(snapshotRef.current);
    }
  }, [agent, speaker]);

  // Join the gateway socket, restore durable history once, then release the first-message gate.
  useEffect(() => {
    if (!isReady) return;
    let current = true;

    void (async () => {
      try {
        // A seeded new goal has no Intelligence thread yet. connect() 404s
        // (Not Found / THREAD_NOT_FOUND) and locks the composer. The first
        // runAgent goes through handleIntelligenceRun, which opens the mapped
        // id. Existing goals still connect so an in-flight run can resume.
        // An unseeded first "Say hello" still connects; first-contact errors
        // must not set runError below.
        if (!seed.message) {
          await copilotkit.connectAgent({ agent });
        }
      } catch (error) {
        if (!isUnknownThreadError(error)) {
          // Reported by the run-failure subscriber below; history is still worth restoring.
        }
      }

      try {
        if (agent.messages.length === 0 && snapshotRef.current?.length) {
          agent.setMessages(snapshotRef.current);
        } else if (!joinedOnceRef.current && !seed.message) {
          // A seeded new channel has no history. Asking Intelligence for a
          // thread it has not seen 500s; skip restore and let the first send
          // create it. Existing channels still restore, always as the lead, so
          // a speaker switch does not fetch a different thread.
          const stored = await readThreadMessages(channel.threadId, leadId);
          // Never overwrite local messages that arrived while history was loading.
          if (current && stored.length > 0 && agent.messages.length === 0) {
            agent.setMessages(stored);
          }
        }
      } finally {
        joinedOnceRef.current = true;
        // Release even on join/restore failure; the gate orders messages, not withholds them.
        openJoinGate.current();
      }
    })();

    return () => {
      current = false;
    };
  }, [copilotkit, agent, isReady, channel.threadId, leadId, seed.message]);

  // Tool calls from this conversation act on the speaker's own computer.
  useActiveBot(speaker);

  const menuSpeaker =
    resolveSpeaker(channel.agentIds, composerDraft?.agentId, speaker) ??
    speaker;
  const skillCommands = useSkillCommands(menuSpeaker);
  const speakerName = agentProfiles?.find(
    (profile) => profile.id === speaker,
  )?.name;
  const speakerNameRef = useRef(speakerName);
  speakerNameRef.current = speakerName;
  const speakerRef = useRef(speaker);
  speakerRef.current = speaker;

  // Only when the parent names a new member — a later `@` send must not be yanked back.
  useEffect(() => {
    if (!focusAgentId || !channel.agentIds.includes(focusAgentId)) return;
    setSpeaker((current) => {
      if (current === focusAgentId) return current;
      snapshotRef.current = messagesRef.current.map((message) => ({
        ...message,
      }));
      return focusAgentId;
    });
  }, [focusAgentId, channel.agentIds]);

  // Run failures arrive as events and are reported only for turns started in this mount.
  const [runError, setRunError] = useState<string | null>(null);
  const awaitingReply = useRef(false);

  /*
   * TWO DIFFERENT FACTS ABOUT ONE TURN, AND NEITHER OF THEM IS `agent.isRunning`.
   *
   * `turnsInFlight` counts what a person would call the Bot having the turn: from the moment `say`
   * is entered until the whole thing has come back, browser actions in the middle included. It is
   * what decides whether the next thing typed is sent or parked, and what tells the queue its wait
   * is over.
   *
   * `runsInFlight` counts what Stop can actually reach: the run `copilotkit.runAgent` opens, and
   * nothing before it. A turn can be in flight for a second and a half before that, while `say`
   * waits for the runtime agent, and a Stop drawn in that window aborts a controller nobody has
   * made yet.
   *
   * `agent.isRunning` looks like both and is neither. It reports the run on the wire, and a turn
   * that touches the browser is several runs in a row: the Bot asks for a click, the run ENDS so
   * the browser can answer it, and another run starts carrying the answer. The agent reports itself
   * idle in every one of those gaps — the truth about the wire and a lie about the turn. OpenBot
   * registers every computer tool as a frontend tool, so the gaps open on ordinary work rather than
   * on some edge case, and anything keyed on the turn ending fires in the middle of one instead.
   *
   * Counters rather than booleans because nothing stops a second turn being started from a
   * component button while the first is still going, and two overlapping turns must not have the
   * first one to finish declare the conversation idle.
   */
  const [turnsInFlight, setTurnsInFlight] = useState(0);
  const [runsInFlight, setRunsInFlight] = useState(0);

  /**
   * Tell the roster what was just said. Failures here must not block the conversation.
   */
  const recordActivity = useMutation(recordChannelActivityMutationOptions());
  const enqueueJob = useMutation(enqueueJobMutationOptions(queryClient));
  const [awayJobId, setAwayJobId] = useState<string | null>(null);
  const [awayNotice, setAwayNotice] = useState<string | null>(null);
  const appliedAwayJob = useRef<string | null>(null);
  const awayJob = useQuery({
    ...jobQueryOptions(awayJobId ?? ""),
    enabled: Boolean(awayJobId),
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === "queued" || status === "running" ? 1500 : false;
    },
  });
  const report = (text: string, agentId: string | null) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    recordActivity.mutate({
      agentId,
      at: new Date().toISOString(),
      channelId: channel.id,
      text: trimmed,
    });
  };
  const reportRef = useRef(report);
  reportRef.current = report;

  /**
   * Everything `say` does once it has something worth sending, split out so the counter it is
   * wrapped in covers every way out of here, a throw included.
   */
  const deliver = async (trimmed: string, skillInstructions: string[]) => {
    setRunError(null);
    awaitingReply.current = true;

    /*
     * THE SKILL GOES IN FRONT OF THE MESSAGE, AS A SYSTEM TURN. A `/` chip is one token in the
     * composer; what it stands for is the instruction added here, ahead of what the person typed, so
     * the Bot reads the job before the request.
     *
     * A system message rather than text prepended to theirs, because the two are not the same kind
     * of thing: the transcript should show what a person said, and pasting the skill into their
     * words puts sentences in their mouth and makes the reply quote instructions back at them.
     *
     * `transcriptMessages` draws user and assistant turns, so this never appears on screen — the
     * chip is what says a skill was used, and it stays visible in the message they sent.
     *
     * Added before waiting for the runtime. The working line only appears under the person's
     * own message; waiting first left a silent gap of up to a second and a half after send.
     */
    for (const instruction of skillInstructions) {
      agent.addMessage({
        content: instruction,
        id: newId(),
        role: "system",
      });
    }

    const userMessage: Message = {
      content: trimmed,
      id: newId(),
      role: "user",
    };
    /*
     * Shown immediately. CopilotKit often keeps the same `messages` array and mutates it later,
     * so React would otherwise re-render as busy with the previous turn still last — no bubble,
     * no working line, and a composer that already emptied.
     */
    setOutgoing(userMessage);
    agent.addMessage(userMessage);
    report(trimmed, null);

    // Wait briefly for the runtime agent instance before starting the run.
    if (!isReadyRef.current) {
      await Promise.race([
        readyGatePromise,
        new Promise((resolve) =>
          setTimeout(resolve, SEND_WITHOUT_JOIN_AFTER_MS),
        ),
      ]);
    }

    // Providers reject later turns if prior tool calls have no result; repair before sending.
    const repaired = repairUnansweredToolCalls(agent.messages);
    if (repaired !== agent.messages) {
      agent.setMessages(repaired as typeof agent.messages);
    }

    setRunsInFlight((count) => count + 1);
    try {
      await copilotkit.runAgent({ agent });
    } finally {
      setRunsInFlight((count) => count - 1);
    }
  };

  /**
   * Send a user turn through the channel, including activity reporting and history repair.
   *
   * Every user turn in this channel goes through here — what the composer sends, the seed from the
   * compose screen, and a button inside a rendered component. That is what makes the counter worth
   * keeping here rather than in the view: the view sees only the turns it started itself, and a
   * queue that drains on the wrong one of those posts a correction into the middle of an answer.
   */
  const say = async (text: string, skillInstructions: string[] = []) => {
    const trimmed = text.trim();
    if (!trimmed) return;

    setTurnsInFlight((count) => count + 1);
    try {
      await deliver(trimmed, skillInstructions);
    } finally {
      setTurnsInFlight((count) => count - 1);
      setOutgoing(null);
    }
  };

  useEffect(() => {
    const fail = (message: string) => {
      if (!awaitingReply.current) return;
      // First-contact Not Found must not lock the composer. A new goal
      // created by POST /api/channels has no compose-screen seed; "Say hello"
      // is still the first Intelligence turn.
      if (isUnknownThreadError(message)) return;
      awaitingReply.current = false;
      setRunError(message);
    };
    const subscription = agent.subscribe?.({
      // Both surfaces fall back to the same sentence, from the same place, so a person who uses
      // both is not told two different things about the same silence.
      onRunErrorEvent: ({ event }) => fail(stoppedReason(event?.message)),
      onRunFailed: ({ error }) => fail(stoppedReason(error)),
      onRunFinishedEvent: () => {
        const wasOurs = awaitingReply.current;
        awaitingReply.current = false;
        if (!wasOurs) return;

        const messages = agent.messages;
        let replyIndex = -1;
        for (let index = messages.length - 1; index >= 0; index -= 1) {
          if (messages[index]?.role === "assistant") {
            replyIndex = index;
            break;
          }
        }
        const reply = replyIndex >= 0 ? messages[replyIndex] : undefined;
        const name = speakerNameRef.current;
        if (reply?.role === "assistant" && name) {
          const next = messages.slice();
          next[replyIndex] = { ...reply, name };
          agent.setMessages(next);
        }
        const content = typeof reply?.content === "string" ? reply.content : "";
        if (content) reportRef.current(content, speakerRef.current);
      },
    });
    return () => subscription?.unsubscribe();
  }, [agent]);

  /** Stable reference for effects and component callbacks. */
  const sayRef = useRef(say);
  sayRef.current = say;

  useEffect(() => {
    const job = awayJob.data;
    if (!job || !awayJobId || appliedAwayJob.current === job.id) return;
    if (job.status === "queued" || job.status === "running") {
      setAwayNotice("This coworker will continue after you leave.");
      return;
    }
    appliedAwayJob.current = job.id;
    if (job.status === "succeeded" && job.resultText) {
      const reply: Message = {
        content: job.resultText,
        id: newId(),
        role: "assistant",
        ...(speakerNameRef.current ? { name: speakerNameRef.current } : {}),
      };
      agent.addMessage(reply);
      setAwayNotice(null);
      return;
    }
    if (job.status === "failed" || job.status === "cancelled") {
      setAwayNotice(
        job.error ?? "The coworker could not finish after you left.",
      );
    }
  }, [agent, awayJob.data, awayJobId]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: must also re-run when useAgent returns a new instance for the speaker
  useEffect(() => {
    const pending = pendingSendRef.current;
    if (!pending || pending.speakerId !== speaker) return;
    pendingSendRef.current = null;
    void sayRef
      .current(pending.text, pending.skills)
      .then(pending.resolve, pending.reject);
  }, [agent, speaker]);

  /**
   * Component buttons speak as user turns without forcing every transcript card to re-render.
   */
  const askFromComponent = useCallback((text: string) => {
    void sayRef.current(text);
  }, []);

  /**
   * Send the create-channel seed once, after the join gate opens or the backstop expires.
   */
  useEffect(() => {
    const pending = seedRef.current;
    if (!pending) return;
    seedRef.current = null;

    void (async () => {
      try {
        await Promise.race([
          joinGatePromise,
          new Promise((resolve) =>
            setTimeout(resolve, SEND_WITHOUT_JOIN_AFTER_MS),
          ),
        ]);
        await sayRef.current(
          typeof pending.content === "string" ? pending.content : "",
        );
      } finally {
        setSeedSending(false);
      }
    })();

    // Keep `seed` in state; transcriptMessages hides it as soon as agent messages exist.
  }, [joinGatePromise]);

  const mentionProfiles =
    currentUser?.canSeeTheWork === true
      ? agentProfiles?.filter((profile) =>
          channel.agentIds.includes(profile.id),
        )
      : agentProfiles?.filter(
          (profile) =>
            channel.agentIds.includes(profile.id) &&
            agentIsOrchestrator(profile),
        );
  const mentionAgents = toAgentOptions(
    mentionProfiles?.map((profile) => ({
      ...profile,
      name: coworkerDisplayName(profile, productName),
    })),
  );

  return (
    <ConversationProvider ask={askFromComponent}>
      <ConversationView
        agents={mentionAgents}
        busy={agent.isRunning}
        // The `/` menu follows who will speak — a mentioned member, else the current speaker.
        commands={skillCommands}
        // Readiness is handled by `say`; deletion is the only disabled-chat state.
        disabled={!channel.active}
        messages={withOutgoingEcho(
          transcriptMessages(agent.messages, seed.message),
          outgoing,
        )}
        notice={
          !channel.active ? (
            <p className="pb-2 text-sm text-muted-foreground" role="status">
              A coworker in this channel has been deleted. The conversation
              stays readable, but it can no longer reply.
            </p>
          ) : awayNotice ? (
            <p className="pb-2 text-sm text-muted-foreground" role="status">
              {awayNotice}
            </p>
          ) : null
        }
        onDraftChange={setComposerDraft}
        onSendAndGo={async (draft) => {
          const trimmed = draft.text.trim();
          if (!trimmed) return;
          const skillInstructions = draft.commandIds
            .map(
              (id) =>
                skillCommands.find((command) => command.id === id)?.prompt,
            )
            .filter((instruction): instruction is string =>
              Boolean(instruction),
            );
          const nextSpeaker =
            resolveSpeaker(channel.agentIds, draft.agentId, speaker) ?? speaker;
          if (nextSpeaker !== speaker) {
            snapshotMessages();
            setSpeaker(nextSpeaker);
          }
          const job = await enqueueJob.mutateAsync({
            channelId: channel.id,
            prompt: trimmed,
            agentId: nextSpeaker,
            ...(skillInstructions.length > 0 ? { skillInstructions } : {}),
          });
          const userMessage: Message = {
            content: trimmed,
            id: newId(),
            role: "user",
          };
          setOutgoing(userMessage);
          agent.addMessage(userMessage);
          report(trimmed, null);
          setOutgoing(null);
          appliedAwayJob.current = null;
          setAwayJobId(job.id);
          setAwayNotice("This coworker will continue after you leave.");
        }}
        onSubmit={async (draft) => {
          // Honour a member `@` as the speaker for this send only. A stranger stays in the text;
          // inviting them is a later phase.
          //
          // `commandIds` are the `/` chips that survived into the send, in the order they were
          // typed. Resolved against the same list the menu was built from, so a chip left over from
          // a skill that has since been revoked resolves to nothing rather than to a stale
          // instruction — the menu is refetched, and this reads from it.
          const skillInstructions = draft.commandIds
            .map(
              (id) =>
                skillCommands.find((command) => command.id === id)?.prompt,
            )
            .filter((instruction): instruction is string =>
              Boolean(instruction),
            );

          const nextSpeaker =
            resolveSpeaker(channel.agentIds, draft.agentId, speaker) ?? speaker;

          if (nextSpeaker !== speaker) {
            snapshotMessages();
            await new Promise<void>((resolve, reject) => {
              pendingSendRef.current = {
                text: draft.text,
                skills: skillInstructions,
                speakerId: nextSpeaker,
                resolve,
                reject,
              };
              setSpeaker(nextSpeaker);
            });
            return;
          }

          await say(draft.text, skillInstructions);
        }}
        /**
         * Stop through the core so the abort signal reaches frontend tools; `say` repairs any
         * unanswered tool call before the next turn.
         */
        onStop={() => {
          awaitingReply.current = false;
          copilotkit.stopAgent({ agent });
        }}
        /*
         * The turn, not the run. A browser action ends one run and starts another, and telling the
         * conversation it is idle in between is what would drain a parked correction into the
         * middle of an answer: a second turn racing the first on one thread, with a fabricated
         * result stitched over a tool call that is still executing.
         */
        pending={agent.isRunning || turnsInFlight > 0 || seedSending}
        /*
         * A channel outlives its turns, so it is the screen where waiting is worth offering. A
         * correction typed mid-answer is held here, in this tab, and runs as one follow-up turn the
         * moment this one is over — including when it is over because somebody pressed the button
         * above.
         */
        queueWhileBusy
        /*
         * The run, not the turn. Stop reaches a run through the core's abort controller, and that
         * controller does not exist until `say` has finished waiting for the runtime agent — so
         * this is the one place the narrower fact is the honest one to draw a button from.
         */
        stoppable={agent.isRunning || runsInFlight > 0}
        /*
         * At the END OF THE TRANSCRIPT rather than above the composer, which is where this used to
         * be. A turn that ends without an answer leaves a gap exactly where the reply was going to
         * appear, and the person is already looking at it; an explanation in the composer area is a
         * different part of the screen from the thing it explains.
         *
         * `runError` carries whatever ended the turn, in that thing's own words. A Bot that stopped
         * streaming says so, because the deployment's stall watchdog writes that sentence into the
         * run before closing it; see server/src/channels/stall-guard.ts.
         */
        stopped={runError ?? undefined}
        {...(speakerName ? { thinkingName: speakerName } : {})}
      />
    </ConversationProvider>
  );
}
