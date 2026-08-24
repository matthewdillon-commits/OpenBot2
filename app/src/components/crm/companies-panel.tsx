import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { CrmEmpty, CrmError } from "@/components/crm/crm-ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createCrmCompanyMutationOptions } from "@/lib/crm/mutations";
import { crmCompaniesQueryOptions } from "@/lib/crm/queries";
import { queryClient } from "@/query-client";

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
  const createCompany = useMutation(
    createCrmCompanyMutationOptions(queryClient),
  );
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
      toast.error(
        err instanceof Error ? err.message : "Couldn’t create company",
      );
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {showCreate ? (
        <form
          className="flex flex-wrap items-center gap-2 px-4 pb-3"
          onSubmit={(event) => {
            event.preventDefault();
            void saveCompany();
          }}
        >
          <Input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Company name"
            aria-label="Company name"
            className="min-w-40 flex-1"
          />
          <Input
            value={domain}
            onChange={(event) => setDomain(event.target.value)}
            placeholder="domain.com"
            aria-label="Company domain"
            className="w-40"
          />
          <Button
            disabled={createCompany.isPending || !name.trim()}
            size="sm"
            type="submit"
          >
            {createCompany.isPending ? "Saving…" : "Save"}
          </Button>
          <Button
            onClick={() => setShowCreate(false)}
            size="sm"
            type="button"
            variant="ghost"
          >
            Cancel
          </Button>
        </form>
      ) : null}

      {companiesQuery.isPending ? null : companiesQuery.error ? (
        <CrmError
          label="companies"
          onRetry={() => void companiesQuery.refetch()}
        />
      ) : companies.length === 0 ? (
        <CrmEmpty
          title="No companies yet"
          actionLabel="New company"
          onAction={() => setShowCreate(true)}
        />
      ) : (
        <div className="min-h-0 flex-1 overflow-auto px-4 pb-6">
          <table className="crm-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Website</th>
              </tr>
            </thead>
            <tbody>
              {companies.map((company) => (
                <tr key={company.id} className="cursor-default">
                  <td>
                    <span className="truncate font-medium" title={company.name}>
                      {company.name}
                    </span>
                  </td>
                  <td className="text-muted-foreground">
                    {company.domain || "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
