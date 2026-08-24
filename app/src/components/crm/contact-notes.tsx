import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
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
      <Textarea
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        placeholder="Add a note about this person…"
        rows={3}
        aria-label="New note"
        onKeyDown={(event) => {
          if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
            event.preventDefault();
            void addNote();
          }
        }}
      />
      <div className="flex justify-end">
        <Button
          disabled={createNote.isPending || !draft.trim()}
          onClick={() => void addNote()}
          size="sm"
        >
          {createNote.isPending ? "Saving…" : "Save note"}
        </Button>
      </div>

      {notes.isPending ? null : notes.error ? (
        <p className="text-muted-foreground text-sm">
          Couldn’t load notes.{" "}
          <button
            type="button"
            onClick={() => void notes.refetch()}
            className="font-medium text-foreground underline underline-offset-2"
          >
            Try again
          </button>
        </p>
      ) : rows.length === 0 ? (
        <p className="text-muted-foreground text-sm">No notes yet.</p>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {rows.map((note) => (
            <li key={note.id} className="rounded-lg bg-muted px-3.5 py-3">
              <p className="whitespace-pre-wrap text-pretty text-sm leading-relaxed">
                {note.body || note.subject}
              </p>
              <p className="mt-1.5 text-muted-foreground text-xs tabular-nums">
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
