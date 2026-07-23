import test from "node:test";
import assert from "node:assert/strict";
import { nextState, STATES } from "../.codex/skills/github-resolve-merge-pr/scripts/pr-state.mjs";

const base = (overrides = {}) => ({
  authorized: true, labelled: true, sameRepository: true, withinScope: true,
  changedFiles: 4, changedLines: 120, headSha: "new", reviewHeadSha: "new",
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
test("unresolved actionable threads block readiness", () =>
  assert.equal(nextState(base({ unresolvedActionableThreads: 1 })).state, STATES.ADDRESSING_FEEDBACK));
test("failed CI retries once and blocks on the repeated cause", () => {
  assert.equal(nextState(base({ checks: ["failure"], sameCheckFailures: 1 })).state, STATES.ADDRESSING_FEEDBACK);
  assert.equal(nextState(base({ checks: ["failure"], sameCheckFailures: 2 })).state, STATES.BLOCKED);
});
test("forbidden risk is terminal", () =>
  assert.equal(nextState(base({ forbiddenRisks: ["deployment"] })).state, STATES.BLOCKED));
test("unknown diff size is ineligible", () =>
  assert.equal(nextState(base({ changedLines: undefined })).state, STATES.BLOCKED));
test("missing required-check data cannot become ready", () =>
  assert.equal(nextState(base({ checks: [] })).state, STATES.WAITING_FOR_REREVIEW));
test("more than three repair cycles is terminal", () =>
  assert.equal(nextState(base({ repairCycles: 4 })).state, STATES.BLOCKED));
test("dirty-checkout risk blocks local finalization", () =>
  assert.equal(nextState(base({ merged: true, localSyncSafe: false })).state, STATES.BLOCKED));
test("successful merge finalization completes", () =>
  assert.equal(nextState(base({ merged: true, finalized: true })).state, STATES.COMPLETE));
