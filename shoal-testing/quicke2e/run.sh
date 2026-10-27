#!/usr/bin/env bash
# Fast behavioural persona runs for the todo app with QuickE2E + the Jev model.
#
# Loads the Jev API key from the repo's gitignored .claude/.env at runtime,
# maps it to the variable QuickE2E's `jev` engine reads (OPENROUTER_API_KEY),
# serves the todo app locally, runs the persona specs, and writes results to
# results/. The key is never printed, logged, or written to a file.
#
# Usage:  bash run.sh            # real runs (uses your key, makes paid calls)
#         bash run.sh --check    # validate the specs only, NO model calls, no key
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo="$(cd "$here/../.." && pwd)"
port=8777
spec="specs/personas.spec.mjs"
base="http://127.0.0.1:$port"
mode="${1:-run}"

# --- serve the todo app locally -------------------------------------------------
python3 -m http.server "$port" --bind 127.0.0.1 --directory "$repo/todo" >/dev/null 2>&1 &
server=$!
cleanup() { kill "$server" 2>/dev/null || true; }
trap cleanup EXIT
sleep 1

cd "$here"
mkdir -p results

if [ "$mode" = "--check" ]; then
  # No model calls, no key needed — just validates the specs against the live page.
  npx quicke2e check "$spec" --base "$base"
  exit $?
fi

# --- load the key from .claude/.env (runtime only; never printed) ---------------
envfile="$repo/.claude/.env"
if [ ! -f "$envfile" ]; then
  echo "No $envfile found. Put your Jev key there as jev_api_key=... (or run with --check)." >&2
  exit 2
fi
# Source it in a subshell-safe way; accept lowercase or uppercase var names.
set -a
# shellcheck disable=SC1090
. "$envfile"
set +a
key="${jev_api_key:-${JEV_API_KEY:-${OPENROUTER_API_KEY:-}}}"
if [ -z "$key" ]; then
  echo "No jev_api_key found in $envfile. Add a line: jev_api_key=sk-or-..." >&2
  exit 2
fi

# The jev engine authenticates through OpenRouter, which reads OPENROUTER_API_KEY.
# If the key is actually a Vercel AI Gateway key, use --engine vercel instead.
echo "Running ${spec} against ${base} with engine jev (key loaded from .claude/.env, not shown)…"
status=0
OPENROUTER_API_KEY="$key" npx quicke2e run "$spec" --engine jev --base "$base" \
  2>&1 | tee "results/personas-$(date -u +%Y%m%dT%H%M%SZ).log" || status=$?

if [ "$status" -ne 0 ]; then
  echo "" >&2
  echo "quicke2e exited non-zero. If this was an auth error (401/unauthorized), the" >&2
  echo "jev engine needs an OpenRouter key (usually sk-or-...). Options:" >&2
  echo "  - an OpenRouter key -> keep engine jev (this script)" >&2
  echo "  - a Vercel AI Gateway key -> set AI_GATEWAY_API_KEY and use '--engine vercel'" >&2
  echo "  - no key -> use the local engine (Apple Silicon): '--engine local'" >&2
fi
exit "$status"
