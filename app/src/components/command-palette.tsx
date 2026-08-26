import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { currentUserQueryOptions } from "@/lib/auth/queries";
import {
  type ChannelSummary,
  channelListQueryOptions,
} from "@/lib/channels/queries";
import { goalEmptyKind, normalizeGoalQuery } from "@/lib/channels/search";

/**
 * Cmd-K / Ctrl-K. Goals are the customer door. “Rooms” is the operator door
 * and only lists when See the work is allowed.
 */
export function CommandPalette() {
  const { data: currentUser } = useQuery(currentUserQueryOptions());
  const canSeeTheWork = currentUser?.canSeeTheWork === true;
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setQuery(normalizeGoalQuery(search)), 250);
    return () => clearTimeout(timer);
  }, [search]);
  const channels = useInfiniteQuery(channelListQueryOptions({ search: query }));

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (
        !(event.metaKey || event.ctrlKey) ||
        event.key.toLowerCase() !== "k"
      ) {
        return;
      }
      event.preventDefault();
      setOpen((current) => !current);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const goals = channels.data ?? [];
  const emptyKind = goalEmptyKind({
    pending: channels.isPending,
    placeholder: channels.isPlaceholderData,
    exiting: false,
    rowCount: goals.length,
    query,
    status: "all",
  });

  const go = (goal: ChannelSummary, work: boolean) => {
    setOpen(false);
    setSearch("");
    setQuery("");
    void navigate({
      params: { channelId: goal.id },
      search: work ? { work: true } : {},
      to: "/channel/$channelId",
    });
  };

  return (
    <Dialog
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          setSearch("");
          setQuery("");
        }
      }}
      open={open}
    >
      <DialogContent className="max-w-lg p-4" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Jump</DialogTitle>
        </DialogHeader>
        <DialogBody className="mt-2 overflow-y-auto">
          <Input
            aria-label="Search goals"
            autoFocus
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search goals…"
            value={search}
          />
          {channels.isPending ? null : channels.error ? (
            <p className="mt-3 text-sm text-destructive" role="alert">
              Could not load goals.
            </p>
          ) : (
            <>
              <section className="mt-3">
                <h3 className="px-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Goals
                </h3>
                {emptyKind === "no-goals" ? (
                  <p className="px-1 py-2 text-sm text-muted-foreground">
                    You don't have goals yet.
                  </p>
                ) : emptyKind === "no-matches" ? (
                  <p className="px-1 py-2 text-sm text-muted-foreground">
                    No goals match.
                  </p>
                ) : goals.length === 0 ? null : (
                  <ul className="mt-1">
                    {goals.map((goal) => (
                      <li key={`goal-${goal.id}`}>
                        <button
                          className="w-full rounded-md px-2 py-1.5 text-left text-sm hover:bg-foreground/5"
                          onClick={() => go(goal, false)}
                          type="button"
                        >
                          <span className="block truncate">{goal.name}</span>
                          <span className="block text-[12px] text-muted-foreground">
                            {goal.goalStatus}
                            {goal.lastAction ? ` · ${goal.lastAction}` : ""}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
              {canSeeTheWork ? (
                <section className="mt-4">
                  <h3 className="px-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Rooms
                  </h3>
                  {emptyKind === "no-goals" ? (
                    <p className="px-1 py-2 text-sm text-muted-foreground">
                      You don't have rooms yet.
                    </p>
                  ) : emptyKind === "no-matches" ? (
                    <p className="px-1 py-2 text-sm text-muted-foreground">
                      No rooms match.
                    </p>
                  ) : goals.length === 0 ? null : (
                    <ul className="mt-1">
                      {goals.map((goal) => (
                        <li key={`room-${goal.id}`}>
                          <button
                            className="w-full rounded-md px-2 py-1.5 text-left text-sm hover:bg-foreground/5"
                            onClick={() => go(goal, true)}
                            type="button"
                          >
                            <span className="block truncate">{goal.name}</span>
                            <span className="block text-[12px] text-muted-foreground">
                              See the work
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              ) : null}
            </>
          )}
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
