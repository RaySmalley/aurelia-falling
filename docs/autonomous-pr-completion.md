# Autonomous PR completion runbook

Use this only for a ready, repository-owned PR explicitly authorized and labelled
`codex-autonomous`. The reusable procedure is `$github-resolve-merge-pr`; `AGENTS.md` owns Aurelia
Falling's thresholds, forbidden risks, validation, squash policy, and Sites finalization.

## Operation

Keep the computer on, network connected, this local project available, and GitHub authentication
valid. Create one in-chat task per PR, every three minutes, whose durable prompt includes the exact
repository and PR URL, invokes `$github-resolve-merge-pr`, reads
`work/autonomous-pr/pr-<number>.json`, and performs only the next state transition. Suppress
unchanged-run notifications. Delete the task at `COMPLETE` or `BLOCKED`; search existing tasks
before creating one to avoid duplicates.

The states are `WAITING_FOR_REVIEW`, `ADDRESSING_FEEDBACK`, `WAITING_FOR_REREVIEW`,
`READY_TO_MERGE`, `FINALIZING`, `COMPLETE`, and `BLOCKED`. The run record stores the head/review
SHAs, thread actions, repair cycles, recurring-finding fingerprints, CI retry causes, stability
polls/timestamps, blocker or merge SHA, branch cleanup, local sync, and deployment result.

Required validation is `npm run typecheck`, `npm run lint`, `npm run build`, and `npm test`, using
Node 24.18.0. Run focused checks first for repairs. After all pass, run `graphify update .`.

## GitHub and merge

Codex Cloud reviews are observed from `chatgpt-codex-connector[bot]`. For a request recorded against
the unchanged current head, 👀 on the PR means review in progress, 👍 means review completed with no
findings, and no Codex reaction is indeterminate unless a current-head review/thread proves findings.
Use thread-aware review state, not flat comments. Require positively known mergeability, then squash
only after the two-poll stability gate. GitHub native auto-merge remains off.

GitHub protections require pull requests, the real CI job, conversation resolution, and base
currency without granting admin bypass. Repository branches are deleted automatically after merge.

GitHub merge does not deploy Sites. After local `main` is fast-forwarded and the production build
passes, push that exact commit to the Sites source, save/deploy that commit, and confirm the
production URL. Preserve dirty work; report partial completion instead of discarding it.
