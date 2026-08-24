import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCorners,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { IconPlus } from "@tabler/icons-react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useReducedMotion } from "motion/react";
import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";
import { CrmEmpty, CrmError } from "@/components/crm/crm-ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  createCrmOpportunityMutationOptions,
  updateCrmOpportunityMutationOptions,
} from "@/lib/crm/mutations";
import {
  type CrmOpportunity,
  crmOpportunitiesQueryOptions,
} from "@/lib/crm/queries";
import {
  DEAL_STAGE_DEFS,
  DEFAULT_DEAL_STAGE,
  normalizeDealStage,
} from "@/lib/crm/stages";
import { cn } from "@/lib/utils";
import { queryClient } from "@/query-client";

const STAGES = DEAL_STAGE_DEFS.map((stage) => stage.key);

function formatUsd(amountCents?: number | null): string {
  if (amountCents == null || !Number.isFinite(amountCents)) return "—";
  const amount = amountCents / 100;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: amount >= 1000 ? 0 : 2,
  }).format(amount);
}

type Deal = {
  id: string;
  name: string;
  stageKey: string;
  amountCents: number | null;
  closeDate: string | null;
};

function asDeal(opportunity: CrmOpportunity): Deal {
  return {
    id: opportunity.id,
    name: opportunity.name,
    stageKey: String(normalizeDealStage(opportunity.stage)),
    amountCents: opportunity.amountCents,
    closeDate: opportunity.expectedCloseAt,
  };
}

export function DealBoard({ className }: { className?: string }) {
  const opportunities = useQuery(crmOpportunitiesQueryOptions());
  const createOpportunity = useMutation(
    createCrmOpportunityMutationOptions(queryClient),
  );
  const updateOpportunity = useMutation(
    updateCrmOpportunityMutationOptions(queryClient),
  );
  const shouldReduceMotion = useReducedMotion();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [visibleStage, setVisibleStage] = useState<string>(
    STAGES[0] ?? "qualify",
  );
  const boardRef = useRef<HTMLDivElement>(null);
  const jumpingTo = useRef<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor),
  );

  const deals = (opportunities.data?.items ?? []).map(asDeal);
  const byStage = new Map<string, Deal[]>();
  for (const stage of STAGES) byStage.set(stage, []);
  for (const deal of deals) {
    const key = STAGES.includes(deal.stageKey as (typeof STAGES)[number])
      ? deal.stageKey
      : DEFAULT_DEAL_STAGE;
    byStage.get(key)?.push(deal);
  }
  const activeDeal = activeId
    ? deals.find((deal) => deal.id === activeId)
    : null;

  const onBoardScroll = useCallback(() => {
    if (jumpingTo.current) return;
    const board = boardRef.current;
    if (!board) return;
    const columns = Array.from(
      board.querySelectorAll<HTMLElement>("[data-stage]"),
    );
    if (!columns.length) return;
    if (board.scrollLeft >= board.scrollWidth - board.clientWidth - 2) {
      const last = columns[columns.length - 1]?.dataset.stage;
      if (last) setVisibleStage(last);
      return;
    }
    const edge = board.getBoundingClientRect().left + 24;
    let current = columns[0]?.dataset.stage;
    for (const column of columns) {
      if (column.getBoundingClientRect().left <= edge) {
        current = column.dataset.stage;
      }
    }
    if (current) setVisibleStage(current);
  }, []);

  function scrollToStage(stage: string) {
    const board = boardRef.current;
    const column = board?.querySelector<HTMLElement>(`[data-stage="${stage}"]`);
    if (!board || !column) return;
    setVisibleStage(stage);
    jumpingTo.current = stage;
    board.scrollTo({
      left: column.offsetLeft - board.offsetLeft - 12,
      behavior: shouldReduceMotion ? "auto" : "smooth",
    });
  }

  function onDragStart(event: DragStartEvent) {
    setActiveId(String(event.active.id));
  }

  function onDragEnd(event: DragEndEvent) {
    setActiveId(null);
    const dealId = String(event.active.id);
    const overId = event.over?.id ? String(event.over.id) : null;
    if (!overId) return;
    const stageKey = overId.startsWith("stage:")
      ? overId.slice("stage:".length)
      : overId.startsWith("deal:")
        ? deals.find((deal) => deal.id === overId.slice("deal:".length))
            ?.stageKey
        : deals.find((deal) => deal.id === overId)?.stageKey;
    if (!stageKey || !STAGES.includes(stageKey as (typeof STAGES)[number])) {
      return;
    }
    const current = deals.find((deal) => deal.id === dealId);
    if (!current || current.stageKey === stageKey) return;
    void updateOpportunity
      .mutateAsync({ id: dealId, input: { stage: stageKey } })
      .catch(() => toast.error("Couldn’t move opportunity"));
  }

  async function createDeal() {
    if (!newName.trim()) return;
    try {
      await createOpportunity.mutateAsync({
        name: newName.trim(),
        stage: DEFAULT_DEAL_STAGE,
      });
      setNewName("");
      setShowCreate(false);
      toast.success("Opportunity created");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn’t create");
    }
  }

  if (opportunities.isPending) {
    return <div className={cn("min-h-0 flex-1", className)} />;
  }

  if (opportunities.error) {
    return (
      <CrmError
        label="opportunities"
        onRetry={() => void opportunities.refetch()}
      />
    );
  }

  return (
    <div className={cn("flex min-h-0 flex-1 flex-col", className)}>
      <div className="flex items-center justify-end gap-2 px-4 pb-3">
        {showCreate ? (
          <form
            className="flex flex-1 items-center gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              void createDeal();
            }}
          >
            <Input
              value={newName}
              onChange={(event) => setNewName(event.target.value)}
              placeholder="Opportunity name"
              aria-label="Opportunity name"
              className="max-w-sm"
            />
            <Button
              disabled={createOpportunity.isPending || !newName.trim()}
              size="sm"
              type="submit"
            >
              {createOpportunity.isPending ? "Saving…" : "Save"}
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
        ) : (
          <Button onClick={() => setShowCreate(true)} size="sm" variant="ghost">
            <IconPlus />
            New opportunity
          </Button>
        )}
      </div>

      {deals.length === 0 && !showCreate ? (
        <CrmEmpty
          title="No opportunities yet"
          description="Pipeline tracks money. Drag a card across stages, or use the keyboard."
          actionLabel="New opportunity"
          onAction={() => setShowCreate(true)}
        />
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCorners}
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
          onDragCancel={() => setActiveId(null)}
        >
          <div
            className="flex shrink-0 gap-1 overflow-x-auto px-4 pb-2"
            role="tablist"
            aria-label="Stages"
          >
            {DEAL_STAGE_DEFS.map((stage) => (
              <button
                key={stage.key}
                type="button"
                role="tab"
                aria-selected={visibleStage === stage.key}
                onClick={() => scrollToStage(stage.key)}
                className={cn(
                  "rounded-lg px-2.5 py-1.5 text-sm",
                  "focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
                  visibleStage === stage.key
                    ? "bg-muted text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {stage.label}
                <span className="ms-1.5 tabular-nums text-muted-foreground">
                  {(byStage.get(stage.key) || []).length}
                </span>
              </button>
            ))}
          </div>
          <div
            ref={boardRef}
            onScroll={onBoardScroll}
            onPointerDown={() => {
              jumpingTo.current = null;
            }}
            className="flex min-h-0 flex-1 gap-3 overflow-x-auto px-4 pb-4"
          >
            {DEAL_STAGE_DEFS.map((stage) => {
              const column = byStage.get(stage.key) || [];
              const total = column.reduce(
                (sum, deal) => sum + (deal.amountCents || 0),
                0,
              );
              return (
                <StageColumn
                  key={stage.key}
                  stage={stage.key}
                  label={stage.label}
                  deals={column}
                  total={total}
                />
              );
            })}
          </div>
          <DragOverlay dropAnimation={shouldReduceMotion ? null : undefined}>
            {activeDeal ? <DealCard deal={activeDeal} overlay /> : null}
          </DragOverlay>
        </DndContext>
      )}
    </div>
  );
}

