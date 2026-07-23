## Summary

<!-- What changed, why, impact, and rollback. -->

## Validation

<!-- List focused checks and the repository-required validation. -->

## Autonomous completion eligibility

- [ ] The initiating user explicitly authorized autonomous completion.
- [ ] Apply `codex-autonomous` only after confirming this PR is ready and repository-owned.
- [ ] At most 10 files and 500 changed lines, excluding eligible lockfile churn.
- [ ] No unexplained generated files or unrelated refactoring.
- [ ] No authentication/authorization, secrets/permissions, billing/financial logic, destructive
      migration, customer-data control, production infrastructure, deployment/rollback/backup,
      major dependency, breaking API, non-trivial security, or irreversible change.
- [ ] Rollback is safe and the change remains within the approved request.
- [ ] Native auto-merge is off unless current-head Codex review is a required GitHub gate.

## Review completion

- [ ] Current-head Codex Cloud review completed.
- [ ] All actionable threads were repaired, replied to with commit/validation, and resolved.
- [ ] Required checks and repository merge gates passed.
