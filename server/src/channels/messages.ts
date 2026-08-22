import { and, asc, eq } from "drizzle-orm";
import type { AgentActor } from "../agents/profile-types";
import type { Database } from "../db/client";
import { agents, channelMemberships, channelMessages } from "../db/schema";
import { ChannelNotFoundError } from "./errors";

export type ChannelPostedMessage = {
  id: string;
  channelId: string;
  senderAgentId: string | null;
  senderName: string | null;
  body: string;
  hop: number;
  createdAt: Date;
};

export type ChannelMessageStore = {
  post(input: {
    channelId: string;
    senderAgentId: string;
    body: string;
    hop: number;
  }): Promise<ChannelPostedMessage>;
  list(
    actor: AgentActor,
    channelId: string,
  ): Promise<ChannelPostedMessage[]>;
};

export function createChannelMessageStore(
  database: Database,
): ChannelMessageStore {
  return {
    async post(input) {
      const id = `msg_${crypto.randomUUID()}`;
      const [row] = await database
        .insert(channelMessages)
        .values({
          id,
          channelId: input.channelId,
          senderAgentId: input.senderAgentId,
          body: input.body,
          hop: input.hop,
        })
        .returning({
          id: channelMessages.id,
          channelId: channelMessages.channelId,
          senderAgentId: channelMessages.senderAgentId,
          body: channelMessages.body,
          hop: channelMessages.hop,
          createdAt: channelMessages.createdAt,
        });
      if (!row) {
        throw new Error("The message could not be stored.");
      }

      const [sender] = await database
        .select({ name: agents.name })
        .from(agents)
        .where(eq(agents.id, input.senderAgentId));

      return {
        ...row,
        senderName: sender?.name ?? null,
      };
    },

    async list(actor, channelId) {
      const [membership] = await database
        .select({ channelId: channelMemberships.channelId })
        .from(channelMemberships)
        .where(
          and(
            eq(channelMemberships.channelId, channelId),
            eq(channelMemberships.userId, actor.id),
          ),
        );
      if (!membership) throw new ChannelNotFoundError(channelId);

      const rows = await database
        .select({
          id: channelMessages.id,
          channelId: channelMessages.channelId,
          senderAgentId: channelMessages.senderAgentId,
          senderName: agents.name,
          body: channelMessages.body,
          hop: channelMessages.hop,
          createdAt: channelMessages.createdAt,
        })
        .from(channelMessages)
        .leftJoin(agents, eq(agents.id, channelMessages.senderAgentId))
        .where(eq(channelMessages.channelId, channelId))
        .orderBy(asc(channelMessages.createdAt), asc(channelMessages.id));

      return rows.map((row) => ({
        id: row.id,
        channelId: row.channelId,
        senderAgentId: row.senderAgentId,
        senderName: row.senderName,
        body: row.body,
        hop: row.hop,
        createdAt: row.createdAt,
      }));
    },
  };
}
