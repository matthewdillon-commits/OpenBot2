import { useMutation } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { PageSection, PageShell } from "@/components/layout/page-shell";
import { Button } from "@/components/ui/button";
import { acceptInviteMutationOptions } from "@/lib/orgs/mutations";
import { queryClient } from "@/query-client";

export const Route = createFileRoute("/_authed/_app/invite/$token")({
  component: AcceptInvitePage,
});

function AcceptInvitePage() {
  const { token } = Route.useParams();
  const navigate = useNavigate();
  const accept = useMutation(acceptInviteMutationOptions(queryClient));

  return (
    <PageShell
      title="Organization invite"
      description="Join the company you were invited to."
    >
      <PageSection title="Accept">
        <Button
          type="button"
          size="sm"
          disabled={accept.isPending}
          onClick={async () => {
            await accept.mutateAsync(token);
            await navigate({ to: "/" });
          }}
        >
          {accept.isPending ? "Joining…" : "Accept invite"}
        </Button>
        {accept.error ? (
          <p className="text-destructive mt-3 text-sm" role="alert">
            {accept.error.message}
          </p>
        ) : null}
      </PageSection>
    </PageShell>
  );
}
