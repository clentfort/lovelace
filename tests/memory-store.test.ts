import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LovelaceStore } from "../extensions/memory/src/db.ts";

const cleanupPaths: string[] = [];

afterEach(() => {
  while (cleanupPaths.length > 0) {
    const path = cleanupPaths.pop();
    if (path) rmSync(path, { recursive: true, force: true });
  }
});

function createStore() {
  const dir = mkdtempSync(join(tmpdir(), "lovelace-test-"));
  cleanupPaths.push(dir);
  const dbPath = join(dir, "memory.db");
  return new LovelaceStore(dbPath);
}

describe("LovelaceStore", () => {
  it("sanitizes text, promotes commands, tracks links, and lists recent tasks", () => {
    const store = createStore();
    try {
      const project = store.upsertProject({ name: "demo", rootPath: "/tmp/demo", gitRemote: null });
      const task = store.upsertTask({
        ref: "PROJ-100",
        title: "secret ghp_abcdefghijklmnopqrstuvwxyz123456",
      });
      const pr = store.upsertPr({
        projectId: project.id,
        prNumber: 123,
        title: "contains ghp_abcdefghijklmnopqrstuvwxyz123456",
      });

      expect(task.title).toBe("secret [REDACTED]");
      expect(pr.title).toBe("contains [REDACTED]");

      const first = store.noteProjectCommandSuccess(project.id, "pnpm test");
      expect(first.status).toBe("candidate");
      expect(first.confidence).toBe(0.55);

      const second = store.noteProjectCommandSuccess(project.id, "pnpm test");
      expect(second.status).toBe("candidate");
      expect(second.confidence).toBeCloseTo(0.7);

      const third = store.noteProjectCommandSuccess(project.id, "pnpm test");
      expect(third.confidence).toBeCloseTo(0.85);
      expect(third.status).toBe("active");

      const memory = store.createMemory({
        scope: "project",
        projectId: project.id,
        kind: "note",
        text: "token ghp_abcdefghijklmnopqrstuvwxyz123456",
      });
      expect(memory.text).toBe("token [REDACTED]");

      expect(store.upsertTaskPrLink(pr.id, task.id, "unknown")).toBe("unknown");
      expect(store.upsertTaskPrLink(pr.id, task.id, "pr-linked-to-task")).toBe("pr-linked-to-task");
      expect(store.upsertTaskPrLink(pr.id, task.id, "task-linked-to-pr")).toBe("both");

      const links = store.listPrsForTask(task.id);
      expect(links).toHaveLength(1);
      expect(links[0].backlinkStatus).toBe("both");
      expect(links[0].pr.prNumber).toBe(123);

      const continuation1 = store.upsertTaskContinuationSummary(
        task.id,
        "Continuation summary for PROJ-100\n- Keep going",
      );
      const continuation2 = store.upsertTaskContinuationSummary(
        task.id,
        "Continuation summary for PROJ-100\n- Latest focus changed",
      );
      expect(continuation1.id).toBe(continuation2.id);
      expect(continuation2.text).toMatch(/Latest focus changed/);

      store.upsertPiSession({
        piSessionId: "session-1",
        sessionFile: "/tmp/one",
        projectId: project.id,
        taskId: task.id,
      });
      const recent = store.listRecentTasksForProject(project.id);
      expect(recent).toHaveLength(1);
      expect(recent[0].ref).toBe("PROJ-100");
    } finally {
      store.close();
    }
  });
});
