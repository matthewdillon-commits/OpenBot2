# Coworkers

A coworker is a Bot with a durable profile and standing role. The role is sent with every run so the user does not have to restate the job in each channel.

## Data model

| Piece                | Table                           | Purpose                                                               |
| -------------------- | ------------------------------- | --------------------------------------------------------------------- |
| Runtime agent        | `agents`                        | AG-UI endpoint and optional key reference.                            |
| Profile              | `agent_profiles`                | Name, title, role, avatar seed, owner, visibility, and soft deletion. |
| Personal roster      | `agent_preferences`             | Per-user hidden state.                                                |
| Channel              | `channels`                      | Conversation membership and coworker binding.                         |
| Intelligence mapping | `intelligence_channel_mappings` | Channel-to-thread mapping.                                            |

Package-provided agents are public and ownerless. User-created coworkers are owned by the creator.

## Standing role

Remote coworkers receive a system message derived from their title and role description:

```text
You are Expense Manager, Finance Operations.

Review receipts, categorize expenses, and prepare reimbursement reports.

This standing role applies in every channel. Treat channel messages as task-specific instructions within it.
```

The message is ordinary AG-UI system content, so it works with any AG-UI-compatible backend. Editing the role affects the next run.

## Visibility

| Visibility | Who can see and run it      |
| ---------- | --------------------------- |
| `private`  | Owner and administrators.   |
| `public`   | Everyone in the deployment. |

Filtering happens in server/database queries. Package-provided agents cannot be edited or deleted through the product.

## Channels

Starting a channel creates a new conversation and Intelligence thread. Two channels with the same coworker stay separate.

A channel can hold up to eight coworkers. The compose screen's To: field seats them, in order; the first is the lead. One shared thread; `@` a member to have them answer that turn. A room can be named when two or more coworkers are seated, and members can be added or removed later from the channel settings pane.

Bots can also message each other. `message_agent` opens or reuses a 1:1 between two coworkers for the person whose run it is. `message_channel` posts to a room the sender already belongs to. Both are governed actions: the gateway resolves the target, evaluates the policy (`intent == "message"` or the tool name), writes an audit row, and only then stores the message and wakes the recipient. The sender is not held open waiting for a reply. A real wake reply — a finding, an answer, or a question — is stored and wakes the other members, so a room can go a few turns without a person. Empty acknowledgements are refused and never delivered. A long unattended chain stops after eight hops.

Bots can send and read mail when an administrator has stored a write-only email credential under Admin → Credentials. `send_email` needs SMTP; `read_email` lists recent inbox messages or reads one by id and needs IMAP. Store both protocols to offer both tools. Every call goes through the gateway (`intent == "email"` or the tool name), and the trail records destination, subject and the decision as `email.sent` / `email.send_refused` or `email.read` / `email.read_refused` — never the body and never the password. Absent credential, the tools are not offered.

An administrator can also give a coworker standing work that is not a chat turn. Admin → Schedules
creates a cron job, an inbound webhook, or an inbound email trigger. Email triggers need the IMAP
credential above: when a new message arrives, the poller wakes the named coworker with the job
brief plus from, subject, id, and enough of the body to act. Creating and firing go through the
gateway (`intent == "schedule"`). The HTTP webhook still requires its secret; only the in-process
fetcher may fire an email job as trusted. The brief is posted to a hidden task channel and the
coworker is woken afterwards. Due times and the inbox cursor live in Postgres so a restart still
sees work that is due and does not re-fire old mail.

Bots can also read and write this deployment's CRM. `crm_search`, `crm_get`, `crm_create`, and `crm_update` cover people, companies, opportunities, campaigns, and conversations. That book is not the signed-in directory: `/admin/people` is who may use OpenBot. A Bot write records the Bot as created-by. Every call is a governed action (`intent == "crm"` or the tool name) and lands on the trail as `crm.record_read`, `crm.record_written`, or `crm.record_refused`. A deny writes nothing.

A Bot can hand a bounded chunk of work to a sub-agent with `spawn_subagent`: a goal, success criteria, and what to report back. The call returns an id immediately; the parent stays available. The child is a background run of that same coworker, not a new profile in the directory, and it does not talk to the person. When it finishes — or hits a real blocker — it reports and the parent is woken, the same way a `message_agent` recipient is. A follow-up or correction passes that same id so the work stays on that worker. A second spawn without an id is a second independent worker. Spawn is governed (`intent == "spawn"` or `tool.name == "spawn_subagent"`) and lands on the trail as `subagent.started` or `subagent.refused`. The child has no composer; the record is the audit trail.

The child uses the same computer the parent does — browser, files, and shell — through the computer gateway. Isolation in this product is per Bot, not per run, so two runs of the same coworker take turns rather than sharing a mouse. A person sees the work on Activity and the audit trail. If the child hits a login or needs a secret, it reports `blocked` to the parent with what they must do; it does not hang waiting for take-the-wheel.

Each channel routes through a channel-local proxy agent id, pinned to that channel's thread id, then forwards to the coworker runtime id.

## Deleting and hiding

Deleting is soft. The coworker stops running, but existing channels remain readable for their members and restore as tombstones.

Hiding is personal roster state. It removes the coworker from one user's list without disabling the coworker for anyone else.

## Default endpoint

Product-created coworkers use:

```dotenv
MANAGED_AGENT_AG_UI_URL=http://localhost:4201/ag-ui
```

That is `agent-langgraph`, which runs a real framework and its own tool loop. The proof-of-concept on
`4200` hand-writes the protocol and leaves the loop to whatever is watching, so it is a reference
rather than something to build a deployment on.

The URL is optional. Set it with `MANAGED_AGENT_TOKEN`, or leave it unset: product-created coworkers
then need their own endpoint, and a package agent whose endpoint expands to nothing is omitted
rather than registered against a missing host. A leftover token with no URL is ignored.
Package-provided agents otherwise use their own `agents.yaml` configuration.

## Register an external AG-UI agent

In `agents.yaml`:

```yaml
agents:
  - id: risk
    name: Risk
    title: Risk & Compliance
    role_description: Investigate policies and controls.
    type: remote-ag-ui
    endpoint: http://risk.internal/ag-ui
```

In the product, create or edit a coworker from `/agents` and set:

- name;
- title;
- role description;
- visibility;
- optional endpoint;
- optional authorization header.

Endpoint registration uses target checks. Cloud metadata addresses are refused under every configuration. Optional keys are write-only: sending a key stores/replaces it, omitting it keeps the existing key, and APIs do not return it.

`POST /api/agents/test-connection` checks whether an endpoint answers before saving it.

## Capabilities

A coworker's role does not grant capabilities. Capabilities are governed separately:

- browser and file actions go through the computer gateway policy;
- components are published deployment-wide and can be withheld per Bot;
- MCP tools are granted per Bot by administrators;
- personal skills can be attached only to Bots the author owns;
- deployment skills are managed by administrators.

See [architecture.md](architecture.md).
