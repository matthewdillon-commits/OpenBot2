#!/bin/sh
# The secret the API presents to the browser beside it.
#
# Both processes live in this container and the browser's port is not published, so nobody outside
# can present anything. What this defends is somebody publishing 4100 anyway, and the browser
# refuses to start without it regardless.
#
# Prefer the operator's COMPUTER_TOKEN. When it is empty, do not mint a random one: the API and
# this computer both derive the same digest from KEY_ENCRYPTION_KEY (already required to boot). A
# random value here would desynchronise them — tools offered, every call refused.
# Generated at random only when there is no vault key to share, which is not a production boot.
set -eu
if [ -z "${COMPUTER_TOKEN:-}" ] && [ -z "${KEY_ENCRYPTION_KEY:-}" ]; then
  head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n' \
    > /run/s6/container_environment/COMPUTER_TOKEN
fi
