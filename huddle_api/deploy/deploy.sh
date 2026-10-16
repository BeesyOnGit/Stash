#!/usr/bin/env bash
# Runs on the VPS (called by GitHub Actions, or by hand to roll back):
#   IMAGE=ghcr.io/beesyongit/stash/huddle_api:<commit-sha> ./deploy.sh
# Pulls the image, restarts the stack and waits for the API to answer.
# Restarting ends the live huddles: they only live in memory.
set -euo pipefail
cd "$(dirname "$0")"

: "${IMAGE:?IMAGE must be set, e.g. ghcr.io/beesyongit/stash/huddle_api:latest}"
export IMAGE

if [ ! -f .env ]; then
    echo "ERROR: $(pwd)/.env is missing — create it from .env.production.example" >&2
    exit 1
fi

env_value() { grep -E "^$1=" .env | tail -n 1 | cut -d= -f2- | tr -d '"\r'; }
PORT="$(env_value PORT)"
: "${PORT:?PORT must be set in .env}"

# ── Deploy ───────────────────────────────────────────────────────────────────
echo "Deploying $IMAGE"
docker compose pull api livekit
docker compose up -d --remove-orphans

# ── Health check ─────────────────────────────────────────────────────────────
echo "Waiting for the API on port $PORT"
for _ in $(seq 1 30); do
    if curl -fsS -o /dev/null "http://127.0.0.1:${PORT}/health"; then
        echo "API is up — $IMAGE"
        if ! curl -fsS "http://127.0.0.1:7880" | grep -q OK; then
            echo "WARNING: LiveKit (voice chat) is not answering on 7880. Last logs:" >&2
            docker compose logs --tail 40 livekit >&2
        fi
        echo "$IMAGE" > .deployed_image
        docker image prune -f > /dev/null
        exit 0
    fi
    sleep 2
done

echo "ERROR: the API did not answer within 60 s. Last logs:" >&2
docker compose logs --tail 80 api >&2
if [ -f .deployed_image ]; then
    echo "Roll back with: IMAGE=$(cat .deployed_image) ./deploy.sh" >&2
fi
exit 1
