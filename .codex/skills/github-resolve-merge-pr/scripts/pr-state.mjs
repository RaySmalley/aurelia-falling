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
const hasSha = (value) => typeof value === "string" && value.trim().length > 0;
const cleanCodexReaction = (value) =>
  value === "+1" || value === "thumbs_up" || value === "THUMBS_UP";
const timestamp = (value) => typeof value === "string" ? Date.parse(value) : Number.NaN;
const currentReview = (x) => {
  if (!hasSha(x.headSha)) return false;
  if (x.reviewCompleted === true && hasSha(x.reviewHeadSha) && x.reviewHeadSha === x.headSha)
    return true;
  const requestTime = timestamp(x.reviewRequestCreatedAt);
  const reactionTime = timestamp(x.codexReactionCreatedAt);
  return cleanCodexReaction(x.codexReaction) &&
    hasSha(x.reviewRequestHeadSha) && x.reviewRequestHeadSha === x.headSha &&
    Number.isFinite(requestTime) && Number.isFinite(reactionTime) &&
    reactionTime >= requestTime;
};

export function eligibility(x) {
  if (x.authorized !== true) return "missing explicit authorization";
  if (x.labelled !== true) return "missing codex-autonomous label";
  if (x.sameRepository !== true) return "head branch is not in the base repository";
  if (x.ready !== true) return "pull request is not ready for review";
  if (x.withinScope !== true) return "change expanded beyond the approved request";
  if (!Number.isInteger(x.changedFiles) || !Number.isInteger(x.changedLines))
    return "changed-file and changed-line counts are required";
  if (x.riskAssessed !== true || !Array.isArray(x.forbiddenRisks))
    return "reviewed risk assessment is required";
  if (x.rollbackSafe !== true) return "safe rollback is not established";
  if (x.changedFiles > (x.maxFiles ?? 10)) return "changed-file limit exceeded";
  if (x.changedLines > (x.maxLines ?? 500)) return "changed-line limit exceeded";
  if (x.unexplainedGenerated) return "unexplained generated files";
  if (x.unrelatedRefactor) return "unrelated refactoring";
  if (x.forbiddenRisks.length) return `forbidden risk: ${x.forbiddenRisks.join(", ")}`;
  return null;
}

export function nextState(x) {
  if (x.merged === true) {
    if (x.localSyncSafe !== true) return result(STATES.BLOCKED, "local synchronization would risk user work");
    if (typeof x.deploymentConfigured !== "boolean" || typeof x.deploymentRequired !== "boolean" ||
        (x.deploymentConfigured && !x.deploymentRequired))
      return result(STATES.FINALIZING, "establish the repository deployment requirement");
    if (x.deploymentRequired && x.deploymentFailed)
      return result(STATES.BLOCKED, "required deployment failed");
    if (x.finalized !== true || (x.deploymentRequired && x.deploymentSucceeded !== true))
      return result(STATES.FINALIZING, "merge confirmed; finalize branches, checkout, task, and deployment");
    return result(STATES.COMPLETE, "merge and safe finalization confirmed");
  }
  const ineligible = eligibility(x);
  if (ineligible) return result(STATES.BLOCKED, ineligible);
  if ((x.repairCycles ?? 0) > (x.maxRepairCycles ?? 3))
    return result(STATES.BLOCKED, "repair-cycle limit exceeded");
  if ((x.sameFindingFixes ?? 0) >= 2) return result(STATES.BLOCKED, "substantive finding repeated twice");
  const hasKnownThreadCount =
    Number.isInteger(x.unresolvedActionableThreads) && x.unresolvedActionableThreads >= 0;
  const hasActionableThreads = hasKnownThreadCount && x.unresolvedActionableThreads > 0;
  if ((x.reviewWaitMinutes ?? 0) >= 30 && !currentReview(x) &&
      hasKnownThreadCount && x.unresolvedActionableThreads === 0)
    return result(STATES.BLOCKED, "current-head review timed out");
  if ((x.sameCheckFailures ?? 0) >= 2) return result(STATES.BLOCKED, "same required check failed twice");
  if (x.ambiguousFeedback || x.contradictoryFeedback) return result(STATES.BLOCKED, "feedback requires a decision");
  if (x.protectionUnsatisfied || x.rollbackUnsafe) return result(STATES.BLOCKED, "required protection or rollback gate failed");
  if (x.mergeable === false) return result(STATES.BLOCKED, "pull request has conflicts");
  if (x.mergeable !== true)
    return result(STATES.WAITING_FOR_REREVIEW, "pull request mergeability is still unknown");
  if (hasActionableThreads)
    return result(STATES.ADDRESSING_FEEDBACK, "repair unresolved actionable review threads");
  if (!currentReview(x)) {
    return result(
      (x.repairCycles ?? 0) > 0 ? STATES.WAITING_FOR_REREVIEW : STATES.WAITING_FOR_REVIEW,
      "await completed Codex review for current head SHA",
    );
  }
  if (!Number.isInteger(x.unresolvedActionableThreads) || x.unresolvedActionableThreads < 0)
    return result(STATES.WAITING_FOR_REREVIEW, "review-thread state is missing or invalid");
  if (!Array.isArray(x.checks) || x.checks.length === 0)
    return result(STATES.WAITING_FOR_REREVIEW, "required-check data is missing");
  const accepted = ["success", "skipped", "neutral"];
  const running = ["queued", "in_progress", "pending", "requested", "waiting"];
  const failed = x.checks.some((c) => !accepted.includes(c) && !running.includes(c));
  const pending = x.checks.some((c) => running.includes(c));
  if (failed) return result(STATES.ADDRESSING_FEEDBACK, "repair or retry required checks");
  if (pending) return result(STATES.WAITING_FOR_REREVIEW, "required checks are still pending");
  if (x.reviewsSatisfied !== true || x.conversationsResolved !== true || x.baseCurrent !== true)
    return result(STATES.WAITING_FOR_REREVIEW, "merge gates are not yet satisfied");
  if (!Number.isInteger(x.stablePolls) || x.stablePolls < 2 ||
      !Number.isFinite(x.stableMinutes) || x.stableMinutes < 2)
    return result(STATES.WAITING_FOR_REREVIEW, "await the second unchanged poll");
  return result(STATES.READY_TO_MERGE, "all autonomous completion gates satisfied");
}
