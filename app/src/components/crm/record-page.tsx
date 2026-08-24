import { type ReactNode, useState } from "react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export type RecordDetailField = {
  key: string;
  label: string;
  value?: string | null;
  inputType?: "text" | "email" | "tel" | "url";
};

export type RecordPageProps = {
  details: RecordDetailField[];
  about?: string | null;
  stageControl?: ReactNode;
  timeline?: ReactNode;
  notesPanel?: ReactNode;
  onSaveField?: (key: string, value: string) => Promise<void>;
};

function FieldCell({
  field,
  onSaveField,
}: {
  field: RecordDetailField;
  onSaveField?: (key: string, value: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(field.value ?? "");
  const [busy, setBusy] = useState(false);

  async function commit() {
    if (!onSaveField) {
      setEditing(false);
      return;
    }
    const next = draft.trim();
    if (next === (field.value || "").trim()) {
      setEditing(false);
      return;
    }
    setBusy(true);
    try {
      await onSaveField(field.key, next);
      setEditing(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-w-0">
      <p className="text-xs text-muted-foreground">{field.label}</p>
      <div className="mt-1 min-w-0">
        {editing && onSaveField ? (
          <Input
            type={field.inputType ?? "text"}
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
                setDraft(field.value ?? "");
                setEditing(false);
              }
            }}
            aria-label={field.label}
            className="h-8"
          />
        ) : (
          <button
            type="button"
            disabled={!onSaveField}
            onClick={() => {
              setDraft(field.value ?? "");
              setEditing(true);
            }}
            className={cn(
              "min-w-0 truncate text-left text-sm",
              field.value ? "font-medium" : "text-muted-foreground",
              onSaveField &&
                "rounded-md focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
            )}
          >
            {field.value || "Add"}
          </button>
        )}
      </div>
    </div>
  );
}

export function RecordPage({
  details,
  about,
  stageControl,
  timeline,
  notesPanel,
  onSaveField,
}: RecordPageProps) {
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 pb-6">
      <div className="flex flex-col gap-5">
        {stageControl}

        <section className="flex flex-col gap-3">
          {details.map((field) => (
            <FieldCell
              key={field.key}
              field={field}
              onSaveField={onSaveField}
            />
          ))}
        </section>

        {about ? (
          <p className="max-w-prose text-pretty text-sm leading-relaxed">
            {about}
          </p>
        ) : null}

        {notesPanel}
        {timeline}
      </div>
    </div>
  );
}
