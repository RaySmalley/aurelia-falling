---
name: github-resolve-merge-pr
description: Converge and complete an explicitly authorized, low-risk GitHub pull request. Use when Codex must monitor current-head Codex Cloud reviews, repair actionable threads, validate and push fixes, reply and resolve threads, enforce merge gates, merge, clean branches, synchronize the local default branch, and stop its PR babysitter.
---

# Resolve and Merge a PR

Advance only one state per scheduled run. Read repository `AGENTS.md` and the durable record at
`work/autonomous-pr/pr-<number>.json`; create the record atomically if absent. Use the bundled
`scripts/pr-state.mjs` for deterministic gate decisions.

## Establish eligibility

Require explicit user authorization, `codex-autonomous`, a ready non-fork PR whose head branch is
in the base repository, requested scope, repository limits, and safe rollback. Treat repository
forbidden categories as terminal. Never use admin override, force push, protection bypass, review
dismissal, or native auto-merge without a required current-head Codex-review gate.

Record PR URL, base/head branches, current SHA, state, timestamps, changed files/lines, risk result,
repair cycles, finding fingerprints and attempts, CI retries/causes, thread reply/resolution status,
stable polls, blocker reason, merge SHA, branch cleanup, local sync, task ID, and deployment result.
Require explicit, correctly typed safety counters and negative assessments; never rely on coercion
or missing values to pass a gate.

## Converge reviews

1. In `WAITING_FOR_REVIEW` or `WAITING_FOR_REREVIEW`, fetch PR metadata, checks, reviews, and
   thread-aware GraphQL state. A completed review by the repository-observed Codex Cloud bot counts
   only when its `commit_id` equals the current head SHA. For a review request recorded against the
   current head, the `eyes` reaction means reviewing, `+1` on the PR main post means completed with
   no findings only when that reaction was created at or after the recorded request, and no Codex
   reaction is indeterminate unless a current-head review proves findings.
2. Fetch every thread's node ID, `isResolved`, `isOutdated`, path/line, author, body, replies, and
   review commit. Ignore resolved, purely informational, duplicate, and non-actionable threads.
3. In `ADDRESSING_FEEDBACK`, map each smallest correct edit to finding fingerprints. Stop on
   ambiguity, contradiction, scope growth, a twice-returned substantive finding, or a cycle beyond
   the recorded maximum (default three). Only explicit user resumption may raise it by a bounded amount.
4. Run focused validation and repository-required validation. Allow one focused and one full retry
   for environmental failure; never alter product behavior to hide it. Commit and push the repair.
5. For each fixed thread, reply successfully with what changed, the repair commit SHA, and exact
   validation. Only then resolve its GraphQL thread. Record the new head SHA and return to
   `WAITING_FOR_REREVIEW`.

## Gate and merge

Re-fetch all state. Require the label, ready status, current-head completed Codex review, zero
unresolved actionable threads, successful/skipped/neutral required checks, satisfied review and
conversation rules, mergeability, required base currency, eligible risk, and two unchanged polls
at least two minutes apart. Treat a missing, negative, or non-integer actionable-thread count as
unknown and remain waiting. Reset stability on review activity or SHA change. Use the repository's
documented merge method only in `READY_TO_MERGE`.

Transition to `BLOCKED` for any repository hard blocker or a 30-minute current-head review wait.
Stop the babysitter and notify only for `BLOCKED` or successful `COMPLETE`.

## Finalize

Confirm the GitHub merge/base SHA and remote topic-branch deletion. Inspect every worktree and
status before changing local branches. Fetch/prune, switch only if safe, fast-forward the default
branch, verify it contains the merge, and delete the local topic branch only if unpushed-work and
checkout checks pass. Record whether deployment configuration exists and whether repository policy
requires deployment; treat missing or inconsistent evidence as unfinished. Perform required
post-merge deployment/health checks from the exact merged commit. Delete the scheduled task last,
then mark `COMPLETE`.
