import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { AdminSidebar } from "@/components/admin/admin-sidebar";
import { MobileChrome } from "@/components/layout/mobile-chrome";
import { SidebarProvider } from "@/components/ui/sidebar";
import { currentUserQueryOptions } from "../../../lib/auth/queries";

export const Route = createFileRoute("/_authed/admin")({
  beforeLoad: async ({ context }) => {
    const user = await context.queryClient.ensureQueryData(
      currentUserQueryOptions(),
    );
    if (!user?.canOpenDeploymentAdmin) {
      throw redirect({ to: "/" });
    }
  },
  component: RouteComponent,
});

function RouteComponent() {
  return (
    <SidebarProvider
      className="h-svh overflow-hidden"
      /*
       * The same 340px the app and Settings use. A rail that changes width as you cross into admin
       * makes the whole frame look like it moved.
       */
      style={
        {
          "--sidebar-width": "340px",
          "--sidebar-width-mobile": "20rem",
        } as React.CSSProperties
      }
    >
      <AdminSidebar />
      <main className="flex min-h-0 flex-1 flex-col overflow-hidden" id="main">
        <MobileChrome title="Admin" />
        <div className="min-h-0 flex-1 overflow-y-auto">
          <Outlet />
        </div>
      </main>
    </SidebarProvider>
  );
}
