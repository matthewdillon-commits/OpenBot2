# LimitlessAI

This file is the contract. **Part A** is the product: what LimitlessAI is for, how it
is supposed to work, and what must stay true as the code grows. **Part B** is what a
deployment of *this tree* actually does today. **Part C** is what it is not yet.
Do not treat Part A as a description of the running software.

The sign-in surface is the one at `os.limitlessai.ca/login`. The name on the chrome
comes from the tenant package (`product_name: LimitlessAI`).

CopilotKit Runtime and Intelligence are how a turn is executed and how a thread
survives a restart. They are the conversation layer. They are not the product, and
the README of the OpenBot tree this started from is not a description of what this
code is for.

---

## A. What this product is

LimitlessAI is not a bot builder. Agents are the workers. The product is the
intelligence and coordination layer above them: **one business brain → many
specialized agents**.

**Positioning.** LimitlessAI connects a company’s data, AI agents, and people into
one intelligence layer that understands what is happening, takes the next best
action, measures the result, and continuously improves how the business operates.

**Tagline.** The operating system for self-improving businesses.

**Simplest version.** Other AI agents do work. LimitlessAI learns which work
actually moves the business forward — and gets better every time it does it.

### The loop

```text
OBSERVE → UNDERSTAND → PRIORITIZE → ACT → MEASURE → IMPROVE
```

That loop is the product. A coworker that answers a question and forgets the
outcome is a worker. LimitlessAI is the layer that saw the situation, chose the
action, recorded what happened, and used that to choose better next time.

### Governed self-improving

The signature concept is a **governed** self-improving loop: see, test, approve,
learn. Low-risk actions may auto-run. High-risk actions become approval cards
with rationale, expected impact, before/after, and rollback. The company keeps
the wheel. The system still learns from what was approved, revised, or reverted.

This is not “let the agents loose.” It is “let the agents propose and act inside
a policy the company can read, and keep the outcome so the next proposal is
better.”

### UX contract

**Home = goals + one brain. Rooms = how the system works. Approval cards =
how the company keeps the wheel. Do not invert that.**

This section is the locked customer surface. How we climb to it is
[roadmap.md](roadmap.md). Nothing here is in the running software unless
Part B says so.

#### Customer home

First screen after login: Composer to LimitlessAI at the top. Under it,
Goals — not chats, not agents. Each row: name, status, last action, time.
Empty state: “What should the business get done?” Owner talks only to
LimitlessAI. Opening a goal opens that goal’s thread with the orchestrator,
not a worker.

Phase 1 statuses only: Active | Needs you | Done. Last action is one
sentence. No loop-stage chrome until Phase 5.

#### Operator door

Do NOT put Sales / Website / Marketing / Customer / Ops in the owner nav.
The room is behind the goal: a secondary control “See the work”
(role-gated: operator / admin). That opens the A2A room for THIS goal:
orchestrator + specialists it spawned, computers, traces. Cmd-K “Rooms” is
fine for power users. First-run never tours the roster.

#### Goal object

Phase 1 skinny: id, name (plain language), status, last_action,
last_action_at, created_by. One Intelligence thread per goal, shared with
the owner’s LimitlessAI chat.

Phase 5 adds on the SAME object (not a new surface): expected_impact,
outcome (worked / didn’t / unknown), approval card (rationale, before/after,
rollback), keep | revise | revert.

#### What a typical owner does not see

Do not show a typical owner:

- agent roster or family names as nav
- empty specialist channels
- live computer / Activity / tool traces
- MCP, credentials, policy, CEL, audit
- model names
- platform admin
- OpenBot leftovers (Knowledge, Risk Analyst, General Assistant) as
  first-class coworkers
- A2A rooms unless they opened “See the work.”

The owner talks only to LimitlessAI. Specialists are workers the
orchestrator starts on demand — skills/playbooks, a sub-agent, members of
an A2A room. They are not the product and not items in the owner nav.

Later verticals sit on the same brain: mortgage, home services, commerce.
They are playbooks and tools on the shared context, not a second product.

### Architecture (this stack)

