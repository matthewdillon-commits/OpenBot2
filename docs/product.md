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

Code in this tree is **late Stage 1 / early Stage 2**: in-app, org-scoped, no
unattended loop. How we climb the rest is [roadmap.md](roadmap.md). That work
is other pull requests.

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

**Send-and-go** starts an unattended job on that same channel. The API inserts a
`jobs` row; the `worker` claims it with `FOR UPDATE SKIP LOCKED` and runs the
coworker with server tools only (CRM, `search_web`, knowledge, granted MCP). The
mapped Intelligence thread is reused — a second thread is not minted. Computer
tools still need the tab. When the job finishes, the row stores a skinny
outcome: status, finished time, channel, coworker, org, acting user, a
one-sentence summary, and any CRM record ids the write already returned. That
is not an approval card.

### How a coworker actually runs

A turn usually starts because someone sent a message in the open app. Channel
chat uses the CopilotKit browser client. **Send-and-go** is the other start: an
explicit “continue this channel after I leave” from the composer. There is no
scheduler, no inbound-email-to-Bot, and no webhook that starts a run on its own.
A standing role is a system prompt on the next user turn.

Once a turn has started — in the tab or from a claimed job:

- **Server tools run on the API.** CRM (`crm_search`, `crm_get`, `crm_create`,
  `crm_update`, `crm_send`), `search_web` when `TAVILY_API_KEY` is set, company
  knowledge when there are documents, and granted MCP tools. Built-in Bots may
  take twenty of those steps in one run. A remote AG-UI Bot calls the same list
  back through `/api/agent-tools/call`. An unattended job uses this list only.
- **Computer tools run in the tab.** Click, type, snapshot, files, and the
  shell are frontend tools. The run ends, the open browser executes them, then
  the client starts another run with the result. Gallery and sandboxed
  components are the same shape. Close the tab and that loop stops.
  Human-in-the-loop waits (login, 2FA, a secret) also live in the tab.
  Send-and-go does not register these tools.
- **The transcript is not the Activity tab.** Activity is held in the browser
  for the open conversation and is gone on reload. The audit trail is the
  record that survives. The roster preview is `channels.lastMessage`, updated
  when a job finishes.

So: a person can send “research these two people and write the CRM” with
Send-and-go, close the tab, and come back to that same channel for the result.
Anything that needs the computer still needs the tab.

### Organizations

`organizations`, `organization_memberships`, and `organization_invites` are
real tables. CRM, agents, channels, credentials, policy, skills, and Composio
connections are queried with `org_id`. Intelligence user ids are `org:user`.
Computer ids for a non-local org are namespaced. Tests refuse one org reading
another’s coworker, channel, skill, or credential.

What that is not:

- **Not Postgres RLS.** Isolation is the `WHERE org_id = …` on each query. A
  missed filter leaks.
- **Not billing.** `organizations.plan` is a string, default `enterprise`.
  There is no Stripe integration and no seat quota. A signed-in person may
  `POST /api/orgs` and own another workspace.
- **Not per-org SSO.** Google / Microsoft / Okta / email are deployment-wide.
  `PLATFORM_SUPERADMINS` provisions and suspends organizations; `/platform` is
  that screen. Invites return a token in the JSON; nothing in this server emails
  the link.
- **Not a tenant package per customer.** `TENANT_PACKAGE_DIR` is one package
  for the process. A new org gets copies of the packaged coworkers. Brand,
  model, and knowledge YAML stay shared.
- **Not a computer per tenant in the one-container image.** Without the
  supervisor, every Bot shares one Chromium. That is fine for one trusted team.
  It is not a boundary between customers. The supervisor needs a Docker socket,
  which the shippable image does not include.

### What to run it as

**Fit for a sales-led or single-company deployment** where people are in the
app: sign-in (or `OPENBOT_EMAIL_AUTH`), encrypted credentials, gateway and
audit, org-scoped CRM and plugins, a computer when the supervisor is actually
running beside it.

**Not a self-serve multi-tenant SaaS** until RLS, billing, seats, per-org SSO,
per-tenant computers, and a spend cap exist.

**Not unattended computer, cron, webhook, or inbound email.** Send-and-go runs
CRM / research / MCP after the tab closes. Computer tools still execute in the
person’s browser. Scheduled and inbound starts are later phases.

**Not the self-improving loop.** There are no outcome events tied to actions,
no approval cards with expected impact, and no keep / revise / revert that
feeds the next choice. The audit trail records what was permitted or refused.
It does not measure whether the work moved the business.

### Code that says this

| Claim | Where |
| --- | --- |
| Product name | `examples/fintech/brand.yaml`, `server/src/index.ts` listen line, sign-in copy |
| Org tables and plan-until-billing | `server/src/db/schema/core.ts` |
| Isolation is query-scoped | `server/tests/organization-isolation.integration.test.ts` |
| Turns start in the app | `app/src/components/channels/channel-chat.tsx` (`useAgent`) |
| Computer tools are frontend | `app/src/lib/copilot/computer-tools.tsx`, `server/src/channels/turn-watchdog.ts` |
| Server CRM / search tools | `server/src/index.ts` `loadToolsForActor` |
| Twenty tool steps | `server/src/copilot.ts` `TOOL_STEPS` |
| Send-and-go / unattended jobs | `server/src/jobs/`, `worker/src/index.ts` |
| Shared computer without supervisor | `docs/deployment.md`, `COMPUTER_SUPERVISOR_URL` |
| Composio keyed by org | `server/src/composio/client.ts` |

---

## C. What it is not yet

Three things people will assume from Part A. The first has started; the
other two have not:

1. **Unattended computer and scheduled starts.** Send-and-go exists (Part B):
   the worker claims a job and continues CRM / research / MCP after the tab
   closes. There is still no cron, no webhook, and no inbound email that opens
   a run. Computer tools still need the tab.
2. **Self-serve SaaS.** No RLS, no Stripe, no seat quota, no invite email, no
   per-org SSO, no spend cap, no multi-replica story beyond “Postgres is the
   shared state.” `/platform` is sales-led provisioning, not a checkout.
3. **The UX contract and the loop.** Home is not Composer + Goals. A person
   still picks a coworker from a roster (General Assistant, Knowledge, an
   optional Risk Analyst). There is no goal object, no skinny status + last
   action, no “See the work,” no approval cards. Observe / understand /
   prioritize / act can be *performed by a person talking to a Bot*. Measure
   and improve are not product surfaces. There are no outcome events.

When a pull request claims one of those, it is done only when Part B of this
file can say so with a file citation. Until then the honest sentence is the
one in Part B.
