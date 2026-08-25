import {
  IconBuilding,
  IconCreditCard,
  IconMail,
  IconShieldLock,
} from "@tabler/icons-react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { z } from "zod";
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
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import {
  activateOrganizationMutationOptions,
  createOwnOrganizationMutationOptions,
  inviteOrgMemberMutationOptions,
  setOrganizationSsoMutationOptions,
  setSpendCapMutationOptions,
} from "@/lib/orgs/mutations";
import {
  currentOrganizationQueryOptions,
  organizationListQueryOptions,
} from "@/lib/orgs/queries";
import { queryClient } from "@/query-client";

const searchSchema = z.object({
  checkout: z.string().optional(),
});

export const Route = createFileRoute("/_authed/_app/o")({
  validateSearch: searchSchema,
  component: OrganizationsPage,
});

function OrganizationsPage() {
  const navigate = useNavigate();
  const { checkout } = Route.useSearch();
  const orgs = useQuery(organizationListQueryOptions());
  const current = useQuery(currentOrganizationQueryOptions());
  const activate = useMutation(
    activateOrganizationMutationOptions(queryClient),
  );
  const createOrg = useMutation(
    createOwnOrganizationMutationOptions(queryClient),
  );
  const invite = useMutation(inviteOrgMemberMutationOptions(queryClient));
  const setSso = useMutation(setOrganizationSsoMutationOptions(queryClient));
  const setCap = useMutation(setSpendCapMutationOptions(queryClient));
  const [name, setName] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteSent, setInviteSent] = useState(false);
  const [capDollars, setCapDollars] = useState("");
  const workspace = current.data;
  const canManage = workspace?.role === "owner" || workspace?.role === "admin";

  return (
    <PageShell
      title="Organizations"
      description="Choose which company you are working in, or create one. Billing, seats, and sign-in for this workspace live here — not in a new nav family."
    >
      {checkout === "success" ? (
        <p className="text-sm">Checkout finished. This workspace is ready.</p>
      ) : checkout === "cancel" ? (
        <p className="text-sm">
          Checkout was cancelled. No workspace was added.
        </p>
      ) : null}
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
      {current.isPending ? null : workspace ? (
        <PageSection
          description="Seats, sign-in, and a spend cap for this company. A typical owner still goes home to Composer and Goals."
          title="This workspace"
        >
          <PageRows>
            <Item size="sm">
              <ItemMedia variant="icon">
                <IconCreditCard />
              </ItemMedia>
              <ItemContent>
                <ItemTitle>Plan and seats</ItemTitle>
                <ItemDescription>
                  {workspace.plan} — {workspace.seatsUsed} of{" "}
                  {workspace.seatLimit} seats
                  {workspace.pendingInvites > 0
                    ? ` (${workspace.pendingInvites} pending invite)`
                    : ""}
                  .
                </ItemDescription>
              </ItemContent>
            </Item>
            <Separator />
            <Item size="sm">
              <ItemMedia variant="icon">
                <IconCreditCard />
              </ItemMedia>
              <ItemContent>
                <ItemTitle>Spend</ItemTitle>
                <ItemDescription>
                  {workspace.spendCapCents === null
                    ? `${cents(workspace.spendUsedCents)} used. No cap.`
                    : `${cents(workspace.spendUsedCents)} of ${cents(workspace.spendCapCents)} used. Crossing the cap refuses new unattended, model, or computer work.`}
                </ItemDescription>
              </ItemContent>
            </Item>
          </PageRows>
          {canManage && workspace.sso ? (
            <PageRows className="mt-4">
              {(
                [
                  ["googleEnabled", "Google"],
                  ["microsoftEnabled", "Microsoft"],
                  ["oktaEnabled", "Okta"],
                  ["emailEnabled", "Email and password"],
                ] as const
              ).map(([key, label], index) => (
                <div key={key}>
                  {index > 0 ? <Separator /> : null}
                  <Item size="sm">
                    <ItemMedia variant="icon">
                      <IconShieldLock />
                    </ItemMedia>
                    <ItemContent>
                      <ItemTitle>{label}</ItemTitle>
                      <ItemDescription>
                        {workspace.sso?.[key]
                          ? "People in this workspace may use it."
                          : "People in this workspace may not use it."}
                      </ItemDescription>
                    </ItemContent>
                    <ItemActions>
                      <Switch
                        aria-label={label}
                        checked={workspace.sso?.[key] === true}
                        disabled={setSso.isPending}
                        onCheckedChange={(checked) =>
                          setSso.mutate({ [key]: checked })
                        }
                      />
                    </ItemActions>
                  </Item>
                </div>
              ))}
            </PageRows>
          ) : null}
          {canManage && workspace.sso ? (
            <form
              className="mt-4 flex flex-col gap-3"
              onSubmit={async (event) => {
                event.preventDefault();
                const value = String(
                  new FormData(event.currentTarget).get("sso-domains") ?? "",
                );
                await setSso.mutateAsync({
                  domains: value
                    .split(",")
                    .map((item) => item.trim())
                    .filter(Boolean),
                });
              }}
            >
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="sso-domains">
                  Email domains for this workspace
                </Label>
                <Input
                  defaultValue={workspace.sso.domains.join(", ")}
                  id="sso-domains"
                  name="sso-domains"
                  placeholder="acme.com, acme.co"
                />
              </div>
              <Button disabled={setSso.isPending} size="sm" type="submit">
                {setSso.isPending ? "Saving…" : "Save sign-in domains"}
              </Button>
              {setSso.error ? (
                <p className="text-destructive text-sm" role="alert">
                  {setSso.error.message}
                </p>
              ) : null}
            </form>
          ) : null}
          {canManage ? (
            <form
              className="mt-4 flex flex-col gap-3"
              onSubmit={async (event) => {
                event.preventDefault();
                const trimmed = capDollars.trim();
                await setCap.mutateAsync(
                  trimmed === "" ? null : Math.round(Number(trimmed) * 100),
                );
                setCapDollars("");
              }}
            >
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="spend-cap-dollars">
                  Spend cap (dollars, empty for none)
                </Label>
                <Input
                  id="spend-cap-dollars"
                  inputMode="decimal"
                  onChange={(event) => setCapDollars(event.target.value)}
                  placeholder="Leave empty for no cap"
                  value={capDollars}
                />
              </div>
              <Button disabled={setCap.isPending} size="sm" type="submit">
                {setCap.isPending ? "Saving…" : "Save spend cap"}
              </Button>
              {setCap.error ? (
                <p className="text-destructive text-sm" role="alert">
                  {setCap.error.message}
                </p>
              ) : null}
            </form>
          ) : null}
          {canManage ? (
            <form
              className="mt-4 flex flex-col gap-3"
              onSubmit={async (event) => {
                event.preventDefault();
                if (!inviteEmail.trim()) return;
                await invite.mutateAsync({
                  email: inviteEmail.trim(),
                  role: "member",
                });
                setInviteSent(true);
                setInviteEmail("");
              }}
            >
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="workspace-invite-email">
                  Invite a colleague
                </Label>
                <Input
                  id="workspace-invite-email"
                  onChange={(event) => {
                    setInviteEmail(event.target.value);
                    setInviteSent(false);
                  }}
                  placeholder="colleague@company.com"
                  type="email"
                  value={inviteEmail}
                />
              </div>
              <Button
                disabled={invite.isPending || !inviteEmail.trim()}
                size="sm"
                type="submit"
              >
                <IconMail />
                {invite.isPending ? "Sending…" : "Email invite"}
              </Button>
              {invite.error ? (
                <p className="text-destructive text-sm" role="alert">
                  {invite.error.message}
                </p>
              ) : null}
              {inviteSent ? <p className="text-sm">Invite emailed.</p> : null}
            </form>
          ) : null}
        </PageSection>
      ) : null}
      <PageSection
        description="The first workspace is free. Another one goes through Checkout when Stripe is configured."
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
              aria-describedby={
                createOrg.error ? "new-organization-error" : undefined
              }
              aria-invalid={createOrg.error ? true : undefined}
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
            <p
              className="text-destructive text-sm"
              id="new-organization-error"
              role="alert"
            >
              {createOrg.error.message}
            </p>
          ) : null}
        </form>
      </PageSection>
    </PageShell>
  );
}

function cents(value: number): string {
  return `$${(value / 100).toFixed(2)}`;
}
