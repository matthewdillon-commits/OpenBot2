import { useMutation, useQuery } from "@tanstack/react-query";
import { Mail, Maximize2, MessageSquare, Phone, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { stageLabel, stageStyle } from "@/lib/crm/colors";
import {
  createCrmSendMutationOptions,
  updateCrmPersonMutationOptions,
} from "@/lib/crm/mutations";
import { type CrmPerson, crmSendsQueryOptions } from "@/lib/crm/queries";
import { CONTACT_STAGE_DEFS } from "@/lib/crm/stages";
import { cn } from "@/lib/utils";
import { queryClient } from "@/query-client";

export function ContactPreview({
  person,
  fullscreen,
  onToggleFullscreen,
  onClose,
}: {
  person: CrmPerson;
  fullscreen: boolean;
  onToggleFullscreen: () => void;
  onClose: () => void;
}) {
  const updatePerson = useMutation(updateCrmPersonMutationOptions(queryClient));
  const createSend = useMutation(createCrmSendMutationOptions(queryClient));
  const sends = useQuery(crmSendsQueryOptions("", "", person.id));
  const [compose, setCompose] = useState<"email" | "sms" | "call" | null>(null);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const stage = stageStyle(person.stageKey);

  async function saveField(
    input: Parameters<typeof updatePerson.mutateAsync>[0]["input"],
  ) {
    try {
      await updatePerson.mutateAsync({ id: person.id, input });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn’t save");
      throw err;
    }
  }

  async function send() {
    const address =
      compose === "email" ? person.emails[0] : person.phones[0] || person.emails[0];
    if (!address) {
      toast.error("Add an email or phone first");
      return;
    }
    try {
      await createSend.mutateAsync({
        kind: compose === "call" ? "call" : compose === "sms" ? "sms" : "email",
        toAddress: address,
        subject: subject.trim() || null,
        body: body.trim() || null,
        personId: person.id,
      });
      setCompose(null);
      setSubject("");
      setBody("");
      toast.success(compose === "call" ? "Call logged" : "Sent");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn’t send");
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-[var(--bg-solid)]">
      <header className="flex min-h-12 shrink-0 items-center gap-2 border-b border-[var(--hairline)] px-3">
        <p className="min-w-0 flex-1 truncate text-14 font-medium text-[var(--text)]">
          {person.name}
        </p>
        <button
          type="button"
          onClick={onToggleFullscreen}
          aria-label={fullscreen ? "Exit full record" : "Open full record"}
          className="inline-flex h-11 w-11 items-center justify-center rounded-[8px] text-[var(--text-secondary)] hover:bg-[var(--bg-muted)]"
        >
          <Maximize2 className="h-4 w-4" strokeWidth={1.75} />
        </button>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close record"
          className="inline-flex h-11 w-11 items-center justify-center rounded-[8px] text-[var(--text-secondary)] hover:bg-[var(--bg-muted)]"
        >
          <X className="h-4 w-4" strokeWidth={1.75} />
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-3.5 py-3">
        <div className="mb-3 flex flex-wrap items-center gap-1.5">
          <span
            className="inline-flex items-center gap-1.5 rounded-[6px] px-2 py-0.5 text-11 font-medium"
            style={{ background: stage.soft, color: stage.solid }}
          >
            {stageLabel(person.stageKey)}
          </span>
          {person.doNotContact ? (
            <span className="rounded-[6px] bg-[oklch(0.63_0.22_28/0.1)] px-2 py-0.5 text-11 font-medium text-[oklch(0.475_0.194_28)]">
              DNC
            </span>
          ) : null}
        </div>

        <label className="mb-3 block">
          <span className="mb-1 block text-12 font-medium text-[var(--text-muted)]">
            Stage
          </span>
          <select
            value={person.stageKey}
            disabled={updatePerson.isPending}
            onChange={(event) => {
              void saveField({
                stageKey: event.target.value,
                doNotContact: event.target.value === "dnc",
              });
            }}
            className="ui-crm-select h-10 min-h-10 w-full !rounded-[8px] text-13"
          >
            {CONTACT_STAGE_DEFS.map((item) => (
              <option key={item.key} value={item.key}>
                {item.label}
              </option>
            ))}
          </select>
        </label>

        <InlineField
          label="Name"
          value={person.name}
          required
          onSave={(next) => saveField({ name: next })}
        />
        <InlineField
          label="Email"
          value={person.emails[0] ?? ""}
          inputType="email"
          placeholder="name@company.com"
          onSave={(next) => saveField({ emails: next ? [next] : [] })}
        />
        <InlineField
          label="Phone"
          value={person.phones[0] ?? ""}
          inputType="tel"
          placeholder="Phone"
          onSave={(next) => saveField({ phones: next ? [next] : [] })}
        />
        <InlineField
          label="Job title"
          value={person.jobTitle ?? ""}
          placeholder="Job title"
          onSave={(next) => saveField({ jobTitle: next || null })}
        />
        <InlineField
          label="Company"
          value={person.company?.name ?? ""}
          placeholder="Company"
          onSave={async () => undefined}
        />

        <div className="mt-4 flex flex-wrap gap-1.5">
          <button
            type="button"
            onClick={() => setCompose("email")}
            className="ui-twenty-new-btn"
          >
            <Mail className="h-3.5 w-3.5" strokeWidth={2} />
            Email
          </button>
          <button
            type="button"
            onClick={() => setCompose("sms")}
            className="ui-twenty-link-btn !h-8"
          >
            <MessageSquare className="h-3.5 w-3.5" />
            SMS
          </button>
          <button
            type="button"
            onClick={() => setCompose("call")}
            className="ui-twenty-link-btn !h-8"
          >
            <Phone className="h-3.5 w-3.5" />
            Call
          </button>
        </div>

        {compose ? (
          <div className="mt-3 space-y-2 rounded-[10px] border border-[var(--hairline)] p-3">
            {compose === "email" ? (
              <input
                value={subject}
                onChange={(event) => setSubject(event.target.value)}
                placeholder="Subject"
                className="h-9 w-full rounded-[8px] border border-[var(--hairline)] px-2.5 text-13 outline-none"
              />
            ) : null}
            <textarea
              value={body}
              onChange={(event) => setBody(event.target.value)}
              placeholder={compose === "call" ? "Call notes" : "Message"}
              rows={4}
              className="w-full rounded-[8px] border border-[var(--hairline)] px-2.5 py-2 text-13 outline-none"
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setCompose(null)}
                className="ui-twenty-link-btn"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={createSend.isPending}
                onClick={() => void send()}
                className="ui-btn !h-8"
              >
                {createSend.isPending
                  ? "Sending…"
                  : compose === "call"
                    ? "Log call"
                    : "Send"}
              </button>
            </div>
          </div>
        ) : null}

        <div className="mt-5">
          <p className="text-12 font-medium text-[var(--text-muted)]">Messages</p>
          {sends.isPending ? null : (sends.data?.items ?? []).length === 0 ? (
            <p className="mt-2 text-13 text-[var(--text-muted)]">
              Nothing sent yet
            </p>
          ) : (
            <ul className="mt-2 space-y-2">
              {(sends.data?.items ?? []).map((sendItem) => (
                <li
                  key={sendItem.id}
                  className="rounded-[8px] bg-[var(--bg-muted)] px-2.5 py-2"
                >
                  <p className="text-12 font-medium text-[var(--text)]">
                    {sendItem.subject || sendItem.kind}
                  </p>
                  <p className="mt-0.5 text-11 text-[var(--text-muted)]">
                    {sendItem.body || sendItem.toAddress}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

function InlineField({
  label,
  value,
  placeholder,
  required,
  inputType = "text",
  onSave,
}: {
  label: string;
  value: string;
  placeholder?: string;
  required?: boolean;
  inputType?: "text" | "email" | "tel";
  onSave: (next: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  async function commit() {
    const next = draft.trim();
    if (required && !next) {
      setEditing(false);
      toast.error("Name required");
      return;
    }
    if (next === (value || "").trim()) {
      setEditing(false);
      return;
    }
    setBusy(true);
    try {
      await onSave(next);
      setSaved(true);
      window.setTimeout(() => setSaved(false), 1400);
      setEditing(false);
    } catch {
      setDraft(value);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mb-3">
      <span className="mb-1 flex min-h-4 items-center justify-between gap-2 text-12 font-medium text-[var(--text-muted)]">
        {label}
        {saved ? (
          <span className="font-normal text-[var(--accent-live)]">Saved</span>
        ) : null}
      </span>
      {editing ? (
        <input
          type={inputType}
          value={draft}
          disabled={busy}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={() => void commit()}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              void commit();
            } else if (event.key === "Escape") {
              event.preventDefault();
              setDraft(value);
              setEditing(false);
            }
          }}
          placeholder={placeholder}
          className="h-10 min-h-10 w-full rounded-[8px] bg-[var(--bg-muted)] px-2.5 text-13 text-[var(--text)] outline-none ring-1 ring-transparent transition-[box-shadow] duration-[var(--duration-quick)] focus:ring-[var(--accent)] disabled:opacity-60"
          aria-label={label}
        />
      ) : (
        <button
          type="button"
          onClick={() => {
            setDraft(value);
            setEditing(true);
          }}
          className={cn(
            "flex h-10 min-h-10 w-full items-center rounded-[8px] px-2.5 text-left text-13 transition-colors duration-[var(--duration-quick)] hover:bg-[var(--bg-muted)]",
            value ? "text-[var(--text)]" : "text-[var(--text-muted)]",
          )}
        >
          {value || placeholder || "—"}
        </button>
      )}
    </div>
  );
}
