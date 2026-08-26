# Deployment

LimitlessAI ships as one container. It carries the app, the API that serves it, and the browser the
Bots drive, and it can carry its own PostgreSQL as well.

What that image is ready to host — one trusted team versus several customers, and whether a
coworker keeps working after the tab closes — is in [product.md](product.md). Without the
supervisor, every Bot shares one Chromium, which is not a boundary between tenants.

```sh
docker build -t openbot .

# A database you already run.
docker run -p 3001:3001 --env-file .env openbot

# Or one inside the container. Nothing else to provision.
docker run -p 3001:3001 --env-file .env \
  -e EMBEDDED_POSTGRES=on -v openbot-data:/var/lib/postgresql/data openbot
```

## What is in the image, and what is not

**In it:** the built app, the API, and Chromium. One port, 3001. The browser listens on 4100 inside
the container and is deliberately not published: it holds real logins and its only caller is the
process beside it.

**PostgreSQL, if you ask for it.** `EMBEDDED_POSTGRES=on` starts one inside the container, creates
the database and the `vector` extension the first time. The embedded server listens on loopback only
and is never published, so there is no password to manage. Migrations run on every start, against
that database or whatever `DATABASE_URL` names.

Give it a volume at `/var/lib/postgresql/data`. Without one, a redeploy takes the audit trail with
it, and the audit trail is the product. Platforms that offer no persistent volume are the ones to
point at a managed database instead: set `DATABASE_URL` and leave `EMBEDDED_POSTGRES` off. The
`vector` extension must be enabled there; RDS, Cloud SQL and Azure Database all support it, none
enable it for you.

**Not in it:**

**The supervisor.** It gives each Bot its own container, which needs a Docker socket, which no
serverless container platform permits. Without it every Bot shares the one browser, exactly as they
do on a laptop with no supervisor configured. A shared browser means shared logins, shared files and
shared session between Bots, which is fine for a deployment where one team trusts its own Bots and
is not fine as a boundary between tenants.

## Multi-tenant computers (E2B)

The Railway one-image deployment is that shared Chromium. A second organization is refused until
computers are made somewhere that is not this container.

SaaS computers are E2B: one sandbox per organization×coworker, resumed when the coworker comes back.
Set `E2B_API_KEY` on the openbot service (Railway variables). That selects the E2B provider even
though the image still has an in-container browser URL. Do not put that name in owner-facing copy.

Pause/resume is how the same machine comes back. A running sandbox still hits the E2B plan's
continuous limit (one hour on Hobby, 24 hours on Pro); when it expires this provider pauses rather
than killing. Pause is not a 24-hour TTL and is not a promise the sandbox exists forever. If it has
been killed, the owner sees that the computer is not available.

Remaining operator steps: create an E2B account, build the `openbot-agent-computer` template
(`bun server/e2b/build.ts` from the repo root with the key set), paste the key into Railway.

## Minimum size

Measured on the real image, one Bot, arm64.

| | Measured | Minimum | Recommended |
| --- | --- | --- | --- |
| Memory | 409 MB idle, 498 MB after three page loads, 548 MB after a snapshot | **2 GB** | **4 GB** |
| vCPU | 3 to 6 percent at rest, bursty while a page renders | **1** | **2** |
| Disk | 5.3 GB image | **8 GB** | 10 GB with room for `/workspace` |

**Why 2 GB when it measures at 550 MB.** That figure is one Bot with one page open. Every additional
concurrent page is roughly another 100 to 200 MB, and Playwright's own guidance is to allow about
1 GB per concurrent browser. 2 GB is the floor at which one person using it does not meet the OOM
killer; 4 GB is where a handful of Bots working at once stays comfortable.

**Do not configure shared memory.** Chromium is launched with `--disable-dev-shm-usage`, so it writes
to `/tmp` rather than `/dev/shm` and the 64 MB default is irrelevant. This matters because **AWS
Fargate does not support `sharedMemorySize` at all**; without that flag Chromium would crash there
and the fix would not be available.

## Required configuration

