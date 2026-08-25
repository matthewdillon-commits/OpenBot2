/**
 * Who an unattended run is for, without a cookie Request.
 *
 * CopilotKit's `identifyUser` / `identifyActor` take a Request because a browser turn arrives
 * with a session cookie. A worker has no browser: the acting user and org are on the job row,
 * and must stay explicit. Building a fake Request to satisfy those signatures would hide where
 * the identity came from and make a missing membership look like an anonymous `/info` actor.
 */
import type { AgentActor } from "../agents/profile-types";
import type { OpenBotRole } from "../auth/roles";
import {
  intelligenceUserId,
  type OrganizationRole,
  openBotRoleFor,
} from "../orgs/constants";

/** The person a job runs as: session actor, reloaded from the job row. */
export type ActorContext = {
  id: string;
  name: string;
  role: OpenBotRole;
  orgId: string;
};

/** The Intelligence projection: threads are already scoped as `org:user`. */
export function identifyUserFromContext(actor: {
  id: string;
  name: string;
  orgId: string;
}): { id: string; name: string } {
  return { id: intelligenceUserId(actor.orgId, actor.id), name: actor.name };
}

/** The authorization projection: agent visibility and org-scoped tools. */
export function identifyActorFromContext(actor: {
  id: string;
  role: OpenBotRole;
  orgId: string;
}): AgentActor {
  return { id: actor.id, role: actor.role, orgId: actor.orgId };
}

export function actorContextFromMembership(input: {
  userId: string;
  name: string;
  orgId: string;
  orgRole: OrganizationRole;
}): ActorContext {
  return {
    id: input.userId,
    name: input.name,
    role: openBotRoleFor(input.orgRole),
    orgId: input.orgId,
  };
}
