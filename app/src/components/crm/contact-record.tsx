import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { ContactNotes } from "@/components/crm/contact-notes";
import { ContactThread } from "@/components/crm/contact-thread";
import { RecordPage } from "@/components/crm/record-page";
import { crmControlClassName, CrmError } from "@/components/crm/crm-ui";
import {
  findOrCreateCrmCompany,
  updateCrmPersonMutationOptions,
} from "@/lib/crm/mutations";
import { crmPersonQueryOptions } from "@/lib/crm/queries";
import { CONTACT_STAGE_DEFS } from "@/lib/crm/stages";
import { queryClient } from "@/query-client";

export function ContactRecord({ personId }: { personId: string }) {
  const personQuery = useQuery(crmPersonQueryOptions(personId));
  const person = personQuery.data;
  const updatePerson = useMutation(updateCrmPersonMutationOptions(queryClient));
  const [movingStage, setMovingStage] = useState(false);

  if (personQuery.isPending) return null;
  if (personQuery.error || !person) {
    return (
      <CrmError
        label="this person"
        onRetry={() => void personQuery.refetch()}
      />
    );
  }
  const record = person;

  const extras = [
    { key: "title", label: "Title", value: record.jobTitle },
    { key: "phone", label: "Phone", value: record.phones[0] ?? null, inputType: "tel" as const },
    { key: "location", label: "Location", value: record.location },
    { key: "linkedinUrl", label: "LinkedIn", value: record.linkedinUrl, inputType: "url" as const },
  ].filter((field) => field.value);

  const details = [
    {
      key: "email",
      label: "Email",
      value: record.emails[0] ?? null,
      inputType: "email" as const,
    },
    { key: "companyName", label: "Company", value: record.company?.name },
    ...extras,
  ];

  async function saveField(key: string, value: string) {
    try {
      if (key === "email") {
        await updatePerson.mutateAsync({
          id: record.id,
          input: { emails: value ? [value] : [] },
        });
        return;
      }
      if (key === "phone") {
        await updatePerson.mutateAsync({
          id: record.id,
          input: { phones: value ? [value] : [] },
        });
        return;
      }
      if (key === "title") {
        await updatePerson.mutateAsync({
          id: record.id,
          input: { jobTitle: value || null },
        });
        return;
      }
      if (key === "companyName") {
        if (!value) {
          await updatePerson.mutateAsync({
            id: record.id,
            input: { companyId: null },
          });
          return;
        }
        const company = await findOrCreateCrmCompany(value);
        await updatePerson.mutateAsync({
          id: record.id,
          input: { companyId: company.id },
        });
        return;
      }
      if (key === "location" || key === "linkedinUrl") {
        await updatePerson.mutateAsync({
          id: record.id,
          input: { [key]: value || null },
        });
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn’t save");
      throw err;
    }
  }

  async function moveStage(stageKey: string) {
    if (stageKey === record.stageKey) return;
    setMovingStage(true);
    try {
      await updatePerson.mutateAsync({
        id: record.id,
        input: { stageKey, doNotContact: stageKey === "dnc" },
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn’t move");
    } finally {
      setMovingStage(false);
    }
  }

  return (
    <RecordPage
      details={details}
      about={record.notes}
      stageControl={
        <label className="flex min-w-0 flex-col gap-1.5">
          <span className="text-xs text-muted-foreground">Stage</span>
          <select
            className={crmControlClassName}
            value={record.stageKey}
            disabled={movingStage}
            onChange={(event) => void moveStage(event.target.value)}
            aria-label="Stage"
          >
            {CONTACT_STAGE_DEFS.map((stage) => (
              <option key={stage.key} value={stage.key}>
                {stage.label}
              </option>
            ))}
          </select>
        </label>
      }
      timeline={<ContactThread personId={record.id} />}
      notesPanel={<ContactNotes personId={record.id} />}
      onSaveField={saveField}
    />
  );
}
