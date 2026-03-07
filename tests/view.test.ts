import assert from "node:assert/strict";
import { backlinkLabel, formatMemoryBlock, isMemoryStale } from "../extensions/memory/src/view.ts";

const now = new Date("2026-03-07T12:00:00Z").getTime();

assert.equal(backlinkLabel("both"), "both-links");
assert.equal(backlinkLabel("unknown"), "link?");
assert.equal(
	isMemoryStale({ scope: "task", source: "heuristic", updatedAt: now - 15 * 24 * 60 * 60 * 1000 }, now),
	true,
);
assert.equal(
	isMemoryStale({ scope: "user", source: "manual", updatedAt: now - 365 * 24 * 60 * 60 * 1000 }, now),
	false,
);

const block = formatMemoryBlock(
	[
		{
			id: "1",
			scope: "task",
			projectId: null,
			taskId: "t1",
			kind: "note",
			text: "Old task note",
			confidence: 0.7,
			status: "active",
			source: "heuristic",
			createdAt: now,
			updatedAt: now - 16 * 24 * 60 * 60 * 1000,
			lastUsedAt: null,
		},
	],
	{ id: "t1", ref: "PROJ-1", sourceType: "manual", title: "Demo", summary: null, status: "active", createdAt: now, updatedAt: now, lastSeenAt: now },
	undefined,
	undefined,
	now,
);

assert.ok(block);
assert.match(block!, /\[stale\] Old task note/);
assert.match(block!, /Current task: PROJ-1/);

console.log("view tests passed");
