export function LinkedInMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      aria-hidden
      fill="currentColor"
    >
      <path d="M20.45 20.45h-3.55v-5.57c0-1.33-.02-3.04-1.85-3.04-1.85 0-2.14 1.45-2.14 2.94v5.67H9.36V9h3.41v1.56h.05c.47-.9 1.63-1.85 3.36-1.85 3.6 0 4.27 2.37 4.27 5.46v6.28zM5.34 7.43a2.06 2.06 0 1 1 0-4.12 2.06 2.06 0 0 1 0 4.12zM7.12 20.45H3.56V9h3.56v11.45zM22.22 0H1.77C.79 0 0 .77 0 1.73v20.54C0 23.23.79 24 1.77 24h20.45c.98 0 1.78-.77 1.78-1.73V1.73C24 .77 23.2 0 22.22 0z" />
    </svg>
  );
}

export function BotMark() {
  return (
    <span className="ui-twenty-bot" aria-hidden>
      <svg viewBox="0 0 16 16" width="14" height="14" fill="none" aria-hidden>
        <rect
          x="2.5"
          y="4.5"
          width="11"
          height="9"
          rx="2.5"
          stroke="currentColor"
          strokeWidth="1.25"
        />
        <circle cx="6" cy="9" r="1" fill="currentColor" />
        <circle cx="10" cy="9" r="1" fill="currentColor" />
        <path
          d="M8 2.5v2"
          stroke="currentColor"
          strokeWidth="1.25"
          strokeLinecap="round"
        />
        <circle cx="8" cy="2" r="1" fill="currentColor" />
      </svg>
    </span>
  );
}

export function faviconDomainFromContact(contact: {
  email?: string | null;
  companyName?: string | null;
  companyDomain?: string | null;
}): string | null {
  if (contact.companyDomain?.trim()) {
    return contact.companyDomain.trim().toLowerCase();
  }
  const host = contact.email?.split("@")[1]?.trim().toLowerCase();
  if (
    host &&
    !["gmail.com", "yahoo.com", "hotmail.com", "outlook.com", "icloud.com"].includes(
      host,
    )
  ) {
    return host;
  }
  const company = contact.companyName?.trim().toLowerCase();
  if (!company) return null;
  const slug = company.replace(/[^a-z0-9]+/g, "");
  if (!slug) return null;
  return `${slug}.com`;
}

export function formatRelativeCreated(value?: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  const diffMs = Date.now() - date.getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} minute${mins === 1 ? "" : "s"} ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} day${days === 1 ? "" : "s"} ago`;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function personInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  if (parts.length === 1) return (parts[0] ?? "?").slice(0, 2).toUpperCase();
  const first = parts[0]?.[0] ?? "";
  const last = parts[parts.length - 1]?.[0] ?? "";
  return `${first}${last}`.toUpperCase() || "?";
}

export function avatarHue(name: string): number {
  let hue = 0;
  for (let i = 0; i < name.length; i += 1) {
    hue = (hue * 31 + name.charCodeAt(i)) >>> 0;
  }
  return hue % 360 || 140;
}