Shaped like a Grok Bot: a manager the person talks to, workers underneath, a
shared context, tools that actually act. Built on this tree, not on a vendor
runtime as the product. Do not stand up named worker families as the
product.

- **Orchestrator.** LimitlessAI — the one brain the owner addresses. It
  prioritizes and delegates. Opening a goal is a thread with this
  orchestrator, not a worker.
- **Goals.** The unit the owner sees. Composer + goal list on home. One
  Intelligence thread per goal, shared with the owner’s LimitlessAI chat.
- **Specialists on demand.** Skills/playbooks, a sub-agent a parent starts
  (including one with a computer), or members of an A2A room for that goal.
  Not a five-bot sidebar. Not Sales / Website / Marketing / Customer / Ops
  in the owner nav.
- **Rooms.** How the system works. Behind “See the work” on the goal
  (operator / admin), or Cmd-K “Rooms” for power users. First-run never
  tours the roster.
- **Shared business context.** Org CRM, knowledge, Intelligence threads,
  campaign and outcome history. The same customer fact is visible to every
  agent in the org. Two specialists must not hold two different truths
  about one person.
- **Tool router and gateway.** Every acting call: resolve → policy → audit →
  act (or refuse and name the rule). Computer per org×bot when the supervisor
  is on. The gateway is the only way a worker reaches a computer, a file, CRM,
  MCP, or the public web. A typical owner does not see MCP, credentials,
  policy, CEL, or the audit trail.
- **Swappable models.** OpenAI, Anthropic, Google, xAI, or any OpenAI-compatible
  host via `OPENAI_BASE_URL`. Do not lock the product to one vendor. A typical
  owner does not see model names.
- **Conversation layer.** CopilotKit Runtime + Intelligence stay the turn and
  the thread. They are not the product name, the loop, or the moat.
- **Execution.** APIs, MCP/Composio, browser/computer, files. Live computer /
  Activity / tool traces are the operator door, not home.
- **Memory.** Org profile, brand, docs, CRM, and long-term state in
  Intelligence + Postgres.
- **Permissions, observability, vertical playbooks.** Who may act, what was
  done, and the industry-shaped default for how to do it. Platform admin is
  not an owner surface.

### What is defensible

Not the agent code. Anyone can stand up a Bot.

The moat is **outcome data**, **integrations**, **industry playbooks**,
**governance**, **cross-channel orchestration**, and **measured learning**. The
company that has run the loop longest has the best prior for what to do next.
That does not live in a system prompt.

### Evolution

| Stage | What it means |
| --- | --- |
| 1. Individual agents | A person talks to one Bot. The Bot has tools. The org is a backdrop. |
| 2. Connected agents | Several agents, org-scoped context, rooms, shared CRM. Still a person starts the turn. |
| 3. Intelligence + action | The layer understands the book, prioritizes, and acts without waiting for a chat send. |
| 4. Self-improving business | Measure and improve are closed. The loop compounds. |

Code in this tree is **late Stage 1 / early Stage 2**, with measure and
improve closed on the **same goal object**: a high-risk permit waits as an
approval card; the owner keep / revise / revert; the goal stores
expected_impact and outcome; the next orchestrator turn sees that decision.
Self-serve SaaS exists (RLS, Stripe seats, invite email, per-org SSO, spend
caps, traces). The first composer turn and the first unattended job open the
mapped Intelligence thread through CopilotRuntime. How we climb the rest is
[roadmap.md](roadmap.md).

---

## B. What a deployment does today

A signed-in person works in one organization at a time. They talk to coworkers
in channels (one lead, up to eight in a room), keep people and deals in `/crm`,
connect Gmail and the rest through `/plugins`, and an administrator governs
computers, credentials, MCP, and the action policy.

Every acting call still goes through the gateway: resolve, decide against the
live policy, write an audit row, then act or refuse. CRM writes, web search,
company knowledge, MCP, and computer actions are the same rule.

Conversations are durable. CopilotKit Intelligence holds the thread. Reopening
a channel shows what was said, including after a process restart.

