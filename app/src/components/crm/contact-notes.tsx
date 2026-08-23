import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { createCrmConversationMutationOptions } from "@/lib/crm/mutations";
import { crmConversationsQueryOptions } from "@/lib/crm/queries";
import { queryClient } from "@/query-client";

export function ContactNotes({ personId }: { personId: string }) {
  const notes = useQuery(crmConversationsQueryOptions("", personId));
  const createNote = useMutation(
    createCrmConversationMutationOptions(queryClient),
  );
  const [draft, setDraft] = useState("");
  const rows = (notes.data?.items ?? []).filter(
    (row) => row.channel === "note" || !row.channel,
  );

  async function addNote() {
    const text = draft.trim();
    if (!text) return;
    try {
      await createNote.mutateAsync({
        subject: text.slice(0, 80) || "Note",
        channel: "note",
        body: text,
        personId,
      });
      setDraft("");
      toast.success("Note saved");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn’t save note");
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <textarea
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        placeholder="Add a note about this person…"
        rows={3}
        onKeyDown={(event) => {
          if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
            event.preventDefault();
            void addNote();
          }
        }}
        className="w-full resize-none rounded-[12px] border border-[var(--hairline)] bg-[var(--bg-solid)] px-3 py-2.5 text-13 leading-relaxed text-[var(--text)] outline-none transition-[border-color] duration-[var(--duration-quick)] focus:border-[var(--text-muted)]"
      />
      <div className="flex justify-end">
        <button
          type="button"
          disabled={createNote.isPending || !draft.trim()}
          onClick={() => void addNote()}
          className="ui-btn inline-flex h-8 !min-h-0 items-center !rounded-full !px-3 text-12 disabled:opacity-40"
        >
          {createNote.isPending ? "Saving…" : "Save note"}
        </button>
      </div>

      {notes.isPending ? null : notes.error ? (
        <p className="text-13 text-[var(--text-muted)]">
          Couldn’t load notes.{" "}
          <button
            type="button"
            onClick={() => void notes.refetch()}
            className="font-medium text-[var(--text)] underline underline-offset-2"
          >
            Try again
          </button>
        </p>
      ) : rows.length === 0 ? (
        <p className="text-13 text-[var(--text-muted)]">No notes yet.</p>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {rows.map((note) => (
            <li
              key={note.id}
              className="rounded-[12px] bg-[var(--bg-muted)] px-3.5 py-3"
            >
              <p className="whitespace-pre-wrap text-13 leading-relaxed text-[var(--text)]">
                {note.body || note.subject}
              </p>
              <p className="mt-1.5 text-11 text-[var(--text-muted)]">
                {new Date(note.occurredAt || note.createdAt).toLocaleString(
                  undefined,
                  {
                    month: "short",
                    day: "numeric",
                    hour: "numeric",
                    minute: "2-digit",
                  },
                )}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
