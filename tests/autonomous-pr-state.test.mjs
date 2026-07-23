import test from "node:test";
import assert from "node:assert/strict";
import { nextState, STATES } from "../.codex/skills/github-resolve-merge-pr/scripts/pr-state.mjs";

const base = (overrides = {}) => ({
  authorized: true, labelled: true, sameRepository: true, withinScope: true,
  changedFiles: 4, changedLines: 120, headSha: "new", reviewHeadSha: "new",
  riskAssessed: true, forbiddenRisks: [], rollbackSafe: true,
  reviewCompleted: true, unresolvedActionableThreads: 0, checks: ["success"],
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
test("current-head thumbs up is a completed clean review", () =>
  assert.equal(nextState(base({
    reviewCompleted: false, reviewHeadSha: null, codexReaction: "thumbs_up",
    reviewRequestHeadSha: "new",
  })).state, STATES.READY_TO_MERGE));
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
test("unresolved actionable threads block readiness", () =>
  assert.equal(nextState(base({ unresolvedActionableThreads: 1 })).state, STATES.ADDRESSING_FEEDBACK));
test("failed CI retries once and blocks on the repeated cause", () => {
  assert.equal(nextState(base({ checks: ["failure"], sameCheckFailures: 1 })).state, STATES.ADDRESSING_FEEDBACK);
  assert.equal(nextState(base({ checks: ["failure"], sameCheckFailures: 2 })).state, STATES.BLOCKED);
});
test("forbidden risk is terminal", () =>
  assert.equal(nextState(base({ forbiddenRisks: ["deployment"] })).state, STATES.BLOCKED));
test("missing reviewed risk assessment is ineligible", () =>
  assert.equal(nextState(base({ riskAssessed: undefined })).state, STATES.BLOCKED));
test("unknown diff size is ineligible", () =>
  assert.equal(nextState(base({ changedLines: undefined })).state, STATES.BLOCKED));
test("missing required-check data cannot become ready", () =>
  assert.equal(nextState(base({ checks: [] })).state, STATES.WAITING_FOR_REREVIEW));
test("a draft or unready PR is ineligible", () =>
  assert.equal(nextState(base({ ready: false, unresolvedActionableThreads: 1 })).state, STATES.BLOCKED));
test("terminal non-success check conclusions enter repair", () =>
  assert.equal(nextState(base({ checks: ["timed_out"] })).state, STATES.ADDRESSING_FEEDBACK));
test("more than three repair cycles is terminal", () =>
  assert.equal(nextState(base({ repairCycles: 4 })).state, STATES.BLOCKED));
test("an explicitly bounded resumed cycle can proceed", () =>
  assert.equal(nextState(base({ repairCycles: 4, maxRepairCycles: 4 })).state, STATES.READY_TO_MERGE));
test("unknown mergeability cannot become ready", () =>
  assert.equal(nextState(base({ mergeable: null })).state, STATES.WAITING_FOR_REREVIEW));
test("dirty-checkout risk blocks local finalization", () =>
  assert.equal(nextState(base({ merged: true, localSyncSafe: false })).state, STATES.BLOCKED));
test("required deployment keeps a merged PR finalizing", () =>
  assert.equal(nextState(base({ merged: true, finalized: true, deploymentRequired: true })).state, STATES.FINALIZING));
test("successful merge finalization completes", () =>
  assert.equal(nextState(base({ merged: true, finalized: true })).state, STATES.COMPLETE));
