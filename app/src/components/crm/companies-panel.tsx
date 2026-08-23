import { useMutation, useQuery } from "@tanstack/react-query";
import { Building2, Calendar, Globe2, MapPin, Plus } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { createCrmCompanyMutationOptions } from "@/lib/crm/mutations";
import { crmCompaniesQueryOptions } from "@/lib/crm/queries";
import { queryClient } from "@/query-client";

function companyInitials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return (parts[0] ?? "?").slice(0, 2).toUpperCase();
  return `${parts[0]?.[0] || ""}${parts[1]?.[0] || ""}`.toUpperCase();
}

function logoHue(name: string) {
  let hue = 0;
  for (let i = 0; i < name.length; i++) hue = (hue * 31 + name.charCodeAt(i)) % 360;
  return hue;
}

export function CompaniesPanel({
  search,
  createOpen,
  onCreateOpenChange,
}: {
  search?: string;
  createOpen?: boolean;
  onCreateOpenChange?: (open: boolean) => void;
}) {
  const companiesQuery = useQuery(crmCompaniesQueryOptions(search ?? ""));
  const createCompany = useMutation(createCrmCompanyMutationOptions(queryClient));
  const [name, setName] = useState("");
  const [domain, setDomain] = useState("");
  const [internalCreate, setInternalCreate] = useState(false);

  const companies = companiesQuery.data?.items ?? [];

  const showCreate = createOpen ?? internalCreate;
  function setShowCreate(open: boolean) {
    if (onCreateOpenChange) onCreateOpenChange(open);
    else setInternalCreate(open);
  }

  async function saveCompany() {
    if (!name.trim()) return;
    try {
      await createCompany.mutateAsync({
        name: name.trim(),
        domain: domain.trim() || undefined,
      });
      setName("");
      setDomain("");
      setShowCreate(false);
      toast.success("Company created");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn’t create company");
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {showCreate ? (
        <div className="flex flex-wrap items-center gap-2 border-b border-[#f0f0f0] px-4 py-2">
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Company name"
            className="ui-crm-search min-w-[10rem] flex-1 px-2.5 text-13"
            onKeyDown={(event) => {
              if (event.key === "Enter") void saveCompany();
              if (event.key === "Escape") setShowCreate(false);
            }}
          />
          <input
            value={domain}
            onChange={(event) => setDomain(event.target.value)}
            placeholder="domain.com"
            className="ui-crm-search w-[10rem] px-2.5 text-13"
            onKeyDown={(event) => {
              if (event.key === "Enter") void saveCompany();
            }}
          />
          <button
            type="button"
            disabled={createCompany.isPending || !name.trim()}
            onClick={() => void saveCompany()}
            className="ui-twenty-new-btn disabled:opacity-50"
          >
            Save
          </button>
          <button
            type="button"
            onClick={() => setShowCreate(false)}
            className="ui-twenty-link-btn"
          >
            Cancel
          </button>
        </div>
      ) : null}

      {companiesQuery.isPending ? (
        <div className="min-h-0 flex-1" />
      ) : companiesQuery.error ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 p-10 text-center">
          <p className="text-14 font-medium text-[var(--text)]">
            Couldn’t load companies
          </p>
          <p className="max-w-xs text-13 text-[var(--text-secondary)]">
            Check your connection and try again.
          </p>
          <button
            type="button"
            onClick={() => void companiesQuery.refetch()}
            className="ui-crm-retry mt-2"
          >
            Try again
          </button>
        </div>
      ) : companies.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 p-10 text-center">
          <p className="text-14 font-medium text-[var(--text)]">No companies yet</p>
          <p className="max-w-xs text-13 text-[var(--text-secondary)]">
            Add accounts you sell into — people and opportunities link here.
          </p>
          <button
            type="button"
            onClick={() => setShowCreate(true)}
            className="ui-twenty-new-btn mt-2"
          >
            <Plus className="h-3.5 w-3.5" />
            New company
          </button>
        </div>
      ) : (
        <div className="ui-crm-index-scroll min-h-0 min-w-0 flex-1 overflow-auto">
          <table className="ui-crm-table ui-crm-table-twenty">
            <thead>
              <tr>
                <th className="w-10 !ps-3 !pe-0">
                  <input
                    type="checkbox"
                    aria-label="Select all"
                    className="ui-twenty-check"
                  />
                </th>
                <th>
                  <span className="inline-flex items-center gap-1.5">
                    <Building2 className="h-3.5 w-3.5 opacity-55" strokeWidth={1.75} />
                    Companies
                  </span>
                </th>
                <th>
                  <span className="inline-flex items-center gap-1.5">
                    <Globe2 className="h-3.5 w-3.5 opacity-55" strokeWidth={1.75} />
                    Url
                  </span>
                </th>
                <th className="ui-crm-col-meta">Industry</th>
                <th className="ui-crm-col-aux">
                  <span className="inline-flex items-center gap-1.5">
                    <MapPin className="h-3.5 w-3.5 opacity-55" strokeWidth={1.75} />
                    Address
                  </span>
                </th>
                <th className="ui-crm-col-aux">
                  <span className="inline-flex items-center gap-1.5">
                    <Calendar className="h-3.5 w-3.5 opacity-55" strokeWidth={1.75} />
                    Added
                  </span>
                </th>
              </tr>
            </thead>
            <tbody>
              {companies.map((company) => {
                const hue = logoHue(company.name);
                return (
                  <tr key={company.id}>
                    <td className="w-10 ps-3 pe-0">
                      <input
                        type="checkbox"
                        className="ui-twenty-check"
                        aria-label={`Select ${company.name}`}
                      />
                    </td>
                    <td>
                      <div className="flex min-w-0 items-center gap-2">
                        <span
                          className="ui-crm-company-mark"
                          style={{
                            background: `oklch(0.94 0.04 ${hue})`,
                            color: `oklch(0.35 0.08 ${hue})`,
                          }}
                        >
                          {companyInitials(company.name)}
                        </span>
                        <span
                          className="truncate text-[13px] font-medium text-[#171717]"
                          title={company.name}
                        >
                          {company.name}
                        </span>
                      </div>
                    </td>
                    <td>
                      {company.domain ? (
                        <span className="ui-crm-pill">{company.domain}</span>
                      ) : null}
                    </td>
                    <td className="ui-crm-col-meta text-[13px] text-[#555]">
                      {company.industry || ""}
                    </td>
                    <td className="ui-crm-col-aux max-w-[14rem] truncate text-[13px] text-[#555]">
                      {company.phone || ""}
                    </td>
                    <td className="ui-crm-col-aux text-[13px] text-[#555]">
                      {company.createdAt
                        ? new Date(company.createdAt).toLocaleDateString(
                            undefined,
                            {
                              month: "short",
                              day: "numeric",
                              year: "numeric",
                            },
                          )
                        : ""}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <ul className="ui-crm-cards">
            {companies.map((company) => {
              const hue = logoHue(company.name);
              return (
                <li key={company.id} className="ui-crm-card">
                  <div className="ui-crm-card-open">
                    <span className="ui-crm-card-name">
                      <span
                        className="ui-crm-company-mark"
                        style={{
                          background: `oklch(0.94 0.04 ${hue})`,
                          color: `oklch(0.35 0.08 ${hue})`,
                        }}
                        aria-hidden
                      >
                        {companyInitials(company.name)}
                      </span>
                      <span>{company.name}</span>
                    </span>
                    <span
                      className={`ui-crm-card-line${company.domain ? "" : " ui-crm-card-empty"}`}
                    >
                      {company.domain || "No website"}
                    </span>
                    {company.industry || company.phone ? (
                      <span className="ui-crm-card-meta">
                        {company.industry ? (
                          <span className="ui-crm-pill">
                            <span>{company.industry}</span>
                          </span>
                        ) : null}
                        {company.phone ? (
                          <span className="ui-crm-pill">
                            <span>{company.phone}</span>
                          </span>
                        ) : null}
                      </span>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
