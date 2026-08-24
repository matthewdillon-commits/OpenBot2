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
import { useMutation, useQuery } from "@tanstack/react-query";
import { useReducedMotion } from "motion/react";
import { useState } from "react";
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
  if (amountCents == null || !Number.isFinite(amountCents)) return "";
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
};

function asDeal(opportunity: CrmOpportunity): Deal {
  return {
    id: opportunity.id,
    name: opportunity.name,
    stageKey: String(normalizeDealStage(opportunity.stage)),
    amountCents: opportunity.amountCents,
  };
}

export function DealBoard({
  createOpen,
  onCreateOpenChange,
}: {
  createOpen?: boolean;
  onCreateOpenChange?: (open: boolean) => void;
}) {
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
  const [internalCreate, setInternalCreate] = useState(false);
  const showCreate = createOpen ?? internalCreate;

  function setShowCreate(open: boolean) {
    if (onCreateOpenChange) onCreateOpenChange(open);
    else setInternalCreate(open);
  }

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
    return <div className="min-h-0 flex-1" />;
  }

  if (opportunities.error) {
    return (
      <CrmError
        label="opportunities"
        error={opportunities.error.message}
        onRetry={() => void opportunities.refetch()}
      />
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {showCreate ? (
        <form
          className="flex items-center gap-2 px-4 pb-3"
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
            autoFocus
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
      ) : null}

      {deals.length === 0 && !showCreate ? (
        <CrmEmpty
          title="No opportunities yet"
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
          <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto px-4 pb-4">
            {DEAL_STAGE_DEFS.map((stage) => (
              <StageColumn
                key={stage.key}
                stage={stage.key}
                label={stage.label}
                deals={byStage.get(stage.key) || []}
              />
            ))}
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
}: {
  stage: string;
  label: string;
  deals: Deal[];
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `stage:${stage}` });

  return (
    <section
      ref={setNodeRef}
      data-stage={stage}
      className="crm-board-col flex shrink-0 flex-col"
      aria-label={label}
    >
      <h3 className="mb-2 truncate px-0.5 font-medium text-sm">
        {label}
        <span className="ms-1.5 font-normal tabular-nums text-muted-foreground">
          {deals.length}
        </span>
      </h3>
      <ul
        className={cn(
          "flex min-h-40 flex-1 flex-col gap-2 overflow-y-auto rounded-lg bg-muted p-1.5 transition-colors",
          isOver && "bg-accent",
        )}
      >
        {deals.map((deal) => (
          <DealCard key={deal.id} deal={deal} />
        ))}
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
  const amount = formatUsd(deal.amountCents);

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
      {amount ? (
        <p className="mt-1 text-sm tabular-nums text-muted-foreground">
          {amount}
        </p>
      ) : null}
    </li>
  );
}
