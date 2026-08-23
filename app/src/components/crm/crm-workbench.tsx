import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Menu, Users, X } from "lucide-react";
import { useState } from "react";
import { Toaster } from "sonner";
import { avatarHue, personInitials } from "@/components/crm/crm-marks";
import { agentListQueryOptions } from "@/lib/agents/queries";
import { currentUserQueryOptions } from "@/lib/auth/queries";
import { appConfig } from "@/lib/generated/application-config";
import { cn } from "@/lib/utils";

function BrandMark({ size = 16 }: { size?: number }) {
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-[4px] bg-[color:var(--t-color-blue)] font-semibold leading-none text-white"
      style={{ width: size, height: size, fontSize: Math.max(9, size - 6) }}
      aria-hidden
    >
      L
    </span>
  );
}

function NavAvatar({
  name,
  fill,
  className,
}: {
  name: string;
  fill?: string;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full font-semibold text-white",
        className,
      )}
      style={{
        background: fill ?? `oklch(0.62 0.14 ${avatarHue(name)})`,
      }}
      aria-hidden
    >
      {personInitials(name).slice(0, 1)}
    </span>
  );
}

function CrmNav({ onNavigate }: { onNavigate?: () => void }) {
  const user = useQuery(currentUserQueryOptions());
  const agents = useQuery(agentListQueryOptions());
  const orgName = user.data?.orgName || appConfig.brand.productName;
  const displayName = user.data?.name || user.data?.email || "Account";
  const coworkers = agents.data ?? [];

  return (
    <nav className="wb-nav" aria-label="Primary">
      <div className="wb-nav-brand-row">
        <Link
          to="/"
          className="wb-nav-brand"
          title="Workspace"
          onClick={onNavigate}
        >
          <BrandMark size={16} />
          <span className="wb-nav-brand-label">{orgName}</span>
        </Link>
      </div>

      <div className="wb-nav-scroll">
        <div className="wb-nav-stack">
          <Link to="/" className="wb-nav-parent" onClick={onNavigate}>
            <span className="wb-nav-agent-lead">
              <NavAvatar
                name="Chief of Staff"
                fill="oklch(0.66 0.22 25)"
                className="h-4 w-4 text-[8px]"
              />
            </span>
            <span className="wb-nav-label">Chief of Staff</span>
          </Link>
          {agents.isPending ? (
            <p className="wb-nav-empty">Loading agents</p>
          ) : coworkers.length === 0 ? (
            <p className="wb-nav-empty">No agents yet</p>
          ) : (
            coworkers.map((agent) => (
              <Link
                key={agent.id}
                to="/agents"
                search={{ agent: agent.id }}
                className="wb-nav-parent"
                title={agent.name}
                onClick={onNavigate}
              >
                <span className="wb-nav-agent-lead">
                  <NavAvatar name={agent.name} className="h-4 w-4 text-[8px]" />
                </span>
                <span className="wb-nav-label">{agent.name}</span>
              </Link>
            ))
          )}
        </div>
      </div>

      <div className="wb-nav-footer">
        <Link
          to="/crm"
          className="wb-nav-parent"
          data-active="true"
          aria-current="true"
        >
          <Users className="wb-nav-icon" strokeWidth={1.75} aria-hidden />
          <span className="wb-nav-label">CRM</span>
        </Link>
        <Link
          to="/settings"
          className="wb-nav-you"
          aria-label="Account"
          onClick={onNavigate}
        >
          <NavAvatar
            name={displayName}
            className="wb-person-avatar wb-nav-you-avatar text-[11px]"
          />
          <span className="wb-nav-you-copy">
            <span className="wb-nav-you-name">{displayName}</span>
            <span className="wb-nav-you-meta">{orgName}</span>
          </span>
        </Link>
      </div>
    </nav>
  );
}

export function CrmWorkbench({ children }: { children: React.ReactNode }) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  return (
    <div
      className="lai2-crm wb"
      data-mobile-nav={mobileNavOpen ? "true" : "false"}
    >
      <Toaster position="bottom-right" theme="light" />
      <div className="wb-titlebar md:hidden">
        <button
          type="button"
          className="wb-nav-icon-btn"
          aria-label={mobileNavOpen ? "Close navigation" : "Open navigation"}
          onClick={() => setMobileNavOpen((open) => !open)}
        >
          {mobileNavOpen ? (
            <X strokeWidth={1.6} aria-hidden />
          ) : (
            <Menu strokeWidth={1.6} aria-hidden />
          )}
        </button>
        <span className="wb-titlebar-label">CRM</span>
      </div>

      {mobileNavOpen ? (
        <div className="wb-nav-drawer md:hidden">
          <button
            type="button"
            aria-label="Close navigation"
            className="wb-nav-drawer-scrim"
            onClick={() => setMobileNavOpen(false)}
          />
          <div className="wb-nav-sheet">
            <CrmNav onNavigate={() => setMobileNavOpen(false)} />
          </div>
        </div>
      ) : null}

      <div className="wb-nav-desktop">
        <CrmNav />
      </div>
      <div className="wb-stage">
        <div className="wb-stage-body">
          <div className="wb-main">
            <main className="wb-editor relative min-w-0">{children}</main>
          </div>
        </div>
      </div>
    </div>
  );
}
