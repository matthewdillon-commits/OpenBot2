#!/bin/sh
# Insert one queued job and wait until the worker sets started_at.
#
# Used by the image CI job. The bar is claiming, not persist: a THREAD_NOT_FOUND
# from Intelligence after started_at is a later failure.
set -eu
export PGHOST="${PGHOST:-127.0.0.1}"

psql -U openbot -d openbot -v ON_ERROR_STOP=1 <<'SQL'
INSERT INTO users (id, email, name)
VALUES ('user_ci_claim', 'ci-claim@openbot.test', 'CI claim')
ON CONFLICT (id) DO NOTHING;

INSERT INTO agents (id, org_id, name, type, configuration)
VALUES (
  'agent_ci_claim',
  'org_local',
  'CI claim',
  'built_in',
  '{"systemPrompt":"ci"}'
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO channels (id, org_id, name, description)
VALUES ('channel_ci_claim', 'org_local', 'CI claim', 'claim probe')
ON CONFLICT (id) DO NOTHING;

INSERT INTO jobs (
  id, org_id, channel_id, goal_id, coworker_id, acting_user_id,
  trigger, payload, status, thread_id
)
VALUES (
  'job_ci_claim',
  'org_local',
  'channel_ci_claim',
  'channel_ci_claim',
  'agent_ci_claim',
  'user_ci_claim',
  'manual',
  '{"prompt":"ci-claim"}',
  'queued',
  'thread_ci_claim'
)
ON CONFLICT (id) DO NOTHING;
SQL

attempt=0
while [ "$attempt" -lt 30 ]; do
  attempt=$((attempt + 1))
  started=$(psql -U openbot -d openbot -tAc \
    "select started_at is not null from jobs where id = 'job_ci_claim'")
  if [ "$started" = "t" ]; then
    echo "claimed after ${attempt}s"
    exit 0
  fi
  sleep 1
done

echo "Queued job_ci_claim never got startedAt."
psql -U openbot -d openbot -c \
  "select id, status, started_at from jobs where id = 'job_ci_claim'"
exit 1
