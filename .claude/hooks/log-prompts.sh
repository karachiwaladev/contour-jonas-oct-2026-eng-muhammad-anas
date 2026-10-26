#!/usr/bin/env bash
# Stop hook: append this session's new user prompts to .claude/prompts.jsonl.
# One JSON object per line: {session_id, uuid, timestamp, prompt}.
# Prompts already in the log (matched by uuid) are skipped, so each stop only adds new ones.
set -euo pipefail

input=$(cat)
transcript=$(jq -r '.transcript_path // empty' <<<"$input")
session=$(jq -r '.session_id // empty' <<<"$input")
[ -n "$transcript" ] && [ -f "$transcript" ] || exit 0

log="${CLAUDE_PROJECT_DIR:-$(pwd)}/.claude/prompts.jsonl"
touch "$log"

# User prompts are "user" entries that aren't injected meta text (skill bodies)
# and aren't tool results.
jq -c --arg sid "$session" --slurpfile seen <(jq -c '.uuid' "$log") '
  select(.type == "user" and (.isMeta | not))
  | (.message.content) as $c
  | (if ($c | type) == "string" then $c
     else ([$c[]? | select(.type == "text") | .text] | join("\n"))
     end) as $text
  | select($text != "")
  | select(.uuid as $u | ($seen | index($u)) | not)
  | {session_id: $sid, uuid, timestamp, prompt: $text}
' "$transcript" >> "$log"
