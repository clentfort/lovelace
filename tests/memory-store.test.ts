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

      const candidate = store.createMemory({
        scope: "project",
        projectId: project.id,
        kind: "command",
        text: "Use `spacectl` for spacelift.",
        source: "heuristic",
        confidence: 0.5,
        status: "candidate",
      });
      expect(candidate.status).toBe("candidate");
      const promoted = store.createMemory({
        scope: "project",
        projectId: project.id,
        kind: "command",
        text: "Use `spacectl` for spacelift.",
        source: "heuristic",
        confidence: 0.9,
        status: "active",
      });
      expect(promoted.id).toBe(candidate.id);
      expect(promoted.status).toBe("active");

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

      const projectCmd = store.createMemory({
        scope: "project",
        projectId: project.id,
        kind: "command",
        text: "Use spacectl to inspect Spacelift stack state.",
        source: "llm",
        confidence: 0.82,
        status: "active",
      });
      store.createMemory({
        scope: "project",
        projectId: project.id,
        kind: "command",
        text: "Run pnpm test for local validation.",
        source: "llm",
        confidence: 0.82,
        status: "active",
      });
      const ranked = store.getRelevantMemories(project.id, task.id, {
        queryText: "check spacelift stack state with spacectl",
        limit: 5,
      });
      expect(ranked.length).toBeGreaterThan(0);
      expect(ranked[0].id).toBe(projectCmd.id);

      const statsContext = store.getMemoryStats(project.id, task.id, { contextOnly: true });
      expect(statsContext.total).toBeGreaterThanOrEqual(1);
      expect(statsContext.byScope.project).toBeGreaterThanOrEqual(1);
      expect(statsContext.byStatus.active).toBeGreaterThanOrEqual(1);
      expect(statsContext.bySource.llm).toBeGreaterThanOrEqual(1);

      const statsGlobal = store.getMemoryStats();
      expect(statsGlobal.total).toBeGreaterThanOrEqual(statsContext.total);

      const archiveByPrefix = store.archiveMemory(projectCmd.id.slice(0, 8));
      expect(archiveByPrefix.ok).toBe(true);
      expect(store.getMemoryById(projectCmd.id)?.status).toBe("archived");

      const archivedNoResurrect = store.createMemory({
        scope: "project",
        projectId: project.id,
        kind: "command",
        text: "Use spacectl to inspect Spacelift stack state.",
        source: "llm",
        confidence: 0.95,
        status: "active",
      });
      expect(archivedNoResurrect.id).toBe(projectCmd.id);
      expect(store.getMemoryById(projectCmd.id)?.status).toBe("archived");

      const archiveMissing = store.archiveMemory("deadbeef");
      expect(archiveMissing.ok).toBe(false);
      expect(archiveMissing.reason).toBe("not-found");

      const maintenance = store.runMemoryMaintenance(Date.now() + 400 * 24 * 60 * 60 * 1000);
      expect(maintenance.archivedCandidates).toBeGreaterThanOrEqual(0);
      expect(maintenance.archivedInactive).toBeGreaterThanOrEqual(0);
    } finally {
      store.close();
    }
  });

  it("tracks proposal evidence and auto-promotes repeated proposals", () => {
    const store = createStore();
    try {
      const project = store.upsertProject({
        name: "demo",
        rootPath: "/tmp/demo",
        gitRemote: null,
      });

      const first = store.proposeMemory({
        scope: "project",
        projectId: project.id,
        kind: "workflow",
        text: "We use Tool X for project workflows.",
        confidence: 0.83,
        sessionId: "session-a",
        evidenceFingerprint: "a1",
      });
      expect(first.proposal.status).toBe("proposed");
      expect(first.proposal.supportCount).toBe(1);
      expect(first.promotedMemory).toBeUndefined();

      const duplicateEvidence = store.proposeMemory({
        scope: "project",
        projectId: project.id,
        kind: "workflow",
        text: "We use Tool X for project workflows.",
        confidence: 0.83,
        sessionId: "session-a",
        evidenceFingerprint: "a1",
      });
      expect(duplicateEvidence.wasNewEvidence).toBe(false);
      expect(duplicateEvidence.proposal.supportCount).toBe(1);

      const second = store.proposeMemory({
        scope: "project",
        projectId: project.id,
        kind: "workflow",
        text: "We use Tool X for project workflows.",
        confidence: 0.86,
        sessionId: "session-b",
        evidenceFingerprint: "b1",
      });
      expect(second.proposal.distinctSessionCount).toBe(2);
      expect(second.promotedMemory).toBeUndefined();

      const third = store.proposeMemory({
        scope: "project",
        projectId: project.id,
        kind: "workflow",
        text: "We use Tool X for project workflows.",
        confidence: 0.9,
        sessionId: "session-c",
        evidenceFingerprint: "c1",
      });

      expect(third.proposal.status).toBe("promoted");
      expect(third.proposal.supportCount).toBe(3);
      expect(third.proposal.distinctSessionCount).toBe(3);
      expect(third.promotedMemory?.status).toBe("active");

      const proposals = store.listMemoryProposals(project.id, null, {
        statuses: ["proposed", "promoted"],
        contextOnly: true,
      });
      expect(proposals).toHaveLength(1);
      expect(proposals[0].status).toBe("promoted");

      const reject = store.rejectMemoryProposal(third.proposal.id.slice(0, 8));
      expect(reject.ok).toBe(true);
      if (!reject.ok) throw new Error("Expected proposal rejection to succeed");
      expect(reject.proposal.status).toBe("rejected");

      const rejectedHidden = store.listMemoryProposals(project.id, null, {
        statuses: ["proposed", "promoted"],
      });
      expect(rejectedHidden).toHaveLength(0);
    } finally {
      store.close();
    }
  });
});