function StageColumn({
  stage,
  label,
  deals,
  total,
}: {
  stage: string;
  label: string;
  deals: Deal[];
  total: number;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `stage:${stage}` });

  return (
    <section
      ref={setNodeRef}
      data-stage={stage}
      className="crm-board-col flex shrink-0 flex-col"
      aria-label={label}
    >
      <header className="mb-2 flex items-baseline justify-between gap-2 px-0.5">
        <div className="min-w-0">
          <h3 className="truncate font-bold text-sm tracking-tight">
            {label}
            <span className="ms-1.5 font-normal tabular-nums text-muted-foreground">
              {deals.length}
            </span>
          </h3>
          {total > 0 ? (
            <p className="mt-0.5 text-xs tabular-nums text-muted-foreground">
              {formatUsd(total)}
            </p>
          ) : null}
        </div>
      </header>
      <ul
        className={cn(
          "flex min-h-40 flex-1 flex-col gap-2 overflow-y-auto rounded-lg bg-muted p-1.5 transition-colors",
          isOver && "bg-accent",
        )}
      >
        {deals.length === 0 ? (
          <li className="flex flex-1 items-center justify-center px-2 py-6 text-muted-foreground text-sm">
            Drop here
          </li>
        ) : (
          deals.map((deal) => <DealCard key={deal.id} deal={deal} />)
        )}
      </ul>
    </section>
  );
}

function DealCard({ deal, overlay }: { deal: Deal; overlay?: boolean }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: deal.id,
    data: { stageKey: deal.stageKey },
  });
  const droppable = useDroppable({
    id: `deal:${deal.id}`,
    data: { stageKey: deal.stageKey },
    disabled: overlay,
  });

  return (
    <li
      ref={
        overlay
          ? undefined
          : (node) => {
              setNodeRef(node);
              droppable.setNodeRef(node);
            }
      }
      {...(overlay ? {} : { ...listeners, ...attributes })}
      className={cn(
        "list-none rounded-lg border border-border bg-card px-3 py-2.5",
        !overlay && "cursor-grab active:cursor-grabbing",
        isDragging && !overlay && "crm-deal-dragging opacity-40",
        overlay && "shadow-md",
      )}
    >
      <p className="truncate text-sm font-medium">{deal.name}</p>
      <div className="mt-1 flex items-center justify-between gap-2">
        <p className="text-sm font-medium tabular-nums text-muted-foreground">
          {formatUsd(deal.amountCents)}
        </p>
        {deal.closeDate ? (
          <p className="truncate text-xs tabular-nums text-muted-foreground">
            {new Date(deal.closeDate).toLocaleDateString(undefined, {
              month: "short",
              day: "numeric",
            })}
          </p>
        ) : null}
      </div>
    </li>
  );
}
