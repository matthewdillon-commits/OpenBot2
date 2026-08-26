<div align="center">

# LimitlessAI

**The operating system for self-improving businesses.** Agents are the workers.
The product is the intelligence and coordination layer above them: one business
brain → many specialized agents.

[**What this product is**](docs/product.md) · [**Roadmap**](docs/roadmap.md) · [**Quick start**](#quick-start) · [**Docs**](docs/README.md)

[![CI](https://github.com/matthewdillon-commits/OpenBot2/actions/workflows/ci.yml/badge.svg)](https://github.com/matthewdillon-commits/OpenBot2/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)

</div>

LimitlessAI connects a company’s data, AI agents, and people into one
intelligence layer that understands what is happening, takes the next best
action, measures the result, and continuously improves how the business
operates.

Other AI agents do work. LimitlessAI learns which work actually moves the
business forward — and gets better every time it does it.

That is the product. It is not a bot builder. CopilotKit Runtime and
Intelligence run the turn and keep the thread; they are the conversation layer,
not the name on the chrome and not the moat.

**This tree is not that loop yet.** Code today is late Stage 1 / early Stage 2:
in-app, org-scoped, no unattended run. [docs/product.md](docs/product.md) is the
contract — Part A the GTM, Part B what a deployment does now, Part C what is
not built. [docs/roadmap.md](docs/roadmap.md) is the sequence (other PRs).

A coworker is any AG-UI agent — the packaged General Assistant, a LangGraph Bot,
or an endpoint you register. The gateway is still the only way a Bot reaches a
computer, a file, CRM, MCP, or the public web.

## What a coworker does today

A turn starts when someone sends a message in the open app, from Send-and-go,
or from a standing cron / webhook / inbound email (the same `jobs` row; the
worker claims it with `FOR UPDATE SKIP LOCKED`). Closing the tab does not stop
a claimed job. A missing Intelligence thread is a refuse — nothing mints one.

During that turn, CRM, web search, company knowledge, granted MCP, and computer
tools run on the server when the gateway is on (up to twenty steps). The watch
tab only renders the computer. Persist onto the Intelligence thread still fails
closed on this tree. Reopening the channel does not yet show the unattended
result.

[docs/product.md](docs/product.md) Part B is the source of truth for what is in
this code and what is not: org-scoped data without Postgres RLS, no Stripe or
seat quotas, no per-org SSO, a shared browser unless the supervisor is actually
running, no Goals home, no outcome-tied learning loop.

## Quick start

1. Create `.env`:

   ```sh
   cp .env.example .env
   ```

2. Get CopilotKit Intelligence credentials (required; threads are not stored in Postgres):

   ```sh
   npx --yes copilotkit@latest login
   npx --yes copilotkit@latest project select
   npx --yes copilotkit@latest license --write
   ```

   Put the `cpk-...` runtime key from `project select` in `.env` as
   `INTELLIGENCE_API_KEY`. `license --write` writes
   `COPILOTKIT_LICENSE_TOKEN` into the existing `.env`.

3. Fill the remaining required values:

   - `OPENAI_API_KEY` (or `OPENAI_BASE_URL` plus a key for an OpenAI-compatible host)

   Keep the managed Intelligence URLs from `.env.example` unless you run Intelligence yourself. The example `KEY_ENCRYPTION_KEY` is public and fine locally; generate your own with:

   ```sh
   openssl rand -base64 32
   ```

4. Install and run:

   ```sh
   bun install
   bash scripts/start.sh
   ```

5. Open <http://localhost:3010>.

`.env.example` ships `OPENBOT_SINGLE_USER=true`, so a laptop reaches the product without an OAuth
client. Delete that line and configure sign-in before anybody else can reach the deployment.
`OPENBOT_EMAIL_AUTH=true` is email and password plus create-account (it asks for an organization
name). `PLATFORM_SUPERADMINS` is who may open `/platform` and provision organizations.

`scripts/start.sh` starts Docker services, applies migrations, starts the API server on port 3001, starts the app on port 3010, and checks that the services answer their own health routes before printing next steps.

## Deploy it

One image carries the app, the API, the browser the Bots drive, and optionally PostgreSQL.

```sh
docker build -t openbot .
docker run -p 3001:3001 --env-file .env \
  -e EMBEDDED_POSTGRES=on -v openbot-data:/var/lib/postgresql/data openbot
```

Leave `EMBEDDED_POSTGRES` off and set `DATABASE_URL` to point at a database you already run.
Published images from this repository go to `ghcr.io/matthewdillon-commits/openbot2`, not the
CopilotKit OpenBot registry. [docs/deployment.md](docs/deployment.md) has sizes and platform
notes. [docs/product.md](docs/product.md) says when that image is and is not a tenant boundary.

## Surfaces

| Route                | Purpose |
| -------------------- | ------- |
| `/`                  | Start and browse channels. |
| `/channel/:id`       | A conversation. Up to eight coworkers in a room; one speaker per send. |
| `/crm`               | People, companies, opportunities, campaigns, conversations. Org-scoped. |
| `/plugins`           | Composio catalogue (Gmail, Slack, GitHub, …), connected per organization. |
| `/skills`            | Personal skills. |
| `/agents`            | Create, edit, hide, delete, and launch coworkers. |
| `/o`                 | Switch or create an organization. |
| `/platform`          | Provision and suspend organizations. `PLATFORM_SUPERADMINS` only. |
| `/bot`               | Direct chat with a Bot; `?agent=<id>` selects one. |
| `/settings`          | User preferences. |
| `/admin/connectors`  | Deployment knowledge sources. |
| `/admin/credentials` | Write-only encrypted credentials. |
| `/admin/computers`   | View, stop, and reset Bot computers. |
| `/admin/boundaries`  | Action policy, including switching the browser off. |
| `/admin/components`  | Publish components and govern which Bots may use them. |
| `/admin/playground`  | Draft and publish sandboxed components. |
| `/admin/plugins`     | MCP servers, grants, and deployment skills. |
| `/admin/people`      | Who may sign in. Not the CRM. |
| `/admin/identity-providers` | SAML / OIDC registered while running. |
| `/admin/audit`       | Permitted, refused, and failed actions. |

## Built on AG-UI

A Bot is any endpoint speaking [AG-UI](https://github.com/ag-ui-protocol/ag-ui). Packaged agents
are `built-in` (a system prompt on CopilotKit) or `remote-ag-ui` (LangGraph or anything else that
speaks the protocol). Governance rides the protocol, not the framework. Models are swappable:
OpenAI, or any OpenAI-compatible host (`OPENAI_BASE_URL`) including Anthropic, Google, and xAI
gateways.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="assets/architecture-dark.svg">
  <img src="assets/architecture-light.svg" alt="You talk to the server, which sends the turn to a Bot over AG-UI. Every tool call the Bot makes comes back through the gateway, which resolves the target, decides it against your policy, records an audit row, and only then acts, or refuses and names the rule. Allowed browser and file actions reach that Bot's own computer. Decisions land in PostgreSQL and threads in CopilotKit Intelligence.">
</picture>

## Configuration

`.env.example` is the source template. The API server refuses to start without:

- `DATABASE_URL`
- `KEY_ENCRYPTION_KEY`
- `INTELLIGENCE_API_URL`
- `INTELLIGENCE_GATEWAY_WS_URL`
- `INTELLIGENCE_API_KEY`
- `COPILOTKIT_LICENSE_TOKEN`

Settings worth knowing:

| Variable | Use |
| --- | --- |
| `OPENBOT_SINGLE_USER` | Admits every request as one administrator. Required when no identity provider and no email auth; `.env.example` ships it on. |
| `OPENBOT_EMAIL_AUTH` | Email and password. Create-account asks for an organization name. |
| `PLATFORM_SUPERADMINS` | Addresses that may provision and suspend organizations. |
| `OPENAI_BASE_URL` | OpenAI-compatible host (xAI and similar). Built-in Bots then use Chat Completions. |
| `TAVILY_API_KEY` | Offers every Bot `search_web`. |
| `COMPOSIO_API_KEY` | Loads the plugins catalogue. Connections are keyed by organization. |
| `E2B_API_KEY` | SaaS computers: one sandbox per organization×coworker. Railway stays on the shared Chromium until this is set. |
| `COMPUTER_SUPERVISOR_URL` | One computer per Bot on a Docker host instead of one shared Chromium. |
| `TENANT_PACKAGE_DIR` | Tenant YAML. Defaults to `../examples/fintech`. One package per process. |
| `DEPLOYMENT_ID` | Names this process when two share one Intelligence project. |

Full reference: [docs/configuration.md](docs/configuration.md).

## Architecture

| Service | Port | Purpose |
| --- | --- | --- |
| `app` | 3010 | React/Vite UI. |
| `server` | 3001 | Hono API, CopilotKit runtime, auth, organizations, CRM, plugins, policy, audit. |
| `agent-computer` | 4100 | Chromium plus `/workspace` and browser profile. |
| `agent-bot` | 4200 | Proof-of-concept AG-UI Bot. |
| `agent-langgraph` | 4201 | LangGraph AG-UI Bot. |
| `supervisor` | 4500 host / 4300 container | Creates and manages one computer per Bot. |
| PostgreSQL with pgvector | 5432 | Product data, including org-scoped CRM. |
| CopilotKit Intelligence | external | Durable threads and memory. |

The server gateway is the product path for acting calls. Keep computer service ports private.

More: [docs/architecture.md](docs/architecture.md), [docs/product.md](docs/product.md).

## Sign in

`.env.example` ships `OPENBOT_SINGLE_USER=true`, which is one administrator and no sign-in: how a
fresh clone reaches the product without registering an OAuth client first. Delete that line and
configure **any one** of Google, Microsoft, Okta, or `OPENBOT_EMAIL_AUTH=true` before anybody else
can reach the deployment. With neither, it refuses to start rather than admitting everybody as an
administrator. Configure more than one method and the sign-in screen offers each of them.

These four are needed whichever you pick:

```sh
BETTER_AUTH_URL=http://localhost:3001        # where OAuth callbacks come back to
BETTER_AUTH_SECRET=                          # openssl rand -base64 32
TRUSTED_ORIGINS=http://localhost:3010        # where the app is served from
INITIAL_ADMIN_EMAILS=you@example.com         # comma separated
```

Then the provider. Register the redirect URI shown beside it.

```sh
# Google — http://localhost:3001/api/auth/callback/google
# GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET are the same values (LimitlessAI-2 names).
GOOGLE_OAUTH_CLIENT_ID=
GOOGLE_OAUTH_CLIENT_SECRET=

# Microsoft — http://localhost:3001/api/auth/callback/microsoft
MICROSOFT_OAUTH_CLIENT_ID=
MICROSOFT_OAUTH_CLIENT_SECRET=
MICROSOFT_OAUTH_TENANT_ID=common             # your directory GUID for staff only

# Okta — http://localhost:3001/api/auth/callback/okta
OKTA_OAUTH_CLIENT_ID=
OKTA_OAUTH_CLIENT_SECRET=
OKTA_OAUTH_ISSUER=https://example.okta.com/oauth2/default
```

Restart. Accounts, sessions and roles are stored in the same PostgreSQL database as everything else.

A company's own SAML or OpenID Connect provider is registered while the deployment runs, under
Admin → Identity providers, and routed by email domain. An OIDC registration needs every host in the
provider's discovery document listed in `TRUSTED_ORIGINS`, not only the issuer.

- `INITIAL_ADMIN_EMAILS` is required, because nothing else grants the administrator role and no
  screen can promote somebody afterwards. It is re-read on every sign-in, so editing it takes effect
  the next time that person signs in.
- `MICROSOFT_OAUTH_TENANT_ID` defaults to `common`, which admits personal Microsoft accounts as well
  as work ones. On a multi-tenant app registration Entra may send no `email` claim at all, so
  LimitlessAI falls back to `upn` and then `preferred_username`. If none of the three arrives the
  sign-in is refused and the reason is logged: add `email` as an optional claim, or use your
  directory GUID here.
- A half-configured provider is refused at start-up rather than at somebody's first attempt to sign
  in: a client id with no secret, a secret shorter than 32 characters, or an Okta issuer with no
  credentials behind it.
- **SAML and OIDC** are registered while the deployment runs rather than configured here. Sign in as
  an administrator and go to Admin → Identity providers with the metadata your identity team gave
  you. People then sign in by typing their email address, and the domain decides which provider
  they are sent to.
- **Put TLS in front of any deployment.** A page served over plain `http://` on anything but
  localhost is not a secure context, and sign-in cookies want `Secure`.

## Keeping it to your machine

- `agent-computer` drives a browser holding real logins. `docker-compose.yml` binds it to loopback; leave it there.
- Store credentials through `/admin/credentials`, which encrypts them. Do not put credential values in tenant YAML or in committed files.
- `AGENT_COMPUTER_ALLOW_PRIVATE_HOSTS` lets a Bot reach services on this machine. Unset it if you would rather it could not.

## Development

```sh
bun run format:check
bun run lint
bun run typecheck
bun run test
bun run build
```

After changing the Drizzle schema:

```sh
bun run --filter server db:generate
bun run --filter server db:migrate
```

Use `bash scripts/start.sh` for the whole stack. Use `bun run dev` only when you want the app and server without the Docker Bots and computers.

## Documentation

- [docs/product.md](docs/product.md) — the contract: GTM, what this code does today, and what is not built
- [docs/roadmap.md](docs/roadmap.md) — implementation phases (other pull requests)
- [docs/README.md](docs/README.md)
- [docs/architecture.md](docs/architecture.md)
- [docs/configuration.md](docs/configuration.md)
- [docs/development.md](docs/development.md)
- [docs/coworkers.md](docs/coworkers.md)
- [docs/deployment.md](docs/deployment.md)
- [docs/releasing.md](docs/releasing.md)

## License

[MIT](./LICENSE). CopilotKit Runtime remains a dependency. The product in this repository is LimitlessAI.
