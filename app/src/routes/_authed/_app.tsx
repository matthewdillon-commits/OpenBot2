import { createFileRoute, Outlet } from "@tanstack/react-router";
import { AppSidebar } from "@/components/app-sidebar/app-sidebar";
import { CommandPalette } from "@/components/command-palette";
import { MobileChrome } from "@/components/layout/mobile-chrome";
import { SidebarProvider } from "@/components/ui/sidebar";
import { appConfig } from "@/lib/generated/application-config";

export const Route = createFileRoute("/_authed/_app")({
  component: RouteComponent,
});

function RouteComponent() {
  return (
    // One viewport, never scrolls: panes scroll inside it. A growable shell lets the transcript's
    // scroller size against the page, grow it, and grow again.
    <SidebarProvider
      className="h-svh overflow-hidden"
      style={
        {
          "--sidebar-width": "340px",
          "--sidebar-width-mobile": "20rem",
        } as React.CSSProperties
      }
    >
      <AppSidebar />
      <CommandPalette />
      <main className="flex-1 flex flex-col min-h-0 overflow-hidden" id="main">
        <MobileChrome title={appConfig.brand.productName} />
        <div className="relative flex h-full min-h-0 flex-1 flex-col overflow-y-auto overflow-x-hidden">
          <Outlet />
        </div>
      </main>
    </SidebarProvider>
  );
}
