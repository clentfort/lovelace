import assert from "node:assert/strict";
import { buildTaskContinuationSummary } from "../extensions/memory/src/continuation.ts";

const summary = buildTaskContinuationSummary({
	task: {
		id: "task-1",
		ref: "PROJ-321",
		sourceType: "manual",
		title: "Refactor retry handling",
		summary: null,
		status: "active",
		createdAt: 0,
		updatedAt: 0,
		lastSeenAt: 0,
	},
	pr: {
		id: "pr-1",
		projectId: "proj-1",
		prNumber: 42,
		prUrl: null,
		title: null,
		createdAt: 0,
		updatedAt: 0,
	},
	backlinkStatus: "pr-linked-to-task",
	branch: "feat/PROJ-321-retries",
	messages: [
		{ role: "user", content: "We are currently refactoring retry handling to keep idempotency." },
		{ role: "assistant", content: [{ type: "text", text: "Next I will inspect the retry middleware and wire the PR backlink." }] },
	],
});

assert.ok(summary);
assert.match(summary!, /Continuation summary for PROJ-321/);
assert.match(summary!, /Branch: feat\/PROJ-321-retries/);
assert.match(summary!, /Linked PR: #42/);
assert.match(summary!, /Latest user intent:/);
assert.match(summary!, /Latest assistant context:/);

console.log("continuation tests passed");
