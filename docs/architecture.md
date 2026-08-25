# Architecture

LimitlessAI is a React app, a Hono API server, PostgreSQL, CopilotKit Intelligence, AG-UI Bot
endpoints, governed browser computers, an org-scoped CRM, and Composio plugins. What that is
ready to run as — and what a coworker does when nobody is looking — is in [product.md](product.md).

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="../assets/architecture-dark.svg">
  <img src="../assets/architecture-light.svg" alt="A turn goes from the app to the server, which sends it to a Bot over AG-UI. Every tool call the Bot makes returns through the gateway, which resolves the target, decides it against the configured policy, records an audit row, and only then acts, or refuses and names the rule. Allowed actions reach that Bot's own computer, one container each holding its own Chromium, logins and workspace, created by the supervisor. Every decision lands in PostgreSQL; threads and memory live in CopilotKit Intelligence.">
</picture>

Regenerate it with `bun run diagram` after changing anything it shows.

## Services and ports

| Component                | Port                       | Responsibility                                                                                                                              |
| ------------------------ | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `app`                    | 3010                       | React/Vite interface for channels, CRM, plugins, Bot chat, live screen, settings, organizations, and admin pages. |
| `server`                 | 3001                       | API, CopilotKit runtime, auth, organizations, tenant package, coworkers, channels, CRM, policy, audit, credentials, plugins, components, and connectors. |
| `agent-computer`         | 4100                       | Chromium, `/workspace`, browser profile, screenshots, snapshots, and file tools.                                                            |
| `agent-bot`              | 4200                       | Proof-of-concept AG-UI Bot.                                                                                                                     |
| `agent-langgraph`        | 4201                       | LangGraph AG-UI Bot.                                                                                                                        |
| `supervisor`             | 4500 host / 4300 container | Creates, stops, resets, and lists per-Bot computer containers.                                                                              |
| PostgreSQL with pgvector | 5432                       | Product data, audit rows, credentials, policy, grants, channels, CRM records, components, connector state, and knowledge records.           |
| CopilotKit Intelligence  | external                   | Durable threads, memory, and realtime gateway.                                                                                              |

`scripts/start.sh` starts PostgreSQL, `agent-computer`, `agent-bot`, `agent-langgraph`, and the supervisor through Docker Compose, then starts `server` and `app` on the host.

The compose file also defines optional SPIRE services. `start.sh` does not start them.

## Runtime flow

A turn starts in the open app. There is no scheduler in this tree.

