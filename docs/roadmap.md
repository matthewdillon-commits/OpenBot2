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

---

## Phase 1 — Unattended runs

**Send-and-go.** A person starts work and leaves. The worker finishes it.

The entry is a server function, not a new chat protocol:

```ts
startUnattendedRun({ actor, orgId, channelId, threadId, prompt })
```

It writes a job. The `worker` process claims with `FOR UPDATE SKIP LOCKED` and
runs the coworker against the **same Intelligence thread** the channel already
uses. Reopen the channel: the result is there. That is the definition of done.
Close the tab, walk away, come back to the same channel.

Scope for this phase only:

- Built-in coworkers **and** one remote AG-UI coworker.
- Tools: CRM, web search, company knowledge, granted MCP. The same list
  `loadToolsForActor` already runs on the API.
- **No** computer tools. **No** Stripe. **No** inbound email.

What must not happen: a second way to store the transcript, a job that starts
a new thread when the channel already has one, or a worker that takes computer
work this phase cannot finish without the tab.

## Phase 2 — Computer on the server, and a pause

Move click / type / snapshot / files / shell onto the server so an unattended
run can use them. When the coworker needs a person (login, 2FA, a secret, a
high-risk confirm), the job **pauses** (`needs-you`) instead of dying with the
tab.

**Supervisor before a second org gets a browser.** One Chromium for the whole
image is acceptable for one trusted team. It is not a boundary between
customers. Do not give a second organization a computer until
`COMPUTER_SUPERVISOR_URL` is how computers are made — one computer per org×bot.

## Phase 3 — Cron, then webhook, then inbound email

The same runner as Phase 1, with the tools Phase 2 made server-side.

Order matters:

1. **Cron** — a standing prompt on a schedule, into a known channel / thread.
2. **Webhook** — an external system starts the same job.
3. **Inbound email** — a message arrives, the runner starts, the reply is
   work, not a new product.

Do not invent a second execution path per trigger. If it cannot be
`startUnattendedRun` (or the same job row), it is not this phase.

## Phase 4 — Orchestrator and specialized workers

The person talks to the manager. The manager delegates to workers:

- Sales
- Website
- Marketing
- Customer
- Operations

A2A rooms and sub-agents exist so a finite chunk of work can leave the
orchestrator and come back. Shared CRM context is the rule: the same customer
fact is visible to every agent in the org.

**Do not merge PR #11.** Rooms, sub-agents, schedules, and inbound in that
stack are not the implementation. Reimplement cleanly on the Phase 1–3 runner
and the gateway.

Later verticals (mortgage, home services, commerce) are playbooks on this
shape, not a new orchestrator.

## Phase 5 — Measure and improve

Close the loop in [product.md](product.md):

- Outcome events tied to the actions that caused them.
- Approval cards for high-risk work: rationale, expected impact, before/after,
  rollback.
- Keep / revise / revert, and a record the next prioritization can read.

Low-risk actions may still auto-run under the gateway. High-risk actions wait.
The audit trail already stores permit / refuse. This phase stores *whether it
worked*.

## Phase 6 — SaaS

What Part B of `product.md` lists as missing:

- Postgres RLS (query-scoped `org_id` is not enough)
- Stripe and seats
- Invite email (today the token is JSON only)
- Per-org SSO
- Spend caps
- OpenTelemetry
- Multi-replica as a stated property of every new surface, not an accident of
  using Postgres

Until this phase, the honest offer is still a sales-led or single-company
deployment. `/platform` stays provisioning, not checkout.

---

## What this roadmap is not

It is not a menu, a new route, or an API you can call in this tree. It is not
permission to describe Phase 4 coworkers as shipping because the YAML could
name them. It is not permission to take PR #11.

When a phase lands, update [product.md](product.md) Part B with the file that
proves it, and shrink Part C.
