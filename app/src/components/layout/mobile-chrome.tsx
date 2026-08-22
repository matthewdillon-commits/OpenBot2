import { SidebarTrigger } from "@/components/ui/sidebar";

/**
 * The bar a phone needs to open the sidebar.
 *
 * The desktop rail is always visible. On a narrow screen it becomes a sheet, and nothing
 * opened that sheet until this control existed.
 */
export function MobileChrome({ title }: { title: string }) {
  return (
    <div className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-2 md:hidden">
      <SidebarTrigger />
      <span className="truncate text-sm font-medium tracking-tight">
        {title}
      </span>
    </div>
  );
}
