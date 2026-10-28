#!/usr/bin/env bash
# Fast behavioural persona runs for the todo app with QuickE2E.
#
# Loads the API key from the repo's gitignored .claude/.env at runtime, maps it
# to the variable the chosen engine reads, serves the todo app locally, runs the
# persona specs, and writes results to results/. The key is never printed,
# logged, or written to a file.
#
# Usage:
#   bash run.sh                       # engine jev (default); real paid run
#   bash run.sh --engine jev          # Jev via OpenRouter   -> OPENROUTER_API_KEY
#   bash run.sh --engine vercel       # Jev via Vercel AI GW -> AI_GATEWAY_API_KEY
#   bash run.sh --engine local        # local open model (Apple Silicon); no key
#   bash run.sh --check               # validate the specs only, NO model calls, no key
# Flags may be combined: `bash run.sh --engine vercel --check` (check needs no key).
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo="$(cd "$here/../.." && pwd)"
port=8777
spec="specs/personas.spec.mjs"
base="http://127.0.0.1:$port"

# --- parse args -----------------------------------------------------------------
engine=jev
check=0
while [ $# -gt 0 ]; do
  case "$1" in
    --check) check=1 ;;
    --engine) engine="${2:?--engine needs a value: jev|vercel|local}"; shift ;;
    --engine=*) engine="${1#*=}" ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
  shift
done
case "$engine" in
  jev)    keyvar=OPENROUTER_API_KEY ;;
  vercel) keyvar=AI_GATEWAY_API_KEY ;;
  local)  keyvar="" ;;   # no key needed
  *) echo "unknown engine: $engine (use jev|vercel|local)" >&2; exit 2 ;;
esac

# --- serve the todo app locally -------------------------------------------------
python3 -m http.server "$port" --bind 127.0.0.1 --directory "$repo/todo" >/dev/null 2>&1 &
server=$!
cleanup() { kill "$server" 2>/dev/null || true; }
trap cleanup EXIT
sleep 1

cd "$here"
mkdir -p results

if [ "$check" -eq 1 ]; then
  # No model calls, no key needed — just validates the specs against the live page.
  npx quicke2e check "$spec" --base "$base"
  exit $?
fi

# --- load the key from .claude/.env (runtime only; never printed) ---------------
key=""
if [ -n "$keyvar" ]; then
  envfile="$repo/.claude/.env"
  if [ ! -f "$envfile" ]; then
    echo "No $envfile found. Put your key there as jev_api_key=... (or run with --check / --engine local)." >&2
    exit 2
  fi
  set -a
  # shellcheck disable=SC1090
  . "$envfile"
  set +a
  key="${jev_api_key:-${JEV_API_KEY:-${OPENROUTER_API_KEY:-${AI_GATEWAY_API_KEY:-}}}}"
  if [ -z "$key" ]; then
    echo "No key found in $envfile. Add a line: jev_api_key=..." >&2
    exit 2
  fi
fi

echo "Running ${spec} against ${base} with engine ${engine} (key from .claude/.env, not shown)…"
status=0
if [ -n "$keyvar" ]; then
  env "$keyvar=$key" npx quicke2e run "$spec" --engine "$engine" --base "$base" \
    2>&1 | tee "results/personas-${engine}-$(date -u +%Y%m%dT%H%M%SZ).log" || status=$?
else
  npx quicke2e run "$spec" --engine "$engine" --base "$base" \
    2>&1 | tee "results/personas-${engine}-$(date -u +%Y%m%dT%H%M%SZ).log" || status=$?
fi

if [ "$status" -ne 0 ]; then
  echo "" >&2
  echo "quicke2e exited non-zero. If this was an auth error (401/unauthorized), the key" >&2
  echo "doesn't match engine '${engine}'. Options:" >&2
  echo "  - OpenRouter key (usually sk-or-...) -> --engine jev" >&2
  echo "  - Vercel AI Gateway key             -> --engine vercel" >&2
  echo "  - no key (Apple Silicon)            -> --engine local" >&2
fi
exit "$status"
