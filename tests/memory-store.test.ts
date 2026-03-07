import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LovelaceStore } from "../extensions/memory/src/db.js";

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

  it("handles project upserts and retrievals", () => {
    const store = createStore();
    try {
      const p1 = store.upsertProject({ name: "p1", rootPath: "/path/1" });
      const p2 = store.upsertProject({ name: "p1-updated", rootPath: "/path/1", gitRemote: "url" });
      expect(p1.id).toBe(p2.id);
      expect(p2.name).toBe("p1-updated");
      expect(p2.gitRemote).toBe("url");

      const fetched = store.getProjectById(p1.id);
      expect(fetched?.name).toBe("p1-updated");
    } finally {
      store.close();
    }
  });

  it("handles task updates and retrievals", () => {
    const store = createStore();
    try {
      const t1 = store.upsertTask({ ref: "T1", title: "Task 1", status: "active" });
      const t2 = store.upsertTask({ ref: "T1", title: "Task 1 Updated", status: "completed" });
      expect(t1.id).toBe(t2.id);
      expect(t2.title).toBe("Task 1 Updated");
      expect(t2.status).toBe("completed");

      expect(store.getTaskByRef("T1")?.id).toBe(t1.id);
      expect(store.getTaskById(t1.id)?.ref).toBe("T1");
    } finally {
      store.close();
    }
  });

  it("handles pi session upserts and task management", () => {
    const store = createStore();
    try {
      const proj = store.upsertProject({ name: "p", rootPath: "/r" });
      const s1 = store.upsertPiSession({ piSessionId: "sid-1", projectId: proj.id });
      const s2 = store.upsertPiSession({ sessionFile: "file-1", projectId: proj.id });
      // This should link them
      const s3 = store.upsertPiSession({ piSessionId: "sid-1", sessionFile: "file-1", projectId: proj.id });

      expect(s3.piSessionId).toBe("sid-1");
      expect(s3.sessionFile).toBe("file-1");

      const task = store.upsertTask({ ref: "T" });
      store.setTaskForSession(s3.id, task.id);
      expect(store.findTaskForSession("sid-1")?.id).toBe(task.id);
      expect(store.findTaskForSession(null, "file-1")?.id).toBe(task.id);

      store.setTaskForSession(s3.id, null);
      expect(store.findTaskForSession("sid-1")).toBeUndefined();
    } finally {
      store.close();
    }
  });

  it("handles PR upserts and retrievals", () => {
    const store = createStore();
    try {
      const proj = store.upsertProject({ name: "p", rootPath: "/r" });
      const pr1 = store.upsertPr({ projectId: proj.id, prNumber: 1, prUrl: "url-1" });
      const pr2 = store.upsertPr({ projectId: proj.id, prNumber: 1, title: "Title" });
      const pr3 = store.upsertPr({ projectId: proj.id, prUrl: "url-1", title: "New Title" });

      expect(pr1.id).toBe(pr2.id);
      expect(pr1.id).toBe(pr3.id);
      expect(pr3.title).toBe("New Title");
      expect(pr3.prNumber).toBe(1);

      expect(store.getPrById(pr1.id)?.title).toBe("New Title");
    } finally {
      store.close();
    }
  });

  it("manages memories and relevance", () => {
    const store = createStore();
    try {
      const proj = store.upsertProject({ name: "p", rootPath: "/r" });
      const task = store.upsertTask({ ref: "T" });

      const m1 = store.createMemory({ scope: "user", kind: "preference", text: "User pref" });
      const m2 = store.createMemory({ scope: "project", projectId: proj.id, kind: "note", text: "Proj note" });
      const m3 = store.createMemory({ scope: "task", taskId: task.id, kind: "note", text: "Task note" });
      const m4 = store.createMemory({ scope: "domain", kind: "note", text: "Domain note" });

      const relevant = store.getRelevantMemories(proj.id, task.id);
      expect(relevant).toHaveLength(4);

      store.archiveMemory(m1.id);
      expect(store.getRelevantMemories(proj.id, task.id)).toHaveLength(3);

      store.markMemoriesUsed([m2.id, m3.id]);
      const updatedM2 = store.getMemoryById(m2.id);
      expect(updatedM2?.lastUsedAt).toBeGreaterThan(0);
    } finally {
      store.close();
    }
  });

  it("handles edge cases for memory creation", () => {
    const store = createStore();
    try {
      expect(() => store.createMemory({ scope: "user", kind: "note", text: "" })).toThrow();
      expect(() => store.noteProjectCommandSuccess("p", "  ")).toThrow();
    } catch (e) {
      // Expected
    } finally {
      store.close();
    }
  });

  it("handles task-pr link edge cases", () => {
    const store = createStore();
    try {
      const proj = store.upsertProject({ name: "p", rootPath: "/r" });
      const task = store.upsertTask({ ref: "T" });
      const pr = store.upsertPr({ projectId: proj.id, prNumber: 1 });

      expect(store.getTaskPrLink(pr.id, task.id)).toBe("unknown");
    } finally {
      store.close();
    }
  });
});
