import test from "node:test";
import assert from "node:assert/strict";
import { nextState, STATES } from "../.codex/skills/github-resolve-merge-pr/scripts/pr-state.mjs";

const base = (overrides = {}) => ({
  authorized: true, labelled: true, sameRepository: true, withinScope: true,
  changedFiles: 4, changedLines: 120, headSha: "new", reviewHeadSha: "new",
  riskAssessed: true, forbiddenRisks: [], rollbackSafe: true,
  reviewCompleted: true, unresolvedActionableThreads: 0, checks: ["success"],
  reviewRequestCreatedAt: "2026-07-23T12:00:00Z",
  codexReactionCreatedAt: "2026-07-23T12:01:00Z",
  deploymentConfigured: false, deploymentRequired: false,
  ready: true, reviewsSatisfied: true, conversationsResolved: true, baseCurrent: true,
  mergeable: true, stablePolls: 2, stableMinutes: 2, localSyncSafe: true, ...overrides,
});

test("clean first review is ready", () =>
  assert.equal(nextState(base()).state, STATES.READY_TO_MERGE));
test("one repair moves through feedback and rereview", () => {
  assert.equal(nextState(base({ unresolvedActionableThreads: 1 })).state, STATES.ADDRESSING_FEEDBACK);
  assert.equal(nextState(base({ repairCycles: 1, reviewHeadSha: "old" })).state, STATES.WAITING_FOR_REREVIEW);
});
test("multiple repair cycles remain addressable below the cap", () =>
  assert.equal(nextState(base({ repairCycles: 3, unresolvedActionableThreads: 2 })).state, STATES.ADDRESSING_FEEDBACK));
test("an outdated review cannot satisfy the SHA gate", () =>
  assert.equal(nextState(base({ reviewHeadSha: "old", repairCycles: 1 })).state, STATES.WAITING_FOR_REREVIEW));
test("current-head +1 is a completed clean review", () =>
  assert.equal(nextState(base({
    reviewCompleted: false, reviewHeadSha: null, codexReaction: "+1",
    reviewRequestHeadSha: "new",
  })).state, STATES.READY_TO_MERGE));
test("normalized thumbs_up remains a completed clean review", () =>
  assert.equal(nextState(base({
    reviewCompleted: false, reviewHeadSha: null, codexReaction: "thumbs_up",
    reviewRequestHeadSha: "new",
  })).state, STATES.READY_TO_MERGE));
test("GraphQL THUMBS_UP is a completed clean review", () =>
  assert.equal(nextState(base({
    reviewCompleted: false, reviewHeadSha: null, codexReaction: "THUMBS_UP",
    reviewRequestHeadSha: "new",
  })).state, STATES.READY_TO_MERGE));
test("stale or undated clean reactions cannot satisfy the current-head gate", () => {
  assert.equal(nextState(base({
    reviewCompleted: false, reviewHeadSha: null, codexReaction: "+1",
    reviewRequestHeadSha: "new",
    reviewRequestCreatedAt: "2026-07-23T12:01:00Z",
    codexReactionCreatedAt: "2026-07-23T12:00:00Z",
  })).state, STATES.WAITING_FOR_REVIEW);
  for (const codexReactionCreatedAt of [undefined, "not-a-date"]) {
    assert.equal(nextState(base({
      reviewCompleted: false, reviewHeadSha: null, codexReaction: "+1",
      reviewRequestHeadSha: "new", codexReactionCreatedAt,
    })).state, STATES.WAITING_FOR_REVIEW);
  }
});
test("eyes or no reaction remains waiting without a review", () => {
  assert.equal(nextState(base({
    reviewCompleted: false, reviewHeadSha: null, codexReaction: "eyes",
    reviewRequestHeadSha: "new",
  })).state, STATES.WAITING_FOR_REVIEW);
  assert.equal(nextState(base({
    reviewCompleted: false, reviewHeadSha: null, codexReaction: null,
    reviewRequestHeadSha: "new",
  })).state, STATES.WAITING_FOR_REVIEW);
});
test("review evidence requires non-empty matching SHAs", () => {
  assert.equal(nextState(base({
    headSha: undefined, reviewHeadSha: undefined, reviewCompleted: true,
  })).state, STATES.WAITING_FOR_REVIEW);
  assert.equal(nextState(base({
    headSha: undefined, reviewCompleted: false, reviewHeadSha: null,
    codexReaction: "+1", reviewRequestHeadSha: undefined,
  })).state, STATES.WAITING_FOR_REVIEW);
});
test("unresolved actionable threads block readiness", () =>
  assert.equal(nextState(base({ unresolvedActionableThreads: 1 })).state, STATES.ADDRESSING_FEEDBACK));
test("current-head actionable threads enter repair before clean review completion", () =>
  assert.equal(nextState(base({
    reviewCompleted: false,
    reviewHeadSha: null,
    codexReaction: null,
    unresolvedActionableThreads: 1,
  })).state, STATES.ADDRESSING_FEEDBACK));