**Send-and-go** starts an unattended job on that same channel. The owner-facing
unit is a goal: in this tree a goal is the existing channel plus its
Intelligence thread. `startUnattendedRun` may take `goalId`; it must be that
channel. A second transcript is not minted. The API inserts a `jobs` row; the
`worker` claims it with `FOR UPDATE SKIP LOCKED` and runs the coworker with
the same server tools an open-tab turn uses: CRM, `search_web`, knowledge,
granted MCP, and computer tools when the gateway is configured and the
browser is on. **Cron**, **webhook**, and **inbound email** enqueue that same
row from a standing org-scoped config (actor, goal/channel, thread, coworker,
prompt). A missing mapping is a refuse — enqueue does not invent a second
thread id. A mapped id that Intelligence has not seen yet is opened on the
first composer turn and the first unattended job through the same
CopilotRuntime path a tab turn uses (`getOrCreateThread` then
`runtime.runner.run`). A second job attaches to that same id. Persist is
true when `getThread` / `getThreadMessages` on that thread include the user
prompt and the assistant result. The client has no `appendMessages`; guessed
HTTP POSTs are not used. The job row is not a second transcript: prompt plus a skinny
`resultText` / outcome only. The job row stores a skinny outcome: status
Active | Needs you | Done, `last_action` (one
sentence), `last_action_at`, plus who ran and any CRM record ids the write
already returned. That is not an approval card. **Phase 5** stores whether
the work moved the business on that same goal: `channels.loop` holds
expected_impact, outcome (worked / didn't / unknown), the approval card
(rationale, before/after, rollback), and keep | revise | revert. High-risk
writes (CRM create/update/send, computer write/run, MCP writes) wait after
the gateway permits them, instead of silently acting. Low-risk reads still
auto-run. The owner answers the card on that goal. The next orchestrator
turn is told the last decision and outcome.

**Two doors.** Home is Composer to LimitlessAI plus Goals (the existing
channel list: name, Active | Needs you | Done, last action, time). Opening a
goal talks to the orchestrator, not a worker. The orchestrator starts a
finite specialist with `start_specialist` (a skill/playbook or a coworker,
including one with a computer). That call enqueues via `enqueueUnattendedJob`
on the same runner. Specialists share the organization’s CRM. “See the work”
(deployment admin, or org owner/admin) opens the A2A room for this goal:
members, jobs, computers, traces. Cmd-K Rooms is the same door for power
users. A typical owner does not see Sales / Website / Marketing / Customer /
Ops, leftover coworker names, or Agents in the nav. Skills and Plugins stay
in the owner rail. CRM is the org book, not an agent roster. Deployment-wide
`/admin` is platform superadmin / `INITIAL_ADMIN_EMAILS`, not an org owner.
Raw tool traces belong behind See the work. A typical owner does not see
rooms unless they opened See the work. First-run does not tour the roster.

### How a coworker actually runs

A turn usually starts because someone sent a message in the open app. Channel
chat uses the CopilotKit browser client. **Send-and-go** is the other start
from the composer: an explicit “continue this channel after I leave.” **Cron**,
**webhook**, and **inbound email** are the same start without the tab: each
resolves a stored actor / org / goal / thread / coworker and inserts the same
`jobs` row (`enqueueUnattendedJob` → `jobStore.enqueue`). The worker claims
it with `FOR UPDATE SKIP LOCKED` and calls `startUnattendedRun`. There is no
second runner. A specialist the orchestrator starts is that same insert.
A standing role is a system prompt on the next user turn.

Once a turn has started — in the tab or from a claimed job:

- **Server tools run on the API.** CRM (`crm_search`, `crm_get`, `crm_create`,
  `crm_update`, `crm_send`), `search_web` when `TAVILY_API_KEY` is set, company
  knowledge when there are documents, granted MCP tools, and computer tools
  (`computer_navigate`, snapshot, click, type, files, shell, help, secret)
  when the computer gateway is configured and the browser is on. Built-in
  Bots may take twenty of those steps in one run. A remote AG-UI Bot calls
  the same list back through `/api/agent-tools/call`. An unattended job uses
  this same list.
- **The watch tab renders computer tools; it does not execute them.** Click,
  type, snapshot, files, and the shell go through `ComputerGateway` on the
  server. The open tab paints the watch pane and Activity lines. Close it and
  the coworker still acts. Human-in-the-loop (login, 2FA, a secret) asks on
  the computer, persists `jobs.needs_you`, notifies the channel, and returns
  immediately — it does not wait in the tab. Gallery and sandboxed components
  still execute in the browser.
- **The transcript is not the Activity tab.** Activity is held in the browser
  for the open conversation and is gone on reload. The audit trail is the
  record that survives. The roster preview is `channels.lastMessage`, updated
  when a job finishes.

So: a person can send “research these two people, open their sites, and write
the CRM” with Send-and-go, close the tab, and the worker still runs those
server tools — including the computer. A standing cron, a signed webhook POST,
or an inbound email to a mapped mailbox starts the same job after the tab is
closed. A login or secret pauses as Needs you; the ask stays on the computer
if the tab is closed. The first composer send and the first unattended job
open the mapped Intelligence thread through CopilotRuntime and leave the
assistant reply on it. A second job attaches to that same id. Reopen the
channel: the transcript is that thread.

### Organizations

`organizations`, `organization_memberships`, and `organization_invites` are
real tables. CRM, agents, channels, credentials, policy, skills, and Composio
connections are queried with `org_id`. Intelligence user ids are `org:user`.
Computer ids for a non-local org are namespaced. Tests refuse one org reading
another’s coworker, channel, skill, or credential.

Postgres RLS is the second fence on every org-owned table (not
`shared_computer_claim`). When `app.current_org_id` is set, a sloppy `SELECT`
cannot read another org’s rows, even as the table owner (`FORCE ROW LEVEL
SECURITY`). Bindings are `SET LOCAL` on the connection that runs the query
(`server/src/db/rls.ts`), so a pool hop cannot skip the fence. Empty GUC is
the boot / test / worker-claim path. Authenticated requests bind the actor’s
org. Replica B uses the same Postgres; nothing is held in a Map.

Self-serve billing is Stripe Checkout. `organizations.plan` is `free` /
`starter` / `growth` / `enterprise` with a `seat_limit`. The first owned
workspace is free (1 seat). A second `POST /api/orgs` returns 402 and a
Checkout URL when `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, and
`STRIPE_PRICE_ID` are set, and refuses if they are not. Webhooks write plan
and seats onto the org row. `/platform` remains for superadmins (enterprise,
100 seats). Seats are counted as memberships plus unexpired pending invites
and refused on invite and accept.

Owner invites email the existing token. Missing `SMTP_URL` or `SMTP_HOST` +
`SMTP_FROM` fails closed — the invite is not treated as sent. Platform
invites may still return the token (sales-led).

Google / Microsoft / Okta / email are still configured deployment-wide.
`organization_sso` is which of those an organization admits and which email
domains route here. Org A’s flags do not apply to org B.
`GET /api/auth/sso-for-email` is the sign-in overlay.

An org may set `spend_cap_cents`. Crossing it refuses new unattended, model,
or computer work out loud (402 / SpendCapError). The ledger is
`organization_spend_events` in Postgres, serialised with `FOR UPDATE` on the
org row.

API and worker processes call `startTracing`. Spans leave over OTLP HTTP when
`OTEL_EXPORTER_OTLP_ENDPOINT` is set; without it the SDK still records spans
on a discard exporter. Replica B emits its own traces. Nothing is fanned to a
browser.

What that is not:

- **Not a tenant package per customer.** `TENANT_PACKAGE_DIR` is one package
  for the process. A new org gets copies of the packaged coworkers. Brand,
  model, and knowledge YAML stay shared.
- **Not a computer per tenant in the one-container image.** Without the
  supervisor, every Bot shares one Chromium. That is fine for one trusted team.
  A second organization is refused until `COMPUTER_SUPERVISOR_URL` is how
  computers are made — one computer per org×bot. The supervisor needs a Docker
  socket, which the shippable image does not include.
- **A durable transcript on the mapped Intelligence thread.** The first
  composer send and the first unattended job open that thread through
  CopilotRuntime (`getOrCreateThread` + `runner.run`). A second job
  attaches to the same id.

### What to run it as

**Fit for self-serve SaaS or a sales-led / single-company deployment** where
people are in the app: sign-in (or `OPENBOT_EMAIL_AUTH`), encrypted
credentials, gateway and audit, org-scoped CRM and plugins, RLS, Stripe
checkout and seats, invite email, per-org SSO, a spend cap, traces, and a
computer when the supervisor is actually running beside it. Home is still
Composer + Goals. Rooms stay behind See the work. Approval cards stay on the
goal.

**A durable transcript on the mapped Intelligence thread.** Send-and-go, cron,
webhook, inbound email, and specialist spawn all enqueue the same job and the
worker runs it after the tab closes, including computer tools when the gateway
is on. The first job opens the mapped thread through CopilotRuntime; close-tab
/ come-back reads that same thread.

**The self-improving loop is closed on the goal.** High-risk actions wait as
an approval card on that goal. The owner keep / revise / revert. Outcome
(worked / didn't / unknown) is stored on the same object. The next
orchestrator turn sees that decision. There is no Measure or Approvals nav,
and no second runner.

### Code that says this

| Claim | Where |
| --- | --- |
| Product name | `examples/fintech/brand.yaml`, `server/src/index.ts` listen line, sign-in copy |
| Org tables, plan, seats, spend cap | `server/src/db/schema/core.ts` |
| Isolation is query-scoped and RLS | `server/tests/organization-isolation.integration.test.ts`; `server/src/db/rls.ts`; `server/drizzle/0018_saas_billing_rls.sql` |
| Stripe Checkout and webhooks | `server/src/billing/stripe.ts`, `server/src/billing/routes.ts` |
| Seats on invite and accept | `server/src/orgs/store.ts` `SeatLimitError`; `server/src/orgs/constants.ts` `PLAN_SEATS` |
| Invite email fails closed | `server/src/orgs/invite-mail.ts`; `server/src/orgs/routes.ts` `sendInvite` |
| Per-org SSO | `server/src/orgs/sso.ts`; `GET /api/auth/sso-for-email` in `server/src/app.ts` |
| Spend cap refuses new work | `server/src/orgs/spend.ts`; `server/src/jobs/enqueue.ts`; `server/src/copilot.ts`; `server/src/computer/gateway.ts` |
| OpenTelemetry on API and worker | `server/src/telemetry.ts`; `server/src/index.ts`; `worker/src/index.ts` |
| Multi-replica: Postgres / Stripe / OTel, no Map | `docs/deployment.md`; comments on each store above |
| Owner workspace seats / SSO / spend | `app/src/routes/_authed/_app/o.tsx` |
| Turns start in the app or from a standing trigger | `app/src/components/channels/channel-chat.tsx` (`useAgent`); `server/src/jobs/enqueue.ts` |
| Computer tools execute on the server | `server/src/computer/computer-tools.ts`, `server/src/jobs/tools.ts` `loadToolsForActor` |
| Watch pane is render-only | `app/src/lib/copilot/computer-tools.tsx` (`useRenderTool`) |
| HITL is `needs_you`, not a tab wait | `server/src/jobs/store.ts` `markNeedsYou`, `jobs.needs_you` |
| Shared Chromium refuses a second org | `server/src/computer/shared-claim.ts`, `server/src/computer/gateway.ts` `locate` |
| Server CRM / search tools | `server/src/index.ts` `loadToolsForActor` |
| Twenty tool steps | `server/src/copilot.ts` `TOOL_STEPS` |
| Send-and-go / unattended jobs | `server/src/jobs/`, `worker/src/index.ts` |
| One enqueue path for every start | `server/src/jobs/enqueue.ts` `enqueueUnattendedJob` |
| Orchestrator standing role | `examples/fintech/agents.yaml` `standing_role: orchestrator`, `server/src/orchestrator.ts` |
| Composer + Goals home | `app/src/routes/_authed/_app/index.tsx` |
| Owner nav has no family names or Agents; Skills and Plugins stay | `app/src/lib/nav/owner-nav.ts`, `app/tests/owner-nav.test.ts` |
| See the work (role-gated room) | `server/src/jobs/room-routes.ts`, `app/src/components/channels/see-the-work.tsx` |
| Owner thread hides raw tool traces | `app/src/components/channels/chat-messages.ts`, `app/src/components/channels/chat-transcript.tsx` |
| `/admin` is platform / INITIAL_ADMIN, not org owner | `server/src/auth/guards.ts` `requireDeploymentAdmin`, `app/src/routes/_authed/admin/route.tsx` |
| Specialist on demand | `server/src/jobs/specialist.ts` `startSpecialist`, `server/src/jobs/specialist-tool.ts` `start_specialist` |
| Specialist shares org CRM | `server/src/jobs/specialist.ts` `specialistCrmOrgId`; tools from `loadToolsForActor` |
| Cmd-K Rooms | `app/src/components/command-palette.tsx` |
| Cron standing row and due claim | `server/src/jobs/triggers.ts` `CLAIM_DUE_CRON_SQL`, `tickDueCrons`; `job_triggers` |
| Webhook and inbound email | `server/src/jobs/inbound.ts` `POST /api/inbound/webhook/:id`, `POST /api/inbound/email` |
| First turn opens the mapped Intelligence thread | `server/src/jobs/open-thread.ts` `openIntelligenceThread`; `server/src/jobs/runtime-run.ts` `runUnattendedThroughRuntime`; `server/src/copilot.ts` first-contact wrapper |
| Persist is the runner write, confirmed by getThread | `server/src/jobs/thread.ts` `createThreadPersister`; `server/tests/jobs-thread.test.ts` |
| Shared computer without supervisor | `docs/deployment.md`, `COMPUTER_SUPERVISOR_URL` |
| Composio keyed by org | `server/src/composio/client.ts` |
| High-risk wait as an approval card | `server/src/loop/wait.ts` `createHighRiskWait`; `server/src/crm/gateway.ts`; `server/src/computer/gateway.ts`; `server/src/plugins/store.ts` |
| Loop fields on the existing goal | `server/src/db/schema/core.ts` `channels.loop`; `server/src/loop/store.ts` |
| Keep / revise / revert | `server/src/loop/routes.ts` `POST /:channelId/loop/decision`; `app/src/components/channels/goal-loop-card.tsx` |
| Outcome on the same goal | `server/src/loop/routes.ts` `POST /:channelId/loop/outcome`; `recordUnknownOutcomeIfAbsent` |
| Next orchestrator turn sees the decision | `server/src/loop/guidance.ts` `orchestratorContextFromLoop`; `server/src/copilot.ts` `goalLoopGuidance`; `server/src/jobs/run.ts` |
| Owner nav has no Measure / Approvals item | `app/src/lib/nav/owner-nav.ts`, `app/tests/owner-nav.test.ts` |

---

## C. What it is not yet

The two doors have landed; the loop is closed on the goal; self-serve SaaS
has landed; the first composer turn and the first unattended job open the
mapped Intelligence thread (Part B). Still not:

1. **Self-serve SaaS leftovers.** RLS, Stripe checkout and seats, invite
   email, per-org SSO, spend caps, OpenTelemetry, and a stated multi-replica
   story (Postgres / Stripe / OTel, no in-process Map) exist (Part B). Still
   true: `TENANT_PACKAGE_DIR` is one package for the process; a shared
   Chromium refuses a second org until `COMPUTER_SUPERVISOR_URL`. `/platform`
   remains for superadmins; checkout is the owner path.
2. **The rest of Stage 4 compounding.** Approval cards, expected impact,
   outcome, and keep / revise / revert live on the same goal (Part B). Home is
   still Composer + Goals. See the work still opens that goal’s room. There is
   no experimentation platform and no Measure / Approvals nav.

When a pull request claims one of those, it is done only when Part B of this
file can say so with a file citation. Until then the honest sentence is the
one in Part B.
