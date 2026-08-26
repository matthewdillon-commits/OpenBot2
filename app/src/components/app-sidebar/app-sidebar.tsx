import {
  IconAddressBook,
  IconBox,
  IconBuilding,
  IconLogout,
  IconPlug,
  IconPlus,
  IconSettings,
  IconShieldLock,
} from "@tabler/icons-react";
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { Link, type LinkOptions, useNavigate } from "@tanstack/react-router";
import type * as React from "react";
import { useEffect, useState } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "@/components/ui/sidebar";
import { signOutMutationOptions } from "@/lib/auth/mutations";
import { currentUserQueryOptions } from "@/lib/auth/queries";
import { channelListQueryOptions } from "@/lib/channels/queries";
import { type GoalListStatus, normalizeGoalQuery } from "@/lib/channels/search";
import { useChannelEvents } from "@/lib/channels/use-channel-events";
import { appConfig } from "@/lib/generated/application-config";
import { ownerNavItems } from "@/lib/nav/owner-nav";
import { Button } from "../ui/button";
import { GoalRoster } from "./goal-roster";

const appLinkOptions = { to: "/" } satisfies LinkOptions;
const adminLinkOptions = { to: "/admin" } satisfies LinkOptions;
const settingsLinkOptions = { to: "/settings" } satisfies LinkOptions;

const userMenuItemClassName = "gap-2 px-2 py-1.5";

function UserAvatar() {
  const { data: currentUser } = useQuery(currentUserQueryOptions());
  const initials =
    currentUser?.name
      ?.trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join("") ?? currentUser?.email.slice(0, 2).toUpperCase();

  return (
    <div className="size-[28px] bg-muted-foreground/10 text-foreground/70 rounded-full flex items-center justify-center text-xs overflow-hidden">
      {initials}
    </div>
  );
}

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  const { data: currentUser } = useQuery(currentUserQueryOptions());
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const signOut = useMutation(signOutMutationOptions(queryClient));
  /*
   * Search and status live here, not on the URL, because the sidebar stays mounted while a goal
   * opens and closes. Returning from a goal detail therefore keeps the same query and filter.
   */
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<GoalListStatus>("all");
  const [query, setQuery] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setQuery(normalizeGoalQuery(search)), 250);
    return () => clearTimeout(timer);
  }, [search]);
  const channels = useInfiniteQuery(
    channelListQueryOptions({ search: query, status }),
  );
  // One socket for the app, opened where the roster is kept live.
  useChannelEvents();

  const handleSignOut = async () => {
    await signOut.mutateAsync();
    await navigate({ to: "/sign" });
  };

  return (
    <Sidebar {...props}>
      <SidebarHeader className="h-12 p-2">
        <SidebarMenu>
          <SidebarMenuItem className="flex flex-row gap-1.5">
            <SidebarMenuButton
              className="font-semibold text-[14px] tracking-tighter h-full leading-tight"
              render={(props) => (
                <Link {...appLinkOptions} {...props}>
                  {appConfig.brand.productName}
                </Link>
              )}
            />
            <Button
              aria-label="New goal"
              size="icon"
              variant="ghost"
              render={(props) => (
                <Link
                  {...props}
                  to="/"
                  activeProps={{
                    className: "bg-foreground/5",
                  }}
                />
              )}
            >
              <IconPlus aria-hidden="true" />
            </Button>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent className="scroll-fade-b max-md:flex-none max-md:overflow-visible">
        <SidebarMenu>
          <SidebarGroup className="gap-px">
            <GoalRoster
              channels={channels.data}
              hasNextPage={channels.hasNextPage}
              isError={channels.isError}
              isFetchingNextPage={channels.isFetchingNextPage}
              isPending={channels.isPending}
              isPlaceholderData={channels.isPlaceholderData}
              onLoadMore={() => void channels.fetchNextPage()}
              onSearchChange={setSearch}
              onStatusChange={setStatus}
              query={query}
              search={search}
              status={status}
            />
          </SidebarGroup>
        </SidebarMenu>
      </SidebarContent>
      <SidebarFooter>
        <SidebarMenu className="gap-px">
          {ownerNavItems({
            canSeeTheWork: currentUser?.canSeeTheWork === true,
          }).map((item) => (
            <SidebarMenuItem key={item.to}>
              <SidebarMenuButton
                className="hover:bg-foreground/5 h-10"
                render={(props) => (
                  <Link
                    {...props}
                    to={item.to}
                    activeProps={{
                      className: "bg-foreground/5",
                    }}
                  />
                )}
              >
                <div className="size-[28px] flex items-center justify-center">
                  {item.to === "/crm" ? (
                    <IconAddressBook />
                  ) : item.to === "/plugins" ? (
                    <span className="flex size-7 items-center justify-center rounded-full border border-border">
                      <IconPlug className="size-3.5" />
                    </span>
                  ) : (
                    <IconBox />
                  )}
                </div>
                <span className="text-sm tracking-tight">{item.label}</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ))}
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <SidebarMenuButton className="hover:bg-foreground/5 h-10" />
                }
              >
                <UserAvatar />
                <span className="text-sm tracking-tight">
                  {currentUser?.name || currentUser?.email}
                </span>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="start"
                className="p-1.5"
                side="top"
                sideOffset={8}
              >
                {/* Admin routes are server-guarded; hide the entry for users who cannot open them. */}
                <DropdownMenuItem
                  className={userMenuItemClassName}
                  render={<Link to="/o" />}
                >
                  <IconBuilding />
                  {currentUser?.orgName ?? "Organizations"}
                </DropdownMenuItem>
                {currentUser?.canOpenDeploymentAdmin ? (
                  <DropdownMenuItem
                    className={userMenuItemClassName}
                    render={<Link {...adminLinkOptions} />}
                  >
                    <IconShieldLock />
                    Admin
                  </DropdownMenuItem>
                ) : null}
                {currentUser?.platformSuperadmin ? (
                  <DropdownMenuItem
                    className={userMenuItemClassName}
                    render={<Link to="/platform" />}
                  >
                    <IconBuilding />
                    Platform
                  </DropdownMenuItem>
                ) : null}
                <DropdownMenuItem
                  className={userMenuItemClassName}
                  render={<Link {...settingsLinkOptions} />}
                >
                  <IconSettings />
                  Settings
                </DropdownMenuItem>
                <DropdownMenuItem
                  className={userMenuItemClassName}
                  disabled={signOut.isPending}
                  onClick={handleSignOut}
                  variant="destructive"
                >
                  <IconLogout />
                  Log out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
