import { createFileRoute, Outlet } from "@tanstack/react-router";
import { MobileChrome } from "@/components/layout/mobile-chrome";
import { SettingsSidebar } from "@/components/settings/settings-sidebar";
import { SidebarProvider } from "@/components/ui/sidebar";

export const Route = createFileRoute("/_authed/settings")({
  component: RouteComponent,
});

function RouteComponent() {
  return (
    <SidebarProvider
      className="h-svh overflow-hidden"
      /*
       * The same 340px the app shell uses. Settings is a different screen, not a different product,
       * and a rail that changes width on the way in makes the whole frame look like it moved.
       */
      style={
        {
          "--sidebar-width": "340px",
          "--sidebar-width-mobile": "20rem",
        } as React.CSSProperties
      }
    >
      <SettingsSidebar />
      <main className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <MobileChrome title="Settings" />
        <div className="min-h-0 flex-1 overflow-y-auto">
          <Outlet />
        </div>
      </main>
    </SidebarProvider>
  );
}
