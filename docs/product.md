# What this product is

This repository is **LimitlessAI**: org-scoped coworkers, CRM, plugins, and governed computers.
CopilotKit Runtime and Intelligence are how a turn is executed and how a thread survives a
restart. They are not the product, and the README of the OpenBot tree this started from is not a
description of what this code does.

The sign-in surface is the one at `os.limitlessai.ca/login`. The name on the chrome comes from the
tenant package (`product_name: LimitlessAI`).

## What a deployment does today

A signed-in person works in one organization at a time. They talk to coworkers in channels (one
lead, up to eight in a room), keep people and deals in `/crm`, connect Gmail and the rest through
`/plugins`, and an administrator governs computers, credentials, MCP, and the action policy.

Every acting call still goes through the gateway: resolve, decide against the live policy, write an
audit row, then act or refuse. CRM writes, web search, company knowledge, MCP, and computer actions
are the same rule.

Conversations are durable. CopilotKit Intelligence holds the thread. Reopening a channel shows what
was said, including after a process restart.

## How a coworker actually runs

A turn starts because someone sent a message in the open app. Channel chat uses the CopilotKit
browser client. There is no scheduler, no inbound-email-to-Bot, and no webhook that starts a run
on its own. The `worker` package logs `idle` and does not run agents. A standing role is a system
prompt on the next user turn, not a process that keeps working.

Once a turn has started:

- **Server tools run on the API.** CRM (`crm_search`, `crm_get`, `crm_create`, `crm_update`,
  `crm_send`), `search_web` when `TAVILY_API_KEY` is set, company knowledge when there are
  documents, and granted MCP tools. Built-in Bots may take twenty of those steps in one run.
  A remote AG-UI Bot calls the same list back through `/api/agent-tools/call`.
- **Computer tools run in the tab.** Click, type, snapshot, files, and the shell are frontend
  tools. The run ends, the open browser executes them, then the client starts another run with
  the result. Gallery and sandboxed components are the same shape. Close the tab and that loop
  stops. Human-in-the-loop waits (login, 2FA, a secret) also live in the tab.
- **The transcript is not the Activity tab.** Activity is held in the browser for the open
  conversation and is gone on reload. The audit trail is the record that survives.

So: a person can send “research these two people and write the CRM” and, while that turn is
running, CRM and web search do not need the tab. Anything that needs the computer does. Nothing
new starts after they leave.

## Organizations

`organizations`, `organization_memberships`, and `organization_invites` are real tables. CRM,
agents, channels, credentials, policy, skills, and Composio connections are queried with
`org_id`. Intelligence user ids are `org:user`. Computer ids for a non-local org are namespaced.
Tests refuse one org reading another’s coworker, channel, skill, or credential.

What that is not:

- **Not Postgres RLS.** Isolation is the `WHERE org_id = …` on each query. A missed filter leaks.
- **Not billing.** `organizations.plan` is a string, default `enterprise`. There is no Stripe
  integration and no seat quota. A signed-in person may `POST /api/orgs` and own another workspace.
- **Not per-org SSO.** Google / Microsoft / Okta / email are deployment-wide.
  `PLATFORM_SUPERADMINS` provisions and suspends organizations; `/platform` is that screen.
  Invites return a token in the JSON; nothing in this server emails the link.
- **Not a tenant package per customer.** `TENANT_PACKAGE_DIR` is one package for the process.
  A new org gets copies of the packaged coworkers. Brand, model, and knowledge YAML stay shared.
- **Not a computer per tenant in the one-container image.** Without the supervisor, every Bot
  shares one Chromium. That is fine for one trusted team. It is not a boundary between customers.
  The supervisor needs a Docker socket, which the shippable image does not include.

## What to run it as

**Fit for a sales-led or single-company deployment** where people are in the app: sign-in (or
`OPENBOT_EMAIL_AUTH`), encrypted credentials, gateway and audit, org-scoped CRM and plugins, a
computer when the supervisor is actually running beside it.

**Not a self-serve multi-tenant SaaS** until RLS, billing, seats, per-org SSO, per-tenant
computers, and a spend cap exist.

**Not unattended coworkers** until something other than the open tab starts a run, and computer
tools execute somewhere that is not the person’s browser.

## Code that says this

| Claim | Where |
| --- | --- |
| Product name | `examples/fintech/brand.yaml`, `server/src/index.ts` listen line, sign-in copy |
| Org tables and plan-until-billing | `server/src/db/schema/core.ts` |
| Isolation is query-scoped | `server/tests/organization-isolation.integration.test.ts` |
| Turns start in the app | `app/src/components/channels/channel-chat.tsx` (`useAgent`) |
| Computer tools are frontend | `app/src/lib/copilot/computer-tools.tsx`, `server/src/channels/turn-watchdog.ts` |
| Server CRM / search tools | `server/src/index.ts` `loadToolsForActor` |
| Twenty tool steps | `server/src/copilot.ts` `TOOL_STEPS` |
| Worker is idle | `worker/src/index.ts`, `worker/src/status.ts` |
| Shared computer without supervisor | `docs/deployment.md`, `COMPUTER_SUPERVISOR_URL` |
| Composio keyed by org | `server/src/composio/client.ts` |
