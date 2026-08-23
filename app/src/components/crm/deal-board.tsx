import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCorners,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";
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
  const [activeId, setActiveId] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [visibleStage, setVisibleStage] = useState<string>(STAGES[0] ?? "qualify");
  const boardRef = useRef<HTMLDivElement>(null);
  const jumpingTo = useRef<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 3 } }),
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
  const activeDeal = activeId ? deals.find((deal) => deal.id === activeId) : null;

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
      behavior: "smooth",
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

  if (opportunities.isPending) return <div className={cn("min-h-0 flex-1", className)} />;

  if (opportunities.error) {
    return (
      <div
        className={cn(
          "flex min-h-0 flex-1 items-center justify-center p-8",
          className,
        )}
      >
        <div className="max-w-sm text-center">
          <p className="text-14 font-medium text-[var(--text)]">
            Couldn’t load opportunities
          </p>
          <p className="mt-1.5 text-13 text-[var(--text-secondary)]">
            Check your connection and try again.
          </p>
          <button
            type="button"
            onClick={() => void opportunities.refetch()}
            className="ui-crm-retry mt-3"
          >
            Try again
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={cn("flex min-h-0 flex-1 flex-col", className)}>
      <div className="flex items-center justify-end gap-2 border-b border-[var(--hairline)] px-3 py-2">
        {showCreate ? (
          <div className="flex flex-1 items-center gap-2">
            <input
              value={newName}
              onChange={(event) => setNewName(event.target.value)}
              placeholder="Opportunity name"
              className="ui-crm-search min-w-0 flex-1 px-2.5 text-13"
              onKeyDown={(event) => {
                if (event.key === "Enter") void createDeal();
                if (event.key === "Escape") setShowCreate(false);
              }}
            />
            <button
              type="button"
              disabled={createOpportunity.isPending || !newName.trim()}
              onClick={() => void createDeal()}
              className="ui-btn h-8 !min-h-0 !rounded-[8px] !px-2.5 text-12"
            >
              Save
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setShowCreate(true)}
            className="ui-btn inline-flex h-8 !min-h-0 items-center gap-1.5 !rounded-[8px] !px-2.5 text-12"
          >
            <Plus className="h-3.5 w-3.5" />
            New
          </button>
        )}
      </div>

      {deals.length === 0 && !showCreate ? (
        <div className="flex flex-1 items-center justify-center p-8">
          <div className="max-w-sm text-center">
            <p className="text-14 font-medium text-[var(--text)]">
              No opportunities yet
            </p>
            <p className="mt-1.5 text-13 text-[var(--text-secondary)]">
              Pipeline tracks money — drag cards across stages as deals move.
            </p>
            <button
              type="button"
              onClick={() => setShowCreate(true)}
              className="ui-btn mt-3 inline-flex h-8 items-center gap-1.5 !rounded-[8px] !px-3 text-12"
            >
              <Plus className="h-3.5 w-3.5" />
              New opportunity
            </button>
          </div>
        </div>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCorners}
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
          onDragCancel={() => setActiveId(null)}
        >
          <div className="ui-crm-board-pager" role="tablist" aria-label="Stages">
            {DEAL_STAGE_DEFS.map((stage) => (
              <button
                key={stage.key}
                type="button"
                role="tab"
                aria-selected={visibleStage === stage.key}
                data-active={visibleStage === stage.key}
                onClick={() => scrollToStage(stage.key)}
                className="ui-crm-board-pager-item"
              >
                {stage.label}
                <span>{(byStage.get(stage.key) || []).length}</span>
              </button>
            ))}
          </div>
          <div
            ref={boardRef}
            onScroll={onBoardScroll}
            onPointerDown={() => {
              jumpingTo.current = null;
            }}
            onTouchStart={() => {
              jumpingTo.current = null;
            }}
            onWheel={() => {
              jumpingTo.current = null;
            }}
            className="ui-crm-board flex min-h-0 flex-1 gap-3 overflow-x-auto px-3 pb-3 pt-2"
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
          <DragOverlay dropAnimation={null}>
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
      className="ui-crm-board-col flex shrink-0 flex-col"
      aria-label={label}
    >
      <header className="mb-2 flex items-baseline justify-between gap-2 px-0.5">
        <div className="min-w-0">
          <h3 className="truncate text-12 font-medium text-[var(--text)]">
            {label}
            <span className="ms-1.5 tabular-nums text-[var(--text-muted)]">
              {deals.length}
            </span>
          </h3>
          {total > 0 ? (
            <p className="mt-0.5 text-11 tabular-nums text-[var(--text-muted)]">
              {formatUsd(total)}
            </p>
          ) : null}
        </div>
      </header>
      <ul
        className={cn(
          "flex min-h-[160px] flex-1 flex-col gap-2 overflow-y-auto rounded-[12px] bg-[var(--bg-muted)] p-1.5 transition-colors",
          isOver && "bg-[oklch(0.94_0.02_250)]",
        )}
      >
        {deals.length === 0 ? (
          <li className="flex flex-1 items-center justify-center px-2 py-6 text-12 text-[var(--text-muted)]">
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
        "list-none rounded-[10px] border border-[var(--hairline)] bg-[var(--bg-solid)] px-3 py-2.5 shadow-[0_1px_0_oklch(0_0_0/0.03)]",
        !overlay && "cursor-grab active:cursor-grabbing",
        isDragging && !overlay && "opacity-40",
        overlay && "shadow-md",
      )}
    >
      <p className="truncate text-13 font-medium tracking-[-0.01em] text-[var(--text)]">
        {deal.name}
      </p>
      <div className="mt-1 flex items-center justify-between gap-2">
        <p className="text-12 tabular-nums font-medium text-[var(--text-secondary)]">
          {formatUsd(deal.amountCents)}
        </p>
        {deal.closeDate ? (
          <p className="truncate text-11 text-[var(--text-muted)]">
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
