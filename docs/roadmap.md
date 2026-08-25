# Roadmap

How this tree climbs from late Stage 1 / early Stage 2 to the product in
[product.md](product.md) Part A. **This file is the sequence. The code is other
pull requests.** Nothing here is in the running software unless Part B of
`product.md` says so with a citation.

Do not merge or cherry-pick [PR #11](https://github.com/matthewdillon-commits/OpenBot2/pull/11)
(or the stacked PRs it combines). Reimplement cleanly when a phase needs that
shape.

Each phase is shippable on its own. Do not skip ahead of the runner: cron
without unattended runs is a clock that cannot start work; an orchestrator
without a runner is a manager with no workers who stay on the job.

**Home = goals + one brain. Rooms = how the system works. Approval cards =
how the company keeps the wheel. Do not invert that.**

---

## UX contract

Locked in [product.md](product.md) Part A. Repeated here so a phase cannot
quietly become a five-bot sidebar. Nothing below is in the running software
unless Part B of `product.md` says so.

**Customer home** (first screen after login): Composer to LimitlessAI at the
top. Under it, Goals — not chats, not agents. Each row: name, status, last
action, time. Empty state: “What should the business get done?” Owner talks
only to LimitlessAI. Opening a goal opens that goal’s thread with the
orchestrator, not a worker.

Phase 1 statuses only: Active | Needs you | Done. Last action is one
sentence. No loop-stage chrome until Phase 5.

**Operator door:** Do NOT put Sales / Website / Marketing / Customer / Ops
in the owner nav. The room is behind the goal: a secondary control “See the
work” (role-gated: operator / admin). That opens the A2A room for THIS goal:
orchestrator + specialists it spawned, computers, traces. Cmd-K “Rooms” is
fine for power users. First-run never tours the roster.

**Goal object**

- Phase 1 skinny: id, name (plain language), status, last_action,
  last_action_at, created_by. One Intelligence thread per goal, shared with
  the owner’s LimitlessAI chat.
- Phase 5 adds on the SAME object (not a new surface): expected_impact,
  outcome (worked / didn’t / unknown), approval card (rationale,
  before/after, rollback), keep | revise | revert.

Do not show a typical owner: agent roster or family names as nav; empty
specialist channels; live computer / Activity / tool traces; MCP,
credentials, policy, CEL, audit; model names; platform admin; OpenBot
leftovers (Knowledge, Risk Analyst, General Assistant) as first-class
coworkers; A2A rooms unless they opened “See the work.”

---

## Phase 0 — Source of truth (done)

On `main`. [product.md](product.md) is the contract: Part A is the product,
Part B is what this tree does, Part C is what it is not. This file is the
sequence. The running software is late Stage 1 / early Stage 2 as Part B
describes. Later phases are other pull requests.

## Phase 1 — Unattended runs

**Send-and-go.** A person starts work and leaves. The worker finishes it.

The home this phase ships toward is Composer to LimitlessAI + Goals. The
owner talks only to LimitlessAI. Opening a goal opens that goal’s thread
with the orchestrator, not a worker.

The entry is a server function, not a new chat protocol:

```ts
startUnattendedRun({ actor, orgId, goalId, threadId, prompt })
```

It writes a job on a **goal**. The `worker` process claims with
`FOR UPDATE SKIP LOCKED` and runs LimitlessAI against the **same
Intelligence thread** that goal already uses. Reopen the goal: the result
is there. That is the definition of done. Close the tab, walk away, come
back to the same goal.

**Skinny job/goal outcome — not the full loop.** Status + last action only.
Statuses: Active | Needs you | Done. Last action is one sentence. Goal
fields this phase: id, name (plain language), status, last_action,
last_action_at, created_by. One Intelligence thread per goal, shared with
the owner’s LimitlessAI chat. When the job finishes and we know an outcome,
record that skinny status + last action (job succeeded, a CRM row was
written, or a reply or booking is known). This is not Phase 5, not
loop-stage chrome, and not an experimentation platform.

Scope for this phase only:

- LimitlessAI, the orchestrator. Not a roster of named worker families.
- Tools: CRM, web search, company knowledge, granted MCP. The same list
  `loadToolsForActor` already runs on the API.
- **No** computer tools. **No** Stripe. **No** inbound email.

What must not happen: a second way to store the transcript, a job that starts
a new thread when the goal already has one, or a worker that takes computer
work this phase cannot finish without the tab. Do not show a typical owner
the roster, family names as nav, or OpenBot leftovers (Knowledge, Risk
Analyst, General Assistant) as first-class coworkers.

## Phase 2 — Computer on the server, and a pause

Move click / type / snapshot / files / shell onto the server so an unattended
run can use them. When the coworker needs a person (login, 2FA, a secret, a
high-risk confirm), the job **pauses** (`needs-you`) instead of dying with the
tab.

**Supervisor before a second org gets a browser.** One Chromium for the whole
image is acceptable for one trusted team. It is not a boundary between
customers. Do not give a second organization a computer until
`COMPUTER_SUPERVISOR_URL` is how computers are made — one computer per org×bot.

When a computer job finishes and we know an outcome, record the same skinny
status + last action Phase 1 already records. A pause is **Needs you** on
the goal. Still not Phase 5. No loop-stage chrome.

## Phase 3 — Cron, then webhook, then inbound email

The same runner as Phase 1, with the tools Phase 2 made server-side.

Order matters:

1. **Cron** — a standing prompt on a schedule, into a known goal / thread.
2. **Webhook** — an external system starts the same job.
3. **Inbound email** — a message arrives, the runner starts, the reply is
   work, not a new product.

Do not invent a second execution path per trigger. If it cannot be
`startUnattendedRun` (or the same job row), it is not this phase.

## Phase 4 — One orchestrator, specialists on demand

One orchestrator + specialists on demand (skills/playbooks + sub-agents +
A2A rooms). Two doors. Do not stand up named worker families as the product.

**Customer door.** Composer to LimitlessAI. Goals under it. Owner talks only
to LimitlessAI. Opening a goal opens that goal’s thread with the
orchestrator, not a worker. Do NOT put Sales / Website / Marketing /
Customer / Ops in the owner nav. First-run never tours the roster.

**Operator door.** The room is behind the goal: a secondary control “See the
work” (role-gated: operator / admin). That opens the A2A room for THIS goal:
orchestrator + specialists it spawned, computers, traces. Cmd-K “Rooms” is
fine for power users. A typical owner does not see A2A rooms unless they
opened “See the work.”

Specialists are not the first screen. They come in when the orchestrator
needs them — a skill or playbook, a sub-agent a parent starts (including
one with a computer), or a member of that goal’s room. Shared CRM context
is the rule: the same customer fact is visible to every agent in the org.

**Do not merge PR #11.** Rooms, sub-agents, schedules, and inbound in that
stack are not the implementation. Reimplement cleanly on the Phase 1–3 runner
and the gateway.

Later verticals (mortgage, home services, commerce) are playbooks on this
shape, not a new orchestrator.

## Phase 5 — Measure and improve

Close the loop on the **same goal object**. Not a new surface.

Phase 5 adds: expected_impact, outcome (worked / didn’t / unknown),
approval card (rationale, before/after, rollback), keep | revise | revert.

Low-risk actions may still auto-run under the gateway. High-risk actions
wait. The audit trail already stores permit / refuse. This phase stores
*whether it worked*. Approval cards are how the company keeps the wheel.

Phase 1 skinny status + last action is not this phase. Loop-stage chrome
on the goal (home row / goal thread / approval card) belongs here, never
as a new owner nav.

## Phase 6 — SaaS

Landed. Part B cites RLS, Stripe checkout and seats, invite email, per-org
SSO, spend caps, OpenTelemetry, and multi-replica (Postgres / Stripe / OTel,
no in-process Map). `/platform` remains for superadmins; checkout is the
owner path. Home is still Composer + Goals. Rooms stay behind See the work.
Approval cards stay on the goal.

Honest leftovers, still in Part C: persist onto the Intelligence thread
fails closed; one `TENANT_PACKAGE_DIR` for the process; a shared Chromium
refuses a second org until `COMPUTER_SUPERVISOR_URL`.

---

## What this roadmap is not

It is not a menu, a new route, or an API you can call in this tree. It is not
permission to stand up named worker families as the product, or to put
Sales / Website / Marketing / Customer / Ops in the owner nav. It is not
permission to take PR #11. Do not invert home / rooms / approval cards.

When a phase lands, update [product.md](product.md) Part B with the file that
proves it, and shrink Part C.
