import { describe, expect, it } from "vitest";
import { backlinkLabel, formatMemoryBlock, isMemoryStale } from "../extensions/memory/src/view.ts";

describe("view helpers", () => {
	it("formats backlink labels and stale checks", () => {
		const now = new Date("2026-03-07T12:00:00Z").getTime();
		expect(backlinkLabel("both")).toBe("both-links");
		expect(backlinkLabel("unknown")).toBe("link?");
		expect(isMemoryStale({ scope: "task", source: "heuristic", updatedAt: now - 15 * 24 * 60 * 60 * 1000 }, now)).toBe(true);
		expect(isMemoryStale({ scope: "user", source: "manual", updatedAt: now - 365 * 24 * 60 * 60 * 1000 }, now)).toBe(false);
	});

	it("renders stale markers in memory blocks", () => {
		const now = new Date("2026-03-07T12:00:00Z").getTime();
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

			expect(block).toBeTruthy();
			expect(block).toMatch(/\[stale\] Old task note/);
			expect(block).toMatch(/Current task: PROJ-1/);
	});
});
