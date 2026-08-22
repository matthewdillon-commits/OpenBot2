import { IconBuilding } from "@tabler/icons-react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import {
  PageEmpty,
  PageRows,
  PageSection,
  PageShell,
} from "@/components/layout/page-shell";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item";
import { Separator } from "@/components/ui/separator";
import { activateOrganizationMutationOptions } from "@/lib/orgs/mutations";
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

  return (
    <PageShell
      title="Organizations"
      description="Choose which company you are working in."
    >
      <PageSection title="Your organizations">
        {orgs.isPending ? null : orgs.error ? (
          <p className="text-destructive text-sm" role="alert">
            Could not load organizations.
          </p>
        ) : orgs.data?.organizations.length === 0 ? (
          <PageEmpty>
            You have not been invited to an organization yet.
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
    </PageShell>
  );
}
