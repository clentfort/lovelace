import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import { LovelaceStore } from "../extensions/memory/src/db.ts";

const dir = mkdtempSync(join(tmpdir(), "lovelace-test-"));
const dbPath = join(dir, "memory.db");
const store = new LovelaceStore(dbPath);

try {
	const project = store.upsertProject({ name: "demo", rootPath: "/tmp/demo", gitRemote: null });
	const task = store.upsertTask({ ref: "PROJ-100", title: "secret ghp_abcdefghijklmnopqrstuvwxyz123456" });
	const pr = store.upsertPr({ projectId: project.id, prNumber: 123, title: "contains ghp_abcdefghijklmnopqrstuvwxyz123456" });

	assert.equal(task.title, "secret [REDACTED]");
	assert.equal(pr.title, "contains [REDACTED]");

	const first = store.noteProjectCommandSuccess(project.id, "pnpm test");
	assert.equal(first.status, "candidate");
	assert.equal(first.confidence, 0.55);

	const second = store.noteProjectCommandSuccess(project.id, "pnpm test");
	assert.equal(second.status, "candidate");
	assert.ok(Math.abs(second.confidence - 0.7) < 1e-9);

	const third = store.noteProjectCommandSuccess(project.id, "pnpm test");
	assert.ok(Math.abs(third.confidence - 0.85) < 1e-9);
	assert.equal(third.status, "active");

	const memory = store.createMemory({
		scope: "project",
		projectId: project.id,
		kind: "note",
		text: "token ghp_abcdefghijklmnopqrstuvwxyz123456",
	});
	assert.equal(memory.text, "token [REDACTED]");

	const unknown = store.upsertTaskPrLink(pr.id, task.id, "unknown");
	assert.equal(unknown, "unknown");
	const prLinked = store.upsertTaskPrLink(pr.id, task.id, "pr-linked-to-task");
	assert.equal(prLinked, "pr-linked-to-task");
	const both = store.upsertTaskPrLink(pr.id, task.id, "task-linked-to-pr");
	assert.equal(both, "both");

	const links = store.listPrsForTask(task.id);
	assert.equal(links.length, 1);
	assert.equal(links[0].backlinkStatus, "both");
	assert.equal(links[0].pr.prNumber, 123);

	const continuation1 = store.upsertTaskContinuationSummary(task.id, "Continuation summary for PROJ-100\n- Keep going");
	const continuation2 = store.upsertTaskContinuationSummary(task.id, "Continuation summary for PROJ-100\n- Latest focus changed");
	assert.equal(continuation1.id, continuation2.id);
	assert.match(continuation2.text, /Latest focus changed/);

	store.upsertPiSession({ piSessionId: "session-1", sessionFile: "/tmp/one", projectId: project.id, taskId: task.id });
	const recent = store.listRecentTasksForProject(project.id);
	assert.equal(recent.length, 1);
	assert.equal(recent[0].ref, "PROJ-100");

	console.log("memory-store tests passed");
} finally {
	store.close();
	rmSync(dir, { recursive: true, force: true });
}
