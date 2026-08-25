import { IconPlus } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { z } from "zod";
import { AgentCard } from "@/components/agents/agent-card";
import { AgentProfile as AgentProfileDetail } from "@/components/agents/agent-profile";
import { NewAgent } from "@/components/agents/new-agent";
import { DetailPanel } from "@/components/layout/detail-panel";
import { StaggerItem } from "@/components/layout/stagger";
import { Button } from "@/components/ui/button";
import { agentListQueryOptions } from "@/lib/agents/queries";
import { currentUserQueryOptions } from "@/lib/auth/queries";

/**
 * Creating and inspecting a coworker are search-parameter states so the roster remains mounted and
 * Back closes the detail pane.
 */
const agentsSearchSchema = z.object({
  new: z.boolean().optional(),
  agent: z.string().optional(),
});

export const Route = createFileRoute("/_authed/_app/agents/")({
  validateSearch: agentsSearchSchema,
  beforeLoad: async ({ context }) => {
    const user = await context.queryClient.ensureQueryData(
      currentUserQueryOptions(),
    );
    if (!user?.canSeeTheWork) {
      throw redirect({ to: "/" });
    }
  },
  component: AgentsScreen,
});

function AgentsScreen() {
  const { new: isCreating, agent: selectedAgentId } = Route.useSearch();
  const navigate = Route.useNavigate();
  const { data: agents } = useQuery(agentListQueryOptions());
  const mine = agents?.filter((a) => a.mine);
  const explore = agents?.filter((a) => !a.mine && a.visibility === "public");

  // Creating wins if both are somehow set: it is the more recent intent.
  const showCreate = isCreating === true;
  const showProfile = !showCreate && selectedAgentId !== undefined;
  const close = () => navigate({ search: {} });

  return (
    <DetailPanel
      onClose={close}
      open={showCreate || showProfile}
      detail={
        showCreate ? (
          <NewAgent />
        ) : selectedAgentId ? (
          <AgentProfileDetail agentId={selectedAgentId} />
        ) : null
      }
    >
      <div className="max-w-2xl px-4 w-full mx-auto">
        <div className="mt-12 w-full max-w-2xl">
          <div className="flex flex-row w-full items-center justify-between">
            <h2 className="font-bold text-lg tracking-tight text-balance">
              Your agents
            </h2>
            <Button
              variant="ghost"
              size="sm"
              render={(props) => (
                <Link to="/agents" search={{ new: true }} {...props} />
              )}
            >
              <IconPlus />
              New agent
            </Button>
          </div>
          {mine?.length ? (
            <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {mine.map((agent, index) => {
                return (
                  <StaggerItem index={index} key={agent.id}>
                    <Link
                      className="rounded-2xl outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                      search={{ agent: agent.id }}
                      to="/agents"
                    >
                      <AgentCard agent={agent} />
                    </Link>
                  </StaggerItem>
                );
              })}
            </div>
          ) : (
            <p className="mt-4 text-sm text-muted-foreground">
              You don't have any agents created.
            </p>
          )}
        </div>
        <div className="mt-8 w-full max-w-2xl">
          <h2 className="font-bold text-lg tracking-tight text-balance">
            Explore agents
          </h2>
          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {!!explore?.length &&
              explore.map((agent, index) => {
                return (
                  <StaggerItem index={index} key={agent.id}>
                    <Link
                      className="rounded-2xl outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                      search={{ agent: agent.id }}
                      to="/agents"
                    >
                      <AgentCard agent={agent} />
                    </Link>
                  </StaggerItem>
                );
              })}
          </div>
        </div>
      </div>
    </DetailPanel>
  );
}