test("actionable threads enter repair instead of timing out", () =>
  assert.equal(nextState(base({
    reviewCompleted: false,
    reviewHeadSha: null,
    unresolvedActionableThreads: 1,
    reviewWaitMinutes: 30,
  })).state, STATES.ADDRESSING_FEEDBACK));
test("unknown review-thread state cannot become ready", () => {
  for (const unresolvedActionableThreads of [undefined, null, -1, 0.5]) {
    assert.equal(
      nextState(base({ unresolvedActionableThreads })).state,
      STATES.WAITING_FOR_REREVIEW,
    );
  }
});
test("unknown review-thread state cannot extend the review timeout", () => {
  for (const unresolvedActionableThreads of [undefined, null, -1, 0.5]) {
    assert.equal(nextState(base({
      reviewCompleted: false,
      reviewHeadSha: null,
      reviewWaitMinutes: 30,
      unresolvedActionableThreads,
    })).state, STATES.BLOCKED);
  }
});
test("failed CI retries once and blocks on the repeated cause", () => {
  assert.equal(nextState(base({ checks: ["failure"], sameCheckFailures: 1 })).state, STATES.ADDRESSING_FEEDBACK);
  assert.equal(nextState(base({ checks: ["failure"], sameCheckFailures: 2 })).state, STATES.BLOCKED);
});
test("forbidden risk is terminal", () =>
  assert.equal(nextState(base({ forbiddenRisks: ["deployment"] })).state, STATES.BLOCKED));
test("missing reviewed risk assessment is ineligible", () =>
  assert.equal(nextState(base({ riskAssessed: undefined })).state, STATES.BLOCKED));
test("allow-path booleans must be explicitly true", () => {
  for (const key of ["authorized", "labelled", "sameRepository", "withinScope"]) {
    assert.equal(nextState(base({ [key]: "false" })).state, STATES.BLOCKED);
  }
  assert.equal(nextState(base({ reviewCompleted: "false" })).state, STATES.WAITING_FOR_REVIEW);
  for (const key of ["reviewsSatisfied", "conversationsResolved", "baseCurrent"]) {
    assert.equal(nextState(base({ [key]: "false" })).state, STATES.WAITING_FOR_REREVIEW);
  }
  assert.equal(
    nextState(base({ merged: true, finalized: "false" })).state,
    STATES.FINALIZING,
  );
});
test("unknown diff size is ineligible", () =>
  assert.equal(nextState(base({ changedLines: undefined })).state, STATES.BLOCKED));
test("missing required-check data cannot become ready", () =>
  assert.equal(nextState(base({ checks: [] })).state, STATES.WAITING_FOR_REREVIEW));
test("a draft or unready PR is ineligible", () =>
  assert.equal(nextState(base({ ready: false, unresolvedActionableThreads: 1 })).state, STATES.BLOCKED));
test("terminal non-success check conclusions enter repair", () =>
  assert.equal(nextState(base({ checks: ["timed_out"] })).state, STATES.ADDRESSING_FEEDBACK));
test("GraphQL check enums are normalized before gating", () => {
  assert.equal(nextState(base({ checks: ["SUCCESS", "SKIPPED", "NEUTRAL"] })).state, STATES.READY_TO_MERGE);
  assert.equal(nextState(base({ checks: ["IN_PROGRESS"] })).state, STATES.WAITING_FOR_REREVIEW);
  assert.equal(nextState(base({ checks: ["TIMED_OUT"] })).state, STATES.ADDRESSING_FEEDBACK);
});
test("more than three repair cycles is terminal", () =>
  assert.equal(nextState(base({ repairCycles: 4 })).state, STATES.BLOCKED));
test("an explicitly bounded resumed cycle can proceed", () =>
  assert.equal(nextState(base({ repairCycles: 4, maxRepairCycles: 4 })).state, STATES.READY_TO_MERGE));
test("unknown mergeability cannot become ready", () =>
  assert.equal(nextState(base({ mergeable: null })).state, STATES.WAITING_FOR_REREVIEW));
test("stability evidence requires finite numeric values", () => {
  for (const stablePolls of [undefined, null, "2", 2.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.equal(nextState(base({ stablePolls })).state, STATES.WAITING_FOR_REREVIEW);
  }
  for (const stableMinutes of [undefined, null, "2", Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.equal(nextState(base({ stableMinutes })).state, STATES.WAITING_FOR_REREVIEW);
  }
});
test("dirty-checkout risk blocks local finalization", () =>
  assert.equal(nextState(base({ merged: true, localSyncSafe: false })).state, STATES.BLOCKED));
test("required deployment keeps a merged PR finalizing", () =>
  assert.equal(nextState(base({ merged: true, finalized: true, deploymentRequired: true })).state, STATES.FINALIZING));
test("deployment configuration must be explicit and consistent", () => {
  assert.equal(nextState(base({
    merged: true, finalized: true, deploymentConfigured: undefined,
  })).state, STATES.FINALIZING);
  assert.equal(nextState(base({
    merged: true, finalized: true, deploymentConfigured: true, deploymentRequired: false,
  })).state, STATES.FINALIZING);
});
test("successful merge finalization completes", () =>
  assert.equal(nextState(base({ merged: true, finalized: true })).state, STATES.COMPLETE));