1. A signed-in person opens a channel or `/bot` and sends a message (CopilotKit's browser client).
2. The server resolves the actor, including the selected organization, and the coworker that is speaking.
3. Built-in Bots run their tool loop on the API: CRM, `search_web`, company knowledge, and granted MCP, up to twenty steps. Remote AG-UI Bots call that same list back through `/api/agent-tools/call`.
4. Computer tools, gallery components, and sandboxed components are frontend tools. The run ends, the open tab executes them, then the client starts another run with the result.
5. Every acting call still goes through the gateway: resolve, decide, audit, then act or refuse.
6. Events reach the Intelligence gateway. The thread survives a restart; the Activity tab does not.

Closing the tab stops frontend tools. Server-side steps of an already-started turn continue on the API process until they finish or stall. Nothing new starts after that.

## Organizations

A person signs in once and works in one organization at a time (`organization_memberships`, `/o`,
`/platform`). Tenant-owned tables carry `org_id` and queries filter on it. Intelligence user ids
are `org:user`. Composio connections use the organization id as Composio's `user_id`.

That is application isolation, not Postgres RLS. One tenant package is loaded per process. Without
the supervisor, computers are not a tenant boundary. Billing, seats, and per-org SSO are not in
this code. See [product.md](product.md).

## Browser action governance

The computer itself does not decide policy. The server gateway is the action boundary:

1. resolve the target from the server-held snapshot or request subject;
2. evaluate the current action policy;
3. write an audit row for the decision;
4. call the computer only when the decision forwards;
5. write a second audit row if a forwarded action fails.

Policy rules can inspect:

- `tool.name`
- `intent`
- `bot.id`
- `actor.id`
- `page.url`, `page.host`
- `element.ref`, `element.role`, `element.name`, `element.type`
- `key`
- `file.path`, `file.name`, `file.extension`
- `mcp.server`, `mcp.tool`, `mcp.effect`
- `intent == "crm"` or `tool.name` for CRM reads, writes, and sends

Rules use CEL expressions plus case-insensitive `contains()` and `matches()`.
Deny rules are evaluated before allow rules. The policy engine fails closed: a
missing or empty policy permits nothing, a broken deny rule denies, and a broken
allow rule does not permit. The shipped startup default is explicit:
`deny: []` and `allow: ["true"]`, unless `AGENT_COMPUTER_POLICY` or a saved
administrator policy replaces it. A malformed configured policy stops server
startup.

## Computers

`agent-computer` requires `COMPUTER_TOKEN` and permits only `/health` without it. Docker Compose binds it to `127.0.0.1:4100`.

With `COMPUTER_SUPERVISOR_URL`, each Bot gets its own computer container, workspace volume, and browser profile. Without it, all Bots share `AGENT_COMPUTER_URL`.

A command on the computer inherits PATH, locale and terminal names, and the proxy variables, not the rest of the process environment. Userinfo is stripped from a proxy URL. `COMPUTER_SHELL_ENV` names anything else a deployment wants passed.

The supervisor exposes only ensure, stop, reset, and list operations. It holds the Docker socket, so do not expose it outside the deployment network. Set `COMPUTER_RUNTIME=runsc` to run computers under gVisor on hosts that support it.

## Human control and secrets

Handovers are audited as control events:

- `computer.help_requested`
- `computer.control_taken`
- `computer.control_released`

While a person controls the browser, Bot actions are refused rather than queued.

Secret entry is separate from chat content. The audit trail records that a secret was requested or supplied and the character count, not the secret value.

## Watching a Bot work

Two surfaces beside the conversation. The screen is the live browser, proxied over a websocket and gated on the same question as every other route about that Bot. The Activity tab is what the Bot did away from the browser: every command with its output and exit code, every file read, write and listing, newest first.

Activity is held in the browser for the open conversation and is gone on reload. It is a window rather than a record; the record is the audit trail, which is server-side, survives restarts, and is what an investigation reads. A saved file contributes its path and size and never its contents, matching the write route, which declines to echo them because a Bot may be saving something it was told in confidence.

## Coworkers and channels

A coworker is a durable Bot profile:

- `agents` stores runtime identity and endpoint/key reference.
- `agent_profiles` stores name, title, role, owner, visibility, and deletion state.
- `agent_preferences` stores per-user roster state.

A channel is a conversation with one or more coworkers (up to eight) and a CopilotKit Intelligence thread mapping. Starting a new channel creates a new thread. Home still starts a 1:1; `/channel/new` can name a room.

Who may reach one is decided by membership: every channel route resolves the caller in
`channel_memberships` and refuses without a row. `channels.allowed_groups` is declared in the
tenant package and stored, and is not part of that decision — `users.groups` is never populated by
any sign-in path, so a group-based rule has nothing to evaluate. Treat it as a declaration waiting
on group membership from the identity provider, not as a control that is running.

See [coworkers.md](coworkers.md).

## CRM

The organization's CRM is LimitlessAI-2's five-module book: people, companies, opportunities, campaigns, and conversations. It is not `/admin/people`, which is who may sign in.

Rows live in `crm_people`, `crm_companies`, `crm_opportunities`, `crm_campaigns`, `crm_conversations`, `crm_sends`, and `crm_send_events`, each scoped by `org_id`. Created-by is stored as a kind (`user`, `bot`, or `system`) plus the id and the display name at write time.

People carry `stage_key` (the outreach pipeline) and `do_not_contact`. The People index counts every stage on the server (`stageCounts`, `totalAllStages`) so the views menu stays honest past one page. Opportunities default to `qualify` and move across qualify / proposal / negotiation / won / lost. `crm_conversations` is still the notes table; the Conversations tab reads `GET /api/crm/threads`, one row per person from their latest send and its open/click events.

Sends are email, SMS, or call. SMTP and Twilio deliver when configured; otherwise the row is `logged` rather than pretending a message left. A person marked DNC cannot be sent to. Email opens and clicks use a tracking token that is write-only on the list: a 1×1 pixel and an http(s) click redirect.

Bots are offered `crm_search`, `crm_get`, `crm_create`, `crm_update`, and `crm_send`. Every call goes through the gateway: resolve the kind and fields, decide against the live policy (`intent == "crm"` or the tool name), write an audit row (`crm.record_read`, `crm.record_written`, or `crm.record_refused`), and only then act. A deny leaves the tables alone. A person create may pass `company_name` instead of `company_id`; the gateway finds or creates that company in the same write and links it. A second create for the same email, or the same name at that company, updates the existing person instead of inserting another row.

## Components

Components are frontend tools a Bot can call instead of answering only in prose.

Sources:

- compiled React components in `app/src/components/gallery/`;
- sandboxed components authored and published from `/admin/playground`.

Governance:

- compiled components are published when first seen by the app catalogue sync;
- sandboxed components are saved as drafts and become usable only after publish;
- every call asks the server whether the component exists, is published, and is not withheld from the Bot;
- component data functions require a separate per-component grant.

The shipped component data functions read the audit trail: `botActivity` and `recentRefusals`.

## MCP and skills

MCP servers and skills share the plugin grant table, but they have different ownership rules.

- MCP tools are admin-governed because they can reach external systems with stored credentials.
- Skills are reusable instructions. A person can create personal skills and attach them only to Bots they own. Administrators create deployment skills.

The curated MCP catalogue contains Atlassian, Box, Slack, Salesforce, and ServiceNow. Custom MCP servers must pass URL checks; unknown tools and custom-server tools are treated as writes unless positively classified as reads.

Every MCP call checks the grant first, then evaluates the same action policy engine with MCP context, then audits the result.

## Tenant package and knowledge

`TENANT_PACKAGE_DIR` points at the tenant package. The default is `../examples/fintech`.

Required package files:

- `brand.yaml`
- `agents.yaml`
- `channels.yaml`
- `model.yaml`
- `knowledge.yaml`

The server validates the package at startup. Channel agent IDs must match declared agents. Knowledge sources currently support Google Drive and Microsoft OneDrive declarations.

Connector credentials are stored through the credential vault and referenced by id, not stored inline in YAML.

## Security boundaries

- Server routes enforce auth and roles; admin pages are backed by server-side administrator checks.
- Sign-in is Google, Microsoft or Okta from the environment, email and password when `OPENBOT_EMAIL_AUTH=true`, plus SAML and OpenID Connect providers registered at runtime and routed by email domain. Those providers are deployment-wide, not per organization. One resolver answers both questions a run asks about a person, whose threads these are and which Bots they may run, so the two can never disagree.
- `INITIAL_ADMIN_EMAILS` is a floor: an address it names is made an administrator at every sign-in and cannot be demoted from the People screen. Everybody else's role is decided there, and every change writes an audit row.
- Registering, changing or removing an identity provider is administrator-only. Better Auth's SSO plugin guards those routes with a session alone, which would let any signed-in person register a provider for a domain.
- A registered identity provider belongs to the deployment, not to whoever registered it. Better Auth scopes its own listing and removal to the registering user and cascades the row from that user, so two administrators saw two different deployments and deleting the one who set sign-in up would have deleted the company's sign-in. Reads and removals go through this product's own administrator-only routes against the whole table.
- A provider's client secret and SAML signing material are encrypted at rest with `KEY_ENCRYPTION_KEY`, through a wrapper on the Better Auth storage adapter, since the plugin stores them as plaintext JSON. OAuth access and refresh tokens use Better Auth's own encryption, keyed on `BETTER_AUTH_SECRET`.
- Signing in, being refused, and being granted the administrator role by configuration each write an audit row. Without them nothing recorded that somebody who could edit `INITIAL_ADMIN_EMAILS` had promoted themselves, and revoking a person deleted the sessions that were the only evidence they had been here.
- Removing somebody deletes their sessions and denies their address, because deleting the user row alone is not removal: the next sign-in through the provider recreates it.
- With no identity provider configured, the deployment refuses to start unless `OPENBOT_EMAIL_AUTH=true` or `OPENBOT_SINGLE_USER=true`. That is the only thing that permits an open deployment; `NODE_ENV` does not.
- `KEY_ENCRYPTION_KEY` must be a base64-encoded 32-byte value. The example key is refused with `NODE_ENV=production`.
- Credential plaintext is encrypted at rest, never returned by APIs, and redacted from audit events.
- Browser navigation allows `http` and `https`; cloud metadata addresses are refused under every configuration.
- `AGENT_COMPUTER_ALLOW_PRIVATE_HOSTS=true` is for local development only.
- Computer tokens and supervisor tokens must be long random values outside local development.