| Variable | |
| --- | --- |
| `DATABASE_URL` | PostgreSQL with the `vector` extension. Not needed with `EMBEDDED_POSTGRES=on` |
| an identity provider | `GOOGLE_OAUTH_*`, `MICROSOFT_OAUTH_*` or `OKTA_OAUTH_*`, with `BETTER_AUTH_URL`, `BETTER_AUTH_SECRET` and `INITIAL_ADMIN_EMAILS`. See the README |
| `EMBEDDED_POSTGRES` | `on` to run the database inside the container. Off by default |
| `KEY_ENCRYPTION_KEY` | base64 32 bytes. `openssl rand -base64 32`. The example key is refused in production |
| `INTELLIGENCE_API_URL`, `INTELLIGENCE_GATEWAY_WS_URL`, `INTELLIGENCE_API_KEY` | CopilotKit Intelligence. A free plan is available and it can be self-hosted |
| `COPILOTKIT_LICENSE_TOKEN` | from `npx copilotkit@latest license --write` |
| a model key | `OPENAI_API_KEY`, or the provider you configured |

`COMPUTER_TOKEN` is generated at start if you do not set one. Both processes that need it are inside
the container, so there is nothing to share it with.

`MANAGED_AGENT_AG_UI_URL` is not required here. The image does not carry `agent-langgraph` or
`agent-bot`. Leave it unset and the shipped Risk Analyst coworker is omitted rather than registered
against a host that is not there. Set it, with `MANAGED_AGENT_TOKEN`, only when a Bot is actually
reachable from this container. Unset it if your `.env` still has the laptop default
`http://localhost:4201/ag-ui`.

**Authentication is required.** With no identity provider configured the deployment refuses to start,
because a public URL where every visitor is an administrator fails silently: it looks like it works.
Configure Google, Microsoft or Okta, or set `OPENBOT_SINGLE_USER=true` to say you meant an open
deployment. `NODE_ENV` does not affect this.

**Put TLS in front of it.** Not only for the cookies. A page served from `http://<address>` is not a
secure context, which removes a set of browser APIs that are present on `http://localhost` and so
never missing on a laptop. The app no longer depends on any of them, but sign-in cookies still want
`Secure`, and every platform below terminates TLS for you.

## Migrations

They run at container start, against whatever `DATABASE_URL` names — the embedded database and a
managed one alike. `drizzle-kit migrate` is idempotent: a second start applies nothing. That is the
path Railway, Render, Fly, and a single `docker run` all take.

Two replicas starting together would race. This image is meant to run as one replica; if you scale
past that, run migrate as a release step before the new processes start, and do not let a failed
migration serve traffic.

```sh
docker run --rm --env-file .env openbot \
  sh -c "cd /app/server && bun x drizzle-kit migrate --config=drizzle.config.ts"
```

## Replicas

The page snapshot a Bot resolves element references against lives in Postgres, so a second replica
can answer a click the first one snapshotted. Run more than one if the platform wants it. The
supervisor is still not in this image, so every replica shares the one browser inside it.

Phase 6 SaaS surfaces are the same: billing, seats, SSO, and spend live in Postgres (and Stripe
for checkout sessions). Replica B applies the same webhook, sums the same spend ledger, and
reads the same `organization_sso` row. OpenTelemetry traces leave each process over OTLP; there
is no in-process Map to fan to a browser. RLS is `SET LOCAL` on the connection that runs the
query (and `SET LOCAL ROLE openbot_rls` so a superuser login cannot bypass), so a pool hop on
replica B cannot leak another org. The migration grants `openbot_rls` to the user that ran it.

## Platform notes

**Google Cloud Run.** Set memory to at least 2 GB and max instances to 1. Cloud Run runs every
container under gVisor, which Chromium is sensitive to; test a navigation before trusting it.
`gcloud run compose up` will also deploy the whole compose file if you want a throwaway database
alongside.

**AWS.** ECS Express Mode provisions the cluster, load balancer, HTTPS and autoscaling from an image
in ECR, and is what AWS points App Runner users at now that App Runner takes no new customers.
Plain ECS on Fargate behind an ALB is the answer if you want task definitions and fine-grained IAM.
No shared-memory configuration is needed or possible.

**Azure Container Apps.** Managed ingress with TLS and custom domains. Note the **240 second request
timeout**: the live screen holds a long connection, so expect it to reconnect. Concurrent WebSockets
are capped at 350 per instance on the basic tier.

**Railway, Render, Fly.io.** All run this image directly and all provision PostgreSQL in a click,
which makes them the shortest path from nothing to a running deployment.

## Known costs

**The image is 5.3 GB**, most of it the Playwright base, which ships Firefox and WebKit alongside the
Chromium we use. Deleting them afterwards does not help, because the bytes still ship in the layer
below. Building Chromium-only onto a slim base would cut this substantially and is not done yet.
