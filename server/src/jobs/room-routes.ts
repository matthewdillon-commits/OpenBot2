/**
 * The operator door: A2A room for one goal. Role-gated (operator / admin).
 *
 * Typical owners do not list rooms unless they opened See the work. Cmd-K
 * “Rooms” uses GET /api/rooms. The customer door stays composer + goals.
 */
import type { MiddlewareHandler } from "hono";
import { Hono } from "hono";
import type { AgentProfileStore } from "../agents/profile-store";
import type { AppVariables } from "../auth/guards";
import type { ChannelStore } from "../channels/routes";
import { canSeeTheWork } from "../orchestrator";
import { orgIdOf } from "../orgs/constants";
import { publicJob } from "./routes";
import type { JobStore } from "./store";

export const SEE_THE_WORK_REFUSAL =
  "See the work is for operators and administrators.";

export type RoomRoutesOptions = {
  requireUser: MiddlewareHandler<{ Variables: AppVariables }>;
  channelStore: ChannelStore;
  jobStore: JobStore;
  agentProfileStore?: AgentProfileStore;
};

export function createRoomRoutes(options: RoomRoutesOptions) {
  const { requireUser, channelStore, jobStore, agentProfileStore } = options;
  const routes = new Hono<{ Variables: AppVariables }>();

  routes.get("/", requireUser, async (context) => {
    if (!canSeeTheWork(context.var.actor)) {
      return context.json({ error: SEE_THE_WORK_REFUSAL }, 403);
    }
    const page = await channelStore.list(context.var.actor);
    return context.json({
      rooms: page.channels.map((channel) => ({
        id: channel.id,
        name: channel.name,
        goalId: channel.id,
        threadId: channel.threadId,
        agentIds: channel.agentIds,
        goalStatus: channel.goalStatus,
        lastAction: channel.lastAction,
        lastActionAt: channel.lastActionAt?.toISOString() ?? null,
      })),
    });
  });

  routes.get("/:channelId", requireUser, async (context) => {
    if (!canSeeTheWork(context.var.actor)) {
      return context.json({ error: SEE_THE_WORK_REFUSAL }, 403);
    }
    const actor = context.var.actor;
    const orgId = orgIdOf(actor);
    const channel = await channelStore.get(
      actor,
      context.req.param("channelId"),
    );
    if (!channel) {
      return context.json({ error: "There is no such goal." }, 404);
    }
    const listed = await jobStore.listForChannel(orgId, channel.id);
    const members = await Promise.all(
      channel.agentIds.map(async (agentId) => {
        const profile = agentProfileStore
          ? await agentProfileStore.get(actor, agentId)
          : null;
        return {
          id: agentId,
          name: profile?.name ?? agentId,
          standingRole: profile?.standingRole ?? null,
        };
      }),
    );
    return context.json({
      room: {
        id: channel.id,
        name: channel.name,
        goalId: channel.id,
        threadId: channel.threadId,
        agentIds: channel.agentIds,
        members,
        jobs: listed.map(publicJob),
      },
    });
  });

  return routes;
}
