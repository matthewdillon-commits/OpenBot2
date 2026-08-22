import { IconBuilding } from "@tabler/icons-react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
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
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  activateOrganizationMutationOptions,
  createOwnOrganizationMutationOptions,
} from "@/lib/orgs/mutations";
import { organizationListQueryOptions } from "@/lib/orgs/queries";
import { queryClient } from "@/query-client";

export const Route = createFileRoute("/_authed/_app/o")({
  component: OrganizationsPage,
});

function OrganizationsPage() {
  const navigate = useNavigate();
  const orgs = useQuery(organizationListQueryOptions());
  const activate = useMutation(
    activateOrganizationMutationOptions(queryClient),
  );
  const createOrg = useMutation(
    createOwnOrganizationMutationOptions(queryClient),
  );
  const [name, setName] = useState("");

  return (
    <PageShell
      title="Organizations"
      description="Choose which company you are working in, or create one."
    >
      <PageSection title="Your organizations">
        {orgs.isPending ? null : orgs.error ? (
          <p className="text-destructive text-sm" role="alert">
            Could not load organizations.
          </p>
        ) : orgs.data?.organizations.length === 0 ? (
          <PageEmpty>
            You have not been invited to an organization yet. Create one to
            start.
          </PageEmpty>
        ) : (
          <PageRows>
            {orgs.data?.organizations.map((organization, index) => (
              <div key={organization.id}>
                {index > 0 ? <Separator /> : null}
                <Item
                  size="sm"
                  render={
                    <button
                      type="button"
                      onClick={async () => {
                        await activate.mutateAsync({ slug: organization.slug });
                        await navigate({ to: "/" });
                      }}
                    />
                  }
                >
                  <ItemMedia variant="icon">
                    <IconBuilding />
                  </ItemMedia>
                  <ItemContent>
                    <ItemTitle>{organization.name}</ItemTitle>
                  </ItemContent>
                  <ItemActions>
                    {organization.slug === orgs.data.current?.slug
                      ? "Current"
                      : organization.role}
                  </ItemActions>
                </Item>
              </div>
            ))}
          </PageRows>
        )}
      </PageSection>
      <PageSection
        description="A new organization is its own workspace. You become its owner."
        title="New organization"
      >
        <form
          className="mt-4 flex flex-col gap-3"
          onSubmit={async (event) => {
            event.preventDefault();
            if (!name.trim()) return;
            await createOrg.mutateAsync({ name: name.trim() });
            setName("");
            await navigate({ to: "/" });
          }}
        >
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="new-organization-name">Company name</Label>
            <Input
              id="new-organization-name"
              onChange={(event) => setName(event.target.value)}
              placeholder="Company name"
              value={name}
            />
          </div>
          <Button
            disabled={createOrg.isPending || !name.trim()}
            size="sm"
            type="submit"
          >
            {createOrg.isPending ? "Creating…" : "Create organization"}
          </Button>
          {createOrg.error ? (
            <p className="text-destructive text-sm" role="alert">
              {createOrg.error.message}
            </p>
          ) : null}
        </form>
      </PageSection>
    </PageShell>
  );
}
