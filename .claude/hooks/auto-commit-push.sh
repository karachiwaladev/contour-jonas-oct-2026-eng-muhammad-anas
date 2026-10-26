#!/usr/bin/env bash
# Stop hook: commit everything that changed on the current feature branch and push that branch.
# Work reaches main only through pull requests, so this hook never commits to or pushes the
# default branch: on main it leaves changes uncommitted and tells the user to switch to a branch.
# Non-destructive by design: only `git add -A`, `git commit` and a plain `git push`.
# Never force-pushes, resets, rebases, merges or deletes. If the push is rejected,
# the commit stays local and the reason is shown to the user.
set -uo pipefail

cd "${CLAUDE_PROJECT_DIR:-$(pwd)}" || exit 0
git rev-parse --is-inside-work-tree >/dev/null 2>&1 || exit 0

# Don't commit in the middle of a merge, rebase or cherry-pick.
gitdir=$(git rev-parse --git-dir)
for f in MERGE_HEAD REBASE_HEAD CHERRY_PICK_HEAD rebase-merge rebase-apply; do
  [ -e "$gitdir/$f" ] && exit 0
done

branch=$(git symbolic-ref --short -q HEAD) || exit 0   # detached HEAD: leave it alone
default=$(git symbolic-ref --short -q refs/remotes/origin/HEAD 2>/dev/null | sed 's#^origin/##')
default=${default:-main}

if [ "$branch" = "$default" ]; then
  if [ -n "$(git status --porcelain)" ]; then
    jq -cn --arg m "On $default: changes left uncommitted. Work reaches $default only through a pull request, so switch to a branch first." '{systemMessage: $m}'
  fi
  exit 0
fi

if [ -n "$(git status --porcelain)" ]; then
  git add -A
  git commit -q -m "Factory loop: auto-commit on stop" \
    -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" || exit 0
fi

# Push only if the branch has commits the remote doesn't have yet.
if git rev-parse -q --verify "origin/$branch" >/dev/null 2>&1; then
  [ -z "$(git log --oneline "origin/$branch..$branch")" ] && exit 0
fi

if ! out=$(git push -q -u origin "$branch" 2>&1); then
  reason=$(printf '%s' "$out" | grep -m1 -E 'denied|rejected|error|fatal' || echo "push failed")
  jq -cn --arg m "Auto-push of $branch failed, commits kept locally: $reason" '{systemMessage: $m}'
fi
exit 0
