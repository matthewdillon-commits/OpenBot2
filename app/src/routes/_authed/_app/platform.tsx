import { IconBuilding, IconPlus } from "@tabler/icons-react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { useState } from "react";
import {
  PageEmpty,
  PageRows,
  PageSection,
  PageShell,
} from "@/components/layout/page-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item";
import { Separator } from "@/components/ui/separator";
import { currentUserQueryOptions } from "@/lib/auth/queries";
import {
  createOrganizationMutationOptions,
  inviteToOrganizationMutationOptions,
  setOrganizationStatusMutationOptions,
} from "@/lib/orgs/mutations";
import { platformOrganizationListQueryOptions } from "@/lib/orgs/queries";
import { queryClient } from "@/query-client";

export const Route = createFileRoute("/_authed/_app/platform")({
  beforeLoad: async ({ context }) => {
    const user = await context.queryClient.ensureQueryData(
      currentUserQueryOptions(),
    );
    if (!user?.platformSuperadmin) {
      throw redirect({ to: "/" });
    }
  },
  component: PlatformPage,
});

function PlatformPage() {
  const orgs = useQuery(platformOrganizationListQueryOptions());
  const createOrg = useMutation(createOrganizationMutationOptions(queryClient));
  const invite = useMutation(inviteToOrganizationMutationOptions(queryClient));
  const setStatus = useMutation(
    setOrganizationStatusMutationOptions(queryClient),
  );
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [inviteOrgId, setInviteOrgId] = useState("");
  const [token, setToken] = useState<string | null>(null);

  return (
    <PageShell
      title="Platform"
      description="Provision organizations and invite their owners. This is not an organization's own admin."
    >
      <PageSection title="New organization">
        <form
          className="flex flex-col gap-3"
          onSubmit={async (event) => {
            event.preventDefault();
            if (!name.trim()) return;
            await createOrg.mutateAsync({ name: name.trim() });
            setName("");
          }}
        >
          <Input
            aria-describedby={
              createOrg.error ? "platform-org-error" : undefined
            }
            aria-invalid={createOrg.error ? true : undefined}
            aria-label="Company name"
            onChange={(event) => setName(event.target.value)}
            placeholder="Company name"
            value={name}
          />
          <Button
            type="submit"
            size="sm"
            disabled={createOrg.isPending || !name.trim()}
          >
            <IconPlus aria-hidden="true" />
            {createOrg.isPending ? "Creating…" : "Create organization"}
          </Button>
          {createOrg.error ? (
            <p
              className="text-destructive text-sm"
              id="platform-org-error"
              role="alert"
            >
              {createOrg.error.message}
            </p>
          ) : null}
        </form>
      </PageSection>
      <PageSection title="Invite an owner">
        <form
          className="flex flex-col gap-3"
          onSubmit={async (event) => {
            event.preventDefault();
            if (!inviteOrgId || !email.trim()) return;
            const result = await invite.mutateAsync({
              orgId: inviteOrgId,
              email: email.trim(),
              role: "owner",
            });
            setToken(result.token);
            setEmail("");
          }}
        >
          <Input
            aria-describedby={
              invite.error ? "platform-invite-error" : undefined
            }
            aria-invalid={invite.error ? true : undefined}
            aria-label="Organization id"
            onChange={(event) => setInviteOrgId(event.target.value)}
            placeholder="Organization id"
            value={inviteOrgId}
          />
          <Input
            aria-describedby={
              invite.error ? "platform-invite-error" : undefined
            }
            aria-invalid={invite.error ? true : undefined}
            aria-label="Owner email"
            onChange={(event) => setEmail(event.target.value)}
            placeholder="owner@company.com"
            type="email"
            value={email}
          />
          <Button
            type="submit"
            size="sm"
            disabled={invite.isPending || !inviteOrgId || !email.trim()}
          >
            {invite.isPending ? "Inviting…" : "Create invite"}
          </Button>
          {invite.error ? (
            <p
              className="text-destructive text-sm"
              id="platform-invite-error"
              role="alert"
            >
              {invite.error.message}
            </p>
          ) : null}
        </form>
        {token ? (
          <p className="mt-3 text-sm">
            Invite link: <code>/invite/{token}</code>
          </p>
        ) : null}
      </PageSection>
      <PageSection title="Organizations">
        {orgs.isPending ? null : orgs.error ? (
          <p className="text-destructive text-sm" role="alert">
            Could not load organizations.
          </p>
        ) : orgs.data?.length === 0 ? (
          <PageEmpty>No organizations have been created.</PageEmpty>
        ) : (
          <PageRows>
            {orgs.data?.map((organization, index) => (
              <div key={organization.id}>
                {index > 0 ? <Separator /> : null}
                <Item size="sm">
                  <ItemMedia variant="icon">
                    <IconBuilding />
                  </ItemMedia>
                  <ItemContent>
                    <ItemTitle>{organization.name}</ItemTitle>
                    <ItemDescription className="line-clamp-none">
                      {organization.slug} · {organization.status} ·{" "}
                      {organization.id}
                    </ItemDescription>
                  </ItemContent>
                  <ItemActions>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={setStatus.isPending}
                      onClick={() =>
                        setStatus.mutate({
                          orgId: organization.id,
                          status:
                            organization.status === "suspended"
                              ? "active"
                              : "suspended",
                        })
                      }
                    >
                      {organization.status === "suspended"
                        ? "Restore"
                        : "Suspend"}
                    </Button>
                  </ItemActions>
                </Item>
              </div>
            ))}
          </PageRows>
        )}
      </PageSection>
    </PageShell>
  );
}
