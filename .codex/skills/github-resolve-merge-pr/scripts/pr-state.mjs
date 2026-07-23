export const STATES = Object.freeze({
  WAITING_FOR_REVIEW: "WAITING_FOR_REVIEW",
  ADDRESSING_FEEDBACK: "ADDRESSING_FEEDBACK",
  WAITING_FOR_REREVIEW: "WAITING_FOR_REREVIEW",
  READY_TO_MERGE: "READY_TO_MERGE",
  FINALIZING: "FINALIZING",
  COMPLETE: "COMPLETE",
  BLOCKED: "BLOCKED",
});

export const FORBIDDEN_RISKS = Object.freeze([
  "auth", "secrets", "billing", "destructive-migration", "customer-data",
  "production-infrastructure", "deployment", "major-dependency", "breaking-api",
  "security-sensitive", "irreversible",
]);

const result = (state, reason) => ({ state, reason });
const currentReview = (x) =>
  x.reviewCompleted && x.reviewHeadSha && x.reviewHeadSha === x.headSha;

export function eligibility(x) {
  if (!x.authorized) return "missing explicit authorization";
  if (!x.labelled) return "missing codex-autonomous label";
  if (!x.sameRepository) return "head branch is not in the base repository";
  if (!x.withinScope) return "change expanded beyond the approved request";
  if ((x.changedFiles ?? 0) > (x.maxFiles ?? 10)) return "changed-file limit exceeded";
  if ((x.changedLines ?? 0) > (x.maxLines ?? 500)) return "changed-line limit exceeded";
  if (x.unexplainedGenerated) return "unexplained generated files";
  if (x.unrelatedRefactor) return "unrelated refactoring";
  if (x.forbiddenRisks?.length) return `forbidden risk: ${x.forbiddenRisks.join(", ")}`;
  return null;
}

export function nextState(x) {
  if (x.merged) {
    if (!x.localSyncSafe) return result(STATES.BLOCKED, "local synchronization would risk user work");
    return x.finalized
      ? result(STATES.COMPLETE, "merge and safe finalization confirmed")
      : result(STATES.FINALIZING, "merge confirmed; finalize branches, checkout, task, and deployment");
  }
  const ineligible = eligibility(x);
  if (ineligible) return result(STATES.BLOCKED, ineligible);
  if ((x.repairCycles ?? 0) > 3) return result(STATES.BLOCKED, "repair-cycle limit exceeded");
  if ((x.sameFindingFixes ?? 0) >= 2) return result(STATES.BLOCKED, "substantive finding repeated twice");
  if ((x.reviewWaitMinutes ?? 0) >= 30 && !currentReview(x)) return result(STATES.BLOCKED, "current-head review timed out");
  if ((x.sameCheckFailures ?? 0) >= 2) return result(STATES.BLOCKED, "same required check failed twice");
  if (x.ambiguousFeedback || x.contradictoryFeedback) return result(STATES.BLOCKED, "feedback requires a decision");
  if (x.protectionUnsatisfied || x.rollbackUnsafe) return result(STATES.BLOCKED, "required protection or rollback gate failed");
  if (x.mergeable === false) return result(STATES.BLOCKED, "pull request has conflicts");
  if (!currentReview(x)) {
    return result(
      (x.repairCycles ?? 0) > 0 ? STATES.WAITING_FOR_REREVIEW : STATES.WAITING_FOR_REVIEW,
      "await completed Codex review for current head SHA",
    );
  }
  if ((x.unresolvedActionableThreads ?? 0) > 0)
    return result(STATES.ADDRESSING_FEEDBACK, "repair unresolved actionable review threads");
  const failed = x.checks?.some((c) => c === "failure" || c === "cancelled");
  const pending = x.checks?.some((c) => !["success", "skipped", "neutral"].includes(c));
  if (failed) return result(STATES.ADDRESSING_FEEDBACK, "repair or retry required checks");
  if (pending) return result(STATES.WAITING_FOR_REREVIEW, "required checks are still pending");
  if (!x.ready || !x.reviewsSatisfied || !x.conversationsResolved || !x.baseCurrent)
    return result(STATES.WAITING_FOR_REREVIEW, "merge gates are not yet satisfied");
  if ((x.stablePolls ?? 0) < 2 || (x.stableMinutes ?? 0) < 2)
    return result(STATES.WAITING_FOR_REREVIEW, "await the second unchanged poll");
  return result(STATES.READY_TO_MERGE, "all autonomous completion gates satisfied");
}
