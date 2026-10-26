#!/usr/bin/env bash
# Stop hook: commit everything that changed and push it to origin.
# Non-destructive by design: only `git add -A`, `git commit` and a plain `git push`.
# Never force-pushes, resets, rebases or deletes. If the push is rejected (no access,
# or the remote moved ahead), the commit stays local and the reason is shown to the user.
set -uo pipefail

cd "${CLAUDE_PROJECT_DIR:-$(pwd)}" || exit 0
git rev-parse --is-inside-work-tree >/dev/null 2>&1 || exit 0

# Don't commit in the middle of a merge, rebase or cherry-pick.
gitdir=$(git rev-parse --git-dir)
for f in MERGE_HEAD REBASE_HEAD CHERRY_PICK_HEAD rebase-merge rebase-apply; do
  [ -e "$gitdir/$f" ] && exit 0
done

branch=$(git symbolic-ref --short -q HEAD) || exit 0   # detached HEAD: leave it alone

if [ -n "$(git status --porcelain)" ]; then
  git add -A
  git commit -q -m "Factory loop: auto-commit on stop" \
    -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" || exit 0
fi

# Push only if there is something the remote doesn't have yet.
upstream=$(git rev-parse -q --verify "origin/$branch" 2>/dev/null)
[ -n "$upstream" ] && [ -z "$(git log --oneline "origin/$branch..$branch")" ] && exit 0

if ! out=$(git push -q origin "$branch" 2>&1); then
  reason=$(printf '%s' "$out" | grep -m1 -E 'denied|rejected|error|fatal' || echo "push failed")
  jq -cn --arg m "Auto-push failed, commits kept locally: $reason" '{systemMessage: $m}'
fi
exit 0
