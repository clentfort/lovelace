import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { sanitizeFreeformText } from "./sanitize.js";
import type {
  BacklinkStatus,
  MemoryKind,
  MemoryProposalRecord,
  MemoryProposalSource,
  MemoryProposalStatus,
  MemoryRecord,
  MemoryScope,
  MemorySource,
  PiSessionRecord,
  PrRecord,
  ProjectRecord,
  TaskPrLinkRecord,
  TaskRecord,
  TaskSourceType,
} from "./types.js";

export interface UpsertProjectInput {
  name: string;
  rootPath: string;
  gitRemote?: string | null;
}

export interface UpsertTaskInput {
  ref: string;
  sourceType?: TaskSourceType;
  title?: string | null;
  summary?: string | null;
  status?: TaskRecord["status"];
}

export interface UpsertSessionInput {
  piSessionId?: string | null;
  sessionFile?: string | null;
  projectId: string;
  taskId?: string | null;
}

export interface UpsertPrInput {
  projectId: string;
  prNumber?: number | null;
  prUrl?: string | null;
  title?: string | null;
}

export interface CreateMemoryInput {
  scope: MemoryScope;
  projectId?: string | null;
  taskId?: string | null;
  kind: MemoryKind;
  text: string;
  confidence?: number;
  status?: MemoryRecord["status"];
  source?: MemorySource;
}

export interface ProposeMemoryInput {
  scope: MemoryScope;
  projectId?: string | null;
  taskId?: string | null;
  kind: MemoryKind;
  text: string;
  confidence?: number;
  source?: MemoryProposalSource;
  sessionId?: string | null;
  evidenceFingerprint?: string | null;
}

export interface MemoryProposalOutcome {
  proposal: MemoryProposalRecord;
  promotedMemory?: MemoryRecord;
  wasNewEvidence: boolean;
}

export interface ResolveByPrefixResult {
  ok: boolean;
  id?: string;
  reason?: "not-found" | "ambiguous";
  matches?: string[];
}

export interface MemoryStats {
  total: number;
  byStatus: Record<MemoryRecord["status"], number>;
  byScope: Record<MemoryScope, number>;
  bySource: Record<MemorySource, number>;
  createdLast24h: number;
  createdLast7d: number;
  createdLast30d: number;
}

export interface ArchiveMemoryResult {
  ok: boolean;
  id?: string;
  reason?: "not-found" | "ambiguous";
  matches?: string[];
}

export interface MemoryMaintenanceResult {
  archivedCandidates: number;
  archivedInactive: number;
}

function mergeBacklinkStatus(current: BacklinkStatus, next: BacklinkStatus): BacklinkStatus {
  if (current === "both" || next === "both") return "both";
  if (current === "unknown") return next;
  if (next === "unknown") return current;
  if (current !== next) return "both";
  return current;
}

function parseBacklinkStatus(metadataJson: string | null | undefined): BacklinkStatus {
  if (!metadataJson) return "unknown";
  try {
    const parsed = JSON.parse(metadataJson) as { backlinkStatus?: BacklinkStatus };
    return parsed.backlinkStatus ?? "unknown";
  } catch {
    return "unknown";
  }
}

const STOP_WORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "from",
  "that",
  "this",
  "have",
  "into",
  "your",
  "about",
  "just",
  "when",
  "what",
  "where",
  "will",
  "would",
  "should",
  "could",
  "can",
  "its",
  "our",
  "their",
  "then",
]);

function toTerms(text: string): string[] {
  return [
    ...new Set(
      text
        .toLowerCase()
        .split(/[^a-z0-9]+/g)
        .filter((term) => term.length >= 3),
    ),
  ]
    .filter((term) => !STOP_WORDS.has(term))
    .slice(0, 24);
}

function canonicalizeMemoryText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[`"']/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function clampConfidence(value: number | undefined): number {
  if (!Number.isFinite(value)) return 0.75;
  return Math.min(1, Math.max(0.4, value as number));
}

function scopeScore(scope: MemoryScope): number {
  switch (scope) {
    case "task":
      return 0.35;
    case "project":
      return 0.25;
    case "domain":
      return 0.18;
    case "user":
      return 0.12;
  }
}

function memoryScore(memory: MemoryRecord, queryTerms: string[], now: number): number {
  const textTerms = new Set(toTerms(memory.text));
  const matches = queryTerms.filter((term) => textTerms.has(term)).length;
  const lexical = queryTerms.length > 0 ? (matches / queryTerms.length) * 1.5 : 0;
  const ageDays = Math.max(0, now - memory.updatedAt) / (24 * 60 * 60 * 1000);
  const recency = Math.max(0, 1 - ageDays / 180) * 0.2;
  const lastUsedDays = memory.lastUsedAt
    ? Math.max(0, now - memory.lastUsedAt) / (24 * 60 * 60 * 1000)
    : 999;
  const usage = memory.lastUsedAt ? Math.max(0, 1 - lastUsedDays / 120) * 0.15 : 0;
  const continuationBoost =
    memory.scope === "task" && memory.text.startsWith("Continuation summary for ") ? 0.25 : 0;

  return (
    lexical +
    memory.confidence * 0.45 +
    scopeScore(memory.scope) +
    recency +
    usage +
    continuationBoost
  );
}

export class LovelaceStore {
  private db: Database.Database;

  constructor(dbPath: string) {
    mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.bootstrap();
  }

  private bootstrap() {
    this.db.exec(`
			CREATE TABLE IF NOT EXISTS projects (
				id TEXT PRIMARY KEY,
				name TEXT NOT NULL,
				root_path TEXT NOT NULL UNIQUE,
				git_remote TEXT,
				first_seen_at INTEGER NOT NULL,
				last_seen_at INTEGER NOT NULL
			);

			CREATE TABLE IF NOT EXISTS memories (
				id TEXT PRIMARY KEY,
				scope TEXT NOT NULL,
				project_id TEXT,
				task_id TEXT,
				kind TEXT NOT NULL,
				text TEXT NOT NULL,
				confidence REAL NOT NULL,
				status TEXT NOT NULL,
				source TEXT NOT NULL,
				created_at INTEGER NOT NULL,
				updated_at INTEGER NOT NULL,
				last_used_at INTEGER
			);

			CREATE TABLE IF NOT EXISTS memory_proposals (
				id TEXT PRIMARY KEY,
				scope TEXT NOT NULL,
				project_id TEXT,
				task_id TEXT,
				project_key TEXT NOT NULL DEFAULT '',
				task_key TEXT NOT NULL DEFAULT '',
				kind TEXT NOT NULL,
				text TEXT NOT NULL,
				text_canonical TEXT NOT NULL,
				status TEXT NOT NULL,
				source TEXT NOT NULL,
				confidence_max REAL NOT NULL,
				support_count INTEGER NOT NULL,
				distinct_session_count INTEGER NOT NULL,
				distinct_task_count INTEGER NOT NULL,
				promoted_memory_id TEXT,
				created_at INTEGER NOT NULL,
				updated_at INTEGER NOT NULL,
				first_seen_at INTEGER NOT NULL,
				last_seen_at INTEGER NOT NULL
			);

			CREATE TABLE IF NOT EXISTS memory_proposal_evidence (
				id TEXT PRIMARY KEY,
				proposal_id TEXT NOT NULL,
				session_id TEXT NOT NULL,
				task_id TEXT NOT NULL,
				source TEXT NOT NULL,
				evidence_fingerprint TEXT NOT NULL,
				confidence REAL NOT NULL,
				created_at INTEGER NOT NULL,
				UNIQUE(proposal_id, session_id, task_id, evidence_fingerprint)
			);

			CREATE TABLE IF NOT EXISTS tasks (
				id TEXT PRIMARY KEY,
				ref TEXT NOT NULL UNIQUE,
				source_type TEXT NOT NULL,
				title TEXT,
				summary TEXT,
				status TEXT NOT NULL,
				created_at INTEGER NOT NULL,
				updated_at INTEGER NOT NULL,
				last_seen_at INTEGER NOT NULL
			);

			CREATE TABLE IF NOT EXISTS pi_sessions (
				id TEXT PRIMARY KEY,
				pi_session_id TEXT UNIQUE,
				session_file TEXT UNIQUE,
				project_id TEXT NOT NULL,
				task_id TEXT,
				started_at INTEGER NOT NULL,
				updated_at INTEGER NOT NULL
			);

			CREATE TABLE IF NOT EXISTS prs (
				id TEXT PRIMARY KEY,
				project_id TEXT NOT NULL,
				pr_number INTEGER,
				pr_url TEXT,
				title TEXT,
				created_at INTEGER NOT NULL,
				updated_at INTEGER NOT NULL
			);

			CREATE UNIQUE INDEX IF NOT EXISTS idx_prs_project_number ON prs(project_id, pr_number) WHERE pr_number IS NOT NULL;
			CREATE UNIQUE INDEX IF NOT EXISTS idx_prs_url ON prs(pr_url) WHERE pr_url IS NOT NULL;

			CREATE TABLE IF NOT EXISTS edges (
				id TEXT PRIMARY KEY,
				from_type TEXT NOT NULL,
				from_id TEXT NOT NULL,
				edge_type TEXT NOT NULL,
				to_type TEXT NOT NULL,
				to_id TEXT NOT NULL,
				metadata_json TEXT,
				created_at INTEGER NOT NULL,
				UNIQUE(from_type, from_id, edge_type, to_type, to_id)
			);

			CREATE INDEX IF NOT EXISTS idx_projects_root_path ON projects(root_path);
			CREATE INDEX IF NOT EXISTS idx_memories_scope_project ON memories(scope, project_id, task_id, status);
			CREATE INDEX IF NOT EXISTS idx_memory_proposals_scope_status ON memory_proposals(scope, project_id, task_id, status, updated_at);
			CREATE INDEX IF NOT EXISTS idx_memory_proposals_status ON memory_proposals(status, updated_at);
			CREATE UNIQUE INDEX IF NOT EXISTS idx_memory_proposals_dedupe ON memory_proposals(scope, project_key, task_key, text_canonical);
			CREATE INDEX IF NOT EXISTS idx_memory_proposal_evidence_proposal ON memory_proposal_evidence(proposal_id, created_at);
			CREATE INDEX IF NOT EXISTS idx_tasks_ref ON tasks(ref);
			CREATE INDEX IF NOT EXISTS idx_sessions_file ON pi_sessions(session_file);
			CREATE INDEX IF NOT EXISTS idx_sessions_pi_id ON pi_sessions(pi_session_id);
			CREATE INDEX IF NOT EXISTS idx_edges_from ON edges(from_type, from_id);
			CREATE INDEX IF NOT EXISTS idx_edges_to ON edges(to_type, to_id);
		`);

    try {
      this.db.exec("ALTER TABLE memory_proposals ADD COLUMN project_key TEXT NOT NULL DEFAULT ''");
    } catch {
      // Column already exists.
    }
    try {
      this.db.exec("ALTER TABLE memory_proposals ADD COLUMN task_key TEXT NOT NULL DEFAULT ''");
    } catch {
      // Column already exists.
    }
    this.db.exec(
      "UPDATE memory_proposals SET project_key = IFNULL(project_id, ''), task_key = IFNULL(task_id, '')",
    );
  }

  close() {
    this.db.close();
  }

  upsertProject(input: UpsertProjectInput): ProjectRecord {
    const now = Date.now();
    const existing = this.db
      .prepare("SELECT * FROM projects WHERE root_path = ?")
      .get(input.rootPath) as ProjectRecord | undefined;

    if (existing) {
      this.db
        .prepare(
          `UPDATE projects
					 SET name = ?, git_remote = COALESCE(?, git_remote), last_seen_at = ?
					 WHERE id = ?`,
        )
        .run(input.name, input.gitRemote ?? null, now, existing.id);
      return this.getProjectById(existing.id)!;
    }

    const id = randomUUID();
    this.db
      .prepare(
        `INSERT INTO projects (id, name, root_path, git_remote, first_seen_at, last_seen_at)
				 VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(id, input.name, input.rootPath, input.gitRemote ?? null, now, now);
    return this.getProjectById(id)!;
  }

  getProjectById(id: string): ProjectRecord | undefined {
    return this.db
      .prepare(
        "SELECT id, name, root_path as rootPath, git_remote as gitRemote, first_seen_at as firstSeenAt, last_seen_at as lastSeenAt FROM projects WHERE id = ?",
      )
      .get(id) as ProjectRecord | undefined;
  }

  upsertTask(input: UpsertTaskInput): TaskRecord {
    const now = Date.now();
    const sanitizedTitle = sanitizeFreeformText(input.title);
    const sanitizedSummary = sanitizeFreeformText(input.summary);
    const existing = this.getTaskByRef(input.ref);
    if (existing) {
      this.db
        .prepare(
          `UPDATE tasks
					 SET source_type = COALESCE(?, source_type),
					     title = COALESCE(?, title),
					     summary = COALESCE(?, summary),
					     status = COALESCE(?, status),
					     updated_at = ?,
					     last_seen_at = ?
					 WHERE id = ?`,
        )
        .run(
          input.sourceType ?? null,
          sanitizedTitle,
          sanitizedSummary,
          input.status ?? null,
          now,
          now,
          existing.id,
        );
      return this.getTaskById(existing.id)!;
    }

    const id = randomUUID();
    this.db
      .prepare(
        `INSERT INTO tasks (id, ref, source_type, title, summary, status, created_at, updated_at, last_seen_at)
				 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.ref,
        input.sourceType ?? "manual",
        sanitizedTitle,
        sanitizedSummary,
        input.status ?? "active",
        now,
        now,
        now,
      );
    return this.getTaskById(id)!;
  }

  getTaskByRef(ref: string): TaskRecord | undefined {
    return this.db
      .prepare(
        "SELECT id, ref, source_type as sourceType, title, summary, status, created_at as createdAt, updated_at as updatedAt, last_seen_at as lastSeenAt FROM tasks WHERE ref = ?",
      )
      .get(ref) as TaskRecord | undefined;
  }

  getTaskById(id: string): TaskRecord | undefined {
    return this.db
      .prepare(
        "SELECT id, ref, source_type as sourceType, title, summary, status, created_at as createdAt, updated_at as updatedAt, last_seen_at as lastSeenAt FROM tasks WHERE id = ?",
      )
      .get(id) as TaskRecord | undefined;
  }

  upsertPiSession(input: UpsertSessionInput): PiSessionRecord {
    const now = Date.now();
    const existing = input.piSessionId
      ? ((this.db
          .prepare("SELECT * FROM pi_sessions WHERE pi_session_id = ?")
          .get(input.piSessionId) as PiSessionRecord | undefined) ??
        (input.sessionFile
          ? (this.db
              .prepare("SELECT * FROM pi_sessions WHERE session_file = ?")
              .get(input.sessionFile) as PiSessionRecord | undefined)
          : undefined))
      : input.sessionFile
        ? (this.db
            .prepare("SELECT * FROM pi_sessions WHERE session_file = ?")
            .get(input.sessionFile) as PiSessionRecord | undefined)
        : undefined;

    if (existing) {
      this.db
        .prepare(
          `UPDATE pi_sessions
					 SET pi_session_id = COALESCE(?, pi_session_id),
					     session_file = COALESCE(?, session_file),
					     project_id = ?,
					     task_id = COALESCE(?, task_id),
					     updated_at = ?
					 WHERE id = ?`,
        )
        .run(
          input.piSessionId ?? null,
          input.sessionFile ?? null,
          input.projectId,
          input.taskId ?? null,
          now,
          existing.id,
        );
      return this.getPiSessionById(existing.id)!;
    }

    const id = randomUUID();
    this.db
      .prepare(
        `INSERT INTO pi_sessions (id, pi_session_id, session_file, project_id, task_id, started_at, updated_at)
				 VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.piSessionId ?? null,
        input.sessionFile ?? null,
        input.projectId,
        input.taskId ?? null,
        now,
        now,
      );
    return this.getPiSessionById(id)!;
  }

  getPiSessionById(id: string): PiSessionRecord | undefined {
    return this.db
      .prepare(
        "SELECT id, pi_session_id as piSessionId, session_file as sessionFile, project_id as projectId, task_id as taskId, started_at as startedAt, updated_at as updatedAt FROM pi_sessions WHERE id = ?",
      )
      .get(id) as PiSessionRecord | undefined;
  }

  setTaskForSession(sessionId: string, taskId: string | null) {
    this.db
      .prepare("UPDATE pi_sessions SET task_id = ?, updated_at = ? WHERE id = ?")
      .run(taskId, Date.now(), sessionId);
  }

  findTaskForSession(
    piSessionId?: string | null,
    sessionFile?: string | null,
  ): TaskRecord | undefined {
    const session = piSessionId
      ? (this.db
          .prepare("SELECT task_id as taskId FROM pi_sessions WHERE pi_session_id = ?")
          .get(piSessionId) as { taskId: string | null } | undefined)
      : sessionFile
        ? (this.db
            .prepare("SELECT task_id as taskId FROM pi_sessions WHERE session_file = ?")
            .get(sessionFile) as { taskId: string | null } | undefined)
        : undefined;
    if (!session?.taskId) return undefined;
    return this.getTaskById(session.taskId);
  }

  listRecentTasksForProject(projectId: string, limit = 5): TaskRecord[] {
    return this.db
      .prepare(
        `SELECT t.id, t.ref, t.source_type as sourceType, t.title, t.summary, t.status, t.created_at as createdAt, t.updated_at as updatedAt, t.last_seen_at as lastSeenAt
				 FROM tasks t
				 JOIN pi_sessions s ON s.task_id = t.id
				 WHERE s.project_id = ? AND s.task_id IS NOT NULL
				 GROUP BY t.id
				 ORDER BY MAX(s.updated_at) DESC, t.last_seen_at DESC
				 LIMIT ?`,
      )
      .all(projectId, limit) as TaskRecord[];
  }

  upsertPr(input: UpsertPrInput): PrRecord {
    const now = Date.now();
    const sanitizedTitle = sanitizeFreeformText(input.title);
    let existing: PrRecord | undefined;
    if (input.prUrl) {
      existing = this.db
        .prepare(
          "SELECT id, project_id as projectId, pr_number as prNumber, pr_url as prUrl, title, created_at as createdAt, updated_at as updatedAt FROM prs WHERE pr_url = ?",
        )
        .get(input.prUrl) as PrRecord | undefined;
    }
    if (!existing && input.prNumber != null) {
      existing = this.db
        .prepare(
          "SELECT id, project_id as projectId, pr_number as prNumber, pr_url as prUrl, title, created_at as createdAt, updated_at as updatedAt FROM prs WHERE project_id = ? AND pr_number = ?",
        )
        .get(input.projectId, input.prNumber) as PrRecord | undefined;
    }
    if (existing) {
      this.db
        .prepare(
          `UPDATE prs
					 SET pr_number = COALESCE(?, pr_number), pr_url = COALESCE(?, pr_url), title = COALESCE(?, title), updated_at = ?
					 WHERE id = ?`,
        )
        .run(input.prNumber ?? null, input.prUrl ?? null, sanitizedTitle, now, existing.id);
      return this.getPrById(existing.id)!;
    }
    const id = randomUUID();
    this.db
      .prepare(
        `INSERT INTO prs (id, project_id, pr_number, pr_url, title, created_at, updated_at)
				 VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.projectId,
        input.prNumber ?? null,
        input.prUrl ?? null,
        sanitizedTitle,
        now,
        now,
      );
    return this.getPrById(id)!;
  }

  getPrById(id: string): PrRecord | undefined {
    return this.db
      .prepare(
        "SELECT id, project_id as projectId, pr_number as prNumber, pr_url as prUrl, title, created_at as createdAt, updated_at as updatedAt FROM prs WHERE id = ?",
      )
      .get(id) as PrRecord | undefined;
  }

  createEdge(
    fromType: string,
    fromId: string,
    edgeType: string,
    toType: string,
    toId: string,
    metadataJson?: string | null,
  ) {
    this.db
      .prepare(
        `INSERT INTO edges (id, from_type, from_id, edge_type, to_type, to_id, metadata_json, created_at)
				 VALUES (?, ?, ?, ?, ?, ?, ?, ?)
				 ON CONFLICT(from_type, from_id, edge_type, to_type, to_id)
				 DO UPDATE SET metadata_json = COALESCE(excluded.metadata_json, edges.metadata_json)`,
      )
      .run(
        randomUUID(),
        fromType,
        fromId,
        edgeType,
        toType,
        toId,
        metadataJson ?? null,
        Date.now(),
      );
  }

  upsertTaskPrLink(
    prId: string,
    taskId: string,
    backlinkStatus: BacklinkStatus = "unknown",
  ): BacklinkStatus {
    const existing = this.db
      .prepare(
        `SELECT metadata_json as metadataJson
				 FROM edges
				 WHERE from_type = 'pr' AND from_id = ? AND edge_type = 'relates_to' AND to_type = 'task' AND to_id = ?`,
      )
      .get(prId, taskId) as { metadataJson: string | null } | undefined;
    const merged = mergeBacklinkStatus(parseBacklinkStatus(existing?.metadataJson), backlinkStatus);
    this.createEdge(
      "pr",
      prId,
      "relates_to",
      "task",
      taskId,
      JSON.stringify({ backlinkStatus: merged }),
    );
    return merged;
  }

  getTaskPrLink(prId: string, taskId: string): BacklinkStatus {
    const row = this.db
      .prepare(
        `SELECT metadata_json as metadataJson
				 FROM edges
				 WHERE from_type = 'pr' AND from_id = ? AND edge_type = 'relates_to' AND to_type = 'task' AND to_id = ?`,
      )
      .get(prId, taskId) as { metadataJson: string | null } | undefined;
    return parseBacklinkStatus(row?.metadataJson);
  }

  private findMemory(
    scope: MemoryScope,
    text: string,
    projectId?: string | null,
    taskId?: string | null,
  ): MemoryRecord | undefined {
    return this.db
      .prepare(
        `SELECT id, scope, project_id as projectId, task_id as taskId, kind, text, confidence, status, source, created_at as createdAt, updated_at as updatedAt, last_used_at as lastUsedAt
				 FROM memories
				 WHERE scope = ? AND IFNULL(project_id, '') = IFNULL(?, '') AND IFNULL(task_id, '') = IFNULL(?, '') AND text = ?`,
      )
      .get(scope, projectId ?? null, taskId ?? null, text) as MemoryRecord | undefined;
  }

  createMemory(input: CreateMemoryInput): MemoryRecord {
    const normalized = sanitizeFreeformText(input.text);
    if (!normalized) throw new Error("Refusing to store empty memory");
    const existing = this.findMemory(input.scope, normalized, input.projectId, input.taskId);
    const now = Date.now();
    if (existing) {
      if (existing.status === "archived" && input.source !== "manual") {
        return existing;
      }
      this.db
        .prepare(
          "UPDATE memories SET updated_at = ?, source = ?, kind = ?, confidence = MAX(confidence, ?), status = CASE WHEN ? = 'active' THEN 'active' ELSE status END WHERE id = ?",
        )
        .run(
          now,
          input.source ?? "manual",
          input.kind,
          input.confidence ?? 1,
          input.status ?? "active",
          existing.id,
        );
      return this.getMemoryById(existing.id)!;
    }
    const id = randomUUID();
    this.db
      .prepare(
        `INSERT INTO memories (id, scope, project_id, task_id, kind, text, confidence, status, source, created_at, updated_at, last_used_at)
				 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
      )
      .run(
        id,
        input.scope,
        input.projectId ?? null,
        input.taskId ?? null,
        input.kind,
        normalized,
        input.confidence ?? 1,
        input.status ?? "active",
        input.source ?? "manual",
        now,
        now,
      );
    return this.getMemoryById(id)!;
  }

  getMemoryById(id: string): MemoryRecord | undefined {
    return this.db
      .prepare(
        "SELECT id, scope, project_id as projectId, task_id as taskId, kind, text, confidence, status, source, created_at as createdAt, updated_at as updatedAt, last_used_at as lastUsedAt FROM memories WHERE id = ?",
      )
      .get(id) as MemoryRecord | undefined;
  }

  private findMemoryProposal(
    scope: MemoryScope,
    projectId: string | null | undefined,
    taskId: string | null | undefined,
    textCanonical: string,
  ): MemoryProposalRecord | undefined {
    return this.db
      .prepare(
        `SELECT id, scope, project_id as projectId, task_id as taskId, kind, text, text_canonical as textCanonical, status, source,
                confidence_max as confidenceMax, support_count as supportCount, distinct_session_count as distinctSessionCount,
                distinct_task_count as distinctTaskCount, promoted_memory_id as promotedMemoryId,
                created_at as createdAt, updated_at as updatedAt, first_seen_at as firstSeenAt, last_seen_at as lastSeenAt
         FROM memory_proposals
         WHERE scope = ? AND project_key = ? AND task_key = ? AND text_canonical = ?`,
      )
      .get(scope, projectId ?? "", taskId ?? "", textCanonical) as MemoryProposalRecord | undefined;
  }

  getMemoryProposalById(id: string): MemoryProposalRecord | undefined {
    return this.db
      .prepare(
        `SELECT id, scope, project_id as projectId, task_id as taskId, kind, text, text_canonical as textCanonical, status, source,
                confidence_max as confidenceMax, support_count as supportCount, distinct_session_count as distinctSessionCount,
                distinct_task_count as distinctTaskCount, promoted_memory_id as promotedMemoryId,
                created_at as createdAt, updated_at as updatedAt, first_seen_at as firstSeenAt, last_seen_at as lastSeenAt
         FROM memory_proposals
         WHERE id = ?`,
      )
      .get(id) as MemoryProposalRecord | undefined;
  }

  private refreshProposalSupport(proposalId: string) {
    const counts = this.db
      .prepare(
        `SELECT
           COUNT(*) as supportCount,
           COUNT(DISTINCT CASE WHEN session_id != '' THEN session_id END) as distinctSessionCount,
           COUNT(DISTINCT CASE WHEN task_id != '' THEN task_id END) as distinctTaskCount
         FROM memory_proposal_evidence
         WHERE proposal_id = ?`,
      )
      .get(proposalId) as {
      supportCount: number;
      distinctSessionCount: number;
      distinctTaskCount: number;
    };

    this.db
      .prepare(
        `UPDATE memory_proposals
         SET support_count = ?, distinct_session_count = ?, distinct_task_count = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(
        counts.supportCount ?? 0,
        counts.distinctSessionCount ?? 0,
        counts.distinctTaskCount ?? 0,
        Date.now(),
        proposalId,
      );
  }

  private maybePromoteProposal(proposal: MemoryProposalRecord): MemoryRecord | undefined {
    if (proposal.status !== "proposed") return undefined;
    const minDistinctSessions = proposal.scope === "task" ? 2 : 3;
    if (proposal.distinctSessionCount < minDistinctSessions) return undefined;
    if (proposal.supportCount < minDistinctSessions) return undefined;
    if (proposal.confidenceMax < 0.68) return undefined;

    const promoted = this.createMemory({
      scope: proposal.scope,
      projectId: proposal.projectId,
      taskId: proposal.taskId,
      kind: proposal.kind,
      text: proposal.text,
      source: proposal.source === "manual" ? "manual" : "llm",
      confidence: proposal.confidenceMax,
      status: "active",
    });

    if (promoted.status !== "active") return undefined;

    this.db
      .prepare(
        "UPDATE memory_proposals SET status = 'promoted', promoted_memory_id = ?, updated_at = ? WHERE id = ?",
      )
      .run(promoted.id, Date.now(), proposal.id);

    return promoted;
  }

  proposeMemory(input: ProposeMemoryInput): MemoryProposalOutcome {
    const normalized = sanitizeFreeformText(input.text);
    if (!normalized) throw new Error("Refusing to store empty memory proposal");
    const textCanonical = canonicalizeMemoryText(normalized);
    if (!textCanonical) throw new Error("Refusing to store empty canonical memory proposal");

    const now = Date.now();
    const source = input.source ?? "llm";
    const confidence = clampConfidence(input.confidence);
    const sessionId = input.sessionId ?? "";
    const taskIdForEvidence = input.taskId ?? "";
    const evidenceFingerprint = input.evidenceFingerprint?.trim() || "";

    let proposal = this.findMemoryProposal(
      input.scope,
      input.projectId,
      input.taskId,
      textCanonical,
    );

    if (!proposal) {
      const id = randomUUID();
      this.db
        .prepare(
          `INSERT INTO memory_proposals (
             id, scope, project_id, task_id, project_key, task_key, kind, text, text_canonical,
             status, source, confidence_max, support_count, distinct_session_count, distinct_task_count,
             promoted_memory_id, created_at, updated_at, first_seen_at, last_seen_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'proposed', ?, ?, 0, 0, 0, NULL, ?, ?, ?, ?)`,
        )
        .run(
          id,
          input.scope,
          input.projectId ?? null,
          input.taskId ?? null,
          input.projectId ?? "",
          input.taskId ?? "",
          input.kind,
          normalized,
          textCanonical,
          source,
          confidence,
          now,
          now,
          now,
          now,
        );
      proposal = this.getMemoryProposalById(id)!;
    } else {
      this.db
        .prepare(
          `UPDATE memory_proposals
           SET updated_at = ?,
               last_seen_at = ?,
               confidence_max = MAX(confidence_max, ?),
               kind = ?,
               source = CASE WHEN source = 'manual' THEN source ELSE ? END
           WHERE id = ?`,
        )
        .run(now, now, confidence, input.kind, source, proposal.id);
      proposal = this.getMemoryProposalById(proposal.id)!;
    }

    if (proposal.status === "rejected" || proposal.status === "archived") {
      return { proposal, wasNewEvidence: false };
    }

    const evidenceInsert = this.db
      .prepare(
        `INSERT OR IGNORE INTO memory_proposal_evidence (
           id, proposal_id, session_id, task_id, source, evidence_fingerprint, confidence, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        randomUUID(),
        proposal.id,
        sessionId,
        taskIdForEvidence,
        source,
        evidenceFingerprint,
        confidence,
        now,
      );

    this.refreshProposalSupport(proposal.id);
    proposal = this.getMemoryProposalById(proposal.id)!;
    const promotedMemory = this.maybePromoteProposal(proposal);
    proposal = this.getMemoryProposalById(proposal.id)!;

    return {
      proposal,
      promotedMemory,
      wasNewEvidence: evidenceInsert.changes > 0,
    };
  }

  private resolveMemoryProposalId(idOrPrefix: string): ResolveByPrefixResult {
    const trimmed = idOrPrefix.trim();
    if (!trimmed) return { ok: false, reason: "not-found" };

    const exact = this.db.prepare("SELECT id FROM memory_proposals WHERE id = ?").get(trimmed) as
      | { id: string }
      | undefined;
    if (exact) return { ok: true, id: exact.id };

    const matches = this.db
      .prepare("SELECT id FROM memory_proposals WHERE id LIKE ? ORDER BY created_at DESC LIMIT 12")
      .all(`${trimmed}%`) as Array<{ id: string }>;
    if (matches.length === 0) return { ok: false, reason: "not-found" };
    if (matches.length > 1) {
      return { ok: false, reason: "ambiguous", matches: matches.map((row) => row.id) };
    }
    return { ok: true, id: matches[0].id };
  }

  listMemoryProposals(
    projectId?: string | null,
    taskId?: string | null,
    options?: {
      queryText?: string;
      limit?: number;
      statuses?: MemoryProposalStatus[];
      contextOnly?: boolean;
    },
  ): MemoryProposalRecord[] {
    const statuses = options?.statuses?.length
      ? options.statuses
      : (["proposed", "promoted"] as MemoryProposalStatus[]);
    const contextOnly = options?.contextOnly ?? true;

    const placeholders = statuses.map(() => "?").join(", ");
    const rows = (
      contextOnly
        ? this.db
            .prepare(
              `SELECT id, scope, project_id as projectId, task_id as taskId, kind, text, text_canonical as textCanonical, status, source,
                      confidence_max as confidenceMax, support_count as supportCount, distinct_session_count as distinctSessionCount,
                      distinct_task_count as distinctTaskCount, promoted_memory_id as promotedMemoryId,
                      created_at as createdAt, updated_at as updatedAt, first_seen_at as firstSeenAt, last_seen_at as lastSeenAt
               FROM memory_proposals
               WHERE status IN (${placeholders})
                 AND (
                   scope = 'user'
                   OR scope = 'domain'
                   OR (scope = 'project' AND project_id = ?)
                   OR (scope = 'task' AND task_id = ?)
                 )
               ORDER BY support_count DESC, distinct_session_count DESC, updated_at DESC
               LIMIT ?`,
            )
            .all(
              ...statuses,
              projectId ?? null,
              taskId ?? null,
              Math.max(1, Math.min(60, options?.limit ?? 20)),
            )
        : this.db
            .prepare(
              `SELECT id, scope, project_id as projectId, task_id as taskId, kind, text, text_canonical as textCanonical, status, source,
                      confidence_max as confidenceMax, support_count as supportCount, distinct_session_count as distinctSessionCount,
                      distinct_task_count as distinctTaskCount, promoted_memory_id as promotedMemoryId,
                      created_at as createdAt, updated_at as updatedAt, first_seen_at as firstSeenAt, last_seen_at as lastSeenAt
               FROM memory_proposals
               WHERE status IN (${placeholders})
               ORDER BY support_count DESC, distinct_session_count DESC, updated_at DESC
               LIMIT ?`,
            )
            .all(...statuses, Math.max(1, Math.min(60, options?.limit ?? 20)))
    ) as MemoryProposalRecord[];

    const queryTerms = toTerms(options?.queryText ?? "");
    if (queryTerms.length === 0) return rows;
    return rows
      .map((proposal) => {
        const proposalTerms = new Set(toTerms(proposal.text));
        const matches = queryTerms.filter((term) => proposalTerms.has(term)).length;
        return {
          proposal,
          score:
            matches * 1.4 +
            proposal.confidenceMax * 0.6 +
            Math.min(1, proposal.distinctSessionCount / 4) * 0.4 +
            Math.min(1, proposal.supportCount / 6) * 0.35,
        };
      })
      .sort((a, b) => b.score - a.score)
      .map((entry) => entry.proposal);
  }

  promoteMemoryProposal(
    idOrPrefix: string,
  ): { ok: true; proposal: MemoryProposalRecord; memory?: MemoryRecord } | ResolveByPrefixResult {
    const resolved = this.resolveMemoryProposalId(idOrPrefix);
    if (!resolved.ok || !resolved.id) return resolved;

    const proposal = this.getMemoryProposalById(resolved.id);
    if (!proposal) return { ok: false, reason: "not-found" };

    if (proposal.status === "promoted" && proposal.promotedMemoryId) {
      return {
        ok: true,
        proposal,
        memory: this.getMemoryById(proposal.promotedMemoryId),
      };
    }

    const memory = this.createMemory({
      scope: proposal.scope,
      projectId: proposal.projectId,
      taskId: proposal.taskId,
      kind: proposal.kind,
      text: proposal.text,
      source: proposal.source === "manual" ? "manual" : "llm",
      confidence: proposal.confidenceMax,
      status: "active",
    });

    this.db
      .prepare(
        "UPDATE memory_proposals SET status = 'promoted', promoted_memory_id = ?, updated_at = ? WHERE id = ?",
      )
      .run(memory.id, Date.now(), proposal.id);

    return {
      ok: true,
      proposal: this.getMemoryProposalById(proposal.id)!,
      memory,
    };
  }

  rejectMemoryProposal(
    idOrPrefix: string,
  ): { ok: true; proposal: MemoryProposalRecord } | ResolveByPrefixResult {
    const resolved = this.resolveMemoryProposalId(idOrPrefix);
    if (!resolved.ok || !resolved.id) return resolved;

    const proposal = this.getMemoryProposalById(resolved.id);
    if (!proposal) return { ok: false, reason: "not-found" };

    this.db
      .prepare("UPDATE memory_proposals SET status = 'rejected', updated_at = ? WHERE id = ?")
      .run(Date.now(), proposal.id);

    return {
      ok: true,
      proposal: this.getMemoryProposalById(proposal.id)!,
    };
  }

  archiveMemory(idOrPrefix: string): ArchiveMemoryResult {
    const trimmed = idOrPrefix.trim();
    if (!trimmed) return { ok: false, reason: "not-found" };

    const exact = this.db.prepare("SELECT id FROM memories WHERE id = ?").get(trimmed) as
      | { id: string }
      | undefined;
    if (exact) {
      this.db
        .prepare("UPDATE memories SET status = 'archived', updated_at = ? WHERE id = ?")
        .run(Date.now(), exact.id);
      return { ok: true, id: exact.id };
    }

    const matches = this.db
      .prepare("SELECT id FROM memories WHERE id LIKE ? ORDER BY created_at DESC LIMIT 12")
      .all(`${trimmed}%`) as Array<{ id: string }>;
    if (matches.length === 0) return { ok: false, reason: "not-found" };
    if (matches.length > 1) {
      return { ok: false, reason: "ambiguous", matches: matches.map((row) => row.id) };
    }

    const resolvedId = matches[0].id;
    this.db
      .prepare("UPDATE memories SET status = 'archived', updated_at = ? WHERE id = ?")
      .run(Date.now(), resolvedId);
    return { ok: true, id: resolvedId };
  }

  noteProjectCommandSuccess(projectId: string, command: string): MemoryRecord {
    const text = sanitizeFreeformText(
      `A useful working command in this repo is: \`${command.trim()}\``,
    );
    if (!text) throw new Error("Refusing to store empty command memory");
    const existing = this.findMemory("project", text, projectId, null);
    if (!existing) {
      return this.createMemory({
        scope: "project",
        projectId,
        kind: "command",
        text,
        source: "heuristic",
        confidence: 0.55,
        status: "candidate",
      });
    }
    const nextConfidence = Math.min(1, existing.confidence + 0.15);
    const nextStatus =
      existing.status === "active" || nextConfidence >= 0.85 ? "active" : existing.status;
    this.db
      .prepare("UPDATE memories SET confidence = ?, status = ?, updated_at = ? WHERE id = ?")
      .run(nextConfidence, nextStatus, Date.now(), existing.id);
    return this.getMemoryById(existing.id)!;
  }

  upsertTaskContinuationSummary(taskId: string, summary: string): MemoryRecord {
    const text = sanitizeFreeformText(summary);
    if (!text) throw new Error("Refusing to store empty continuation summary");
    const existing = this.db
      .prepare(
        `SELECT id, scope, project_id as projectId, task_id as taskId, kind, text, confidence, status, source, created_at as createdAt, updated_at as updatedAt, last_used_at as lastUsedAt
				 FROM memories
				 WHERE scope = 'task' AND task_id = ? AND kind = 'note' AND source = 'heuristic' AND text LIKE 'Continuation summary for %'
				 ORDER BY updated_at DESC
				 LIMIT 1`,
      )
      .get(taskId) as MemoryRecord | undefined;
    if (!existing) {
      return this.createMemory({
        scope: "task",
        taskId,
        kind: "note",
        text,
        source: "heuristic",
        confidence: 0.8,
        status: "active",
      });
    }
    this.db
      .prepare(
        "UPDATE memories SET text = ?, confidence = ?, status = 'active', updated_at = ? WHERE id = ?",
      )
      .run(text, Math.max(existing.confidence, 0.8), Date.now(), existing.id);
    return this.getMemoryById(existing.id)!;
  }

  getRelevantMemories(
    projectId?: string | null,
    taskId?: string | null,
    options?: { queryText?: string; limit?: number },
  ): MemoryRecord[] {
    const rows = this.db
      .prepare(
        `SELECT id, scope, project_id as projectId, task_id as taskId, kind, text, confidence, status, source, created_at as createdAt, updated_at as updatedAt, last_used_at as lastUsedAt
				 FROM memories
				 WHERE status = 'active'
				   AND (
					 scope = 'user'
					 OR scope = 'domain'
					 OR (scope = 'project' AND project_id = ?)
					 OR (scope = 'task' AND task_id = ?)
				   )
				 ORDER BY updated_at DESC
				 LIMIT 250`,
      )
      .all(projectId ?? null, taskId ?? null) as MemoryRecord[];

    const queryTerms = toTerms(options?.queryText ?? "");
    const now = Date.now();
    const scored = rows
      .map((memory) => ({ memory, score: memoryScore(memory, queryTerms, now) }))
      .sort((a, b) => b.score - a.score);

    const totalLimit = Math.max(1, Math.min(40, options?.limit ?? 20));
    const caps: Record<MemoryScope, number> = {
      user: 3,
      project: 8,
      domain: 4,
      task: 6,
    };
    const selected: MemoryRecord[] = [];
    const counts: Record<MemoryScope, number> = { user: 0, project: 0, domain: 0, task: 0 };

    for (const entry of scored) {
      if (selected.length >= totalLimit) break;
      if (counts[entry.memory.scope] >= caps[entry.memory.scope]) continue;
      selected.push(entry.memory);
      counts[entry.memory.scope] += 1;
    }

    return selected;
  }

  getMemoryStats(
    projectId?: string | null,
    taskId?: string | null,
    options?: { contextOnly?: boolean },
  ): MemoryStats {
    const contextOnly = options?.contextOnly ?? false;
    const rows = (
      contextOnly
        ? this.db
            .prepare(
              `SELECT scope, status, source, created_at as createdAt
             FROM memories
             WHERE
               scope = 'user'
               OR scope = 'domain'
               OR (scope = 'project' AND project_id = ?)
               OR (scope = 'task' AND task_id = ?)`,
            )
            .all(projectId ?? null, taskId ?? null)
        : this.db
            .prepare(
              `SELECT scope, status, source, created_at as createdAt
             FROM memories`,
            )
            .all()
    ) as Array<{
      scope: MemoryScope;
      status: MemoryRecord["status"];
      source: MemorySource;
      createdAt: number;
    }>;

    const now = Date.now();
    const day = 24 * 60 * 60 * 1000;
    const byStatus: Record<MemoryRecord["status"], number> = {
      candidate: 0,
      active: 0,
      archived: 0,
    };
    const byScope: Record<MemoryScope, number> = {
      user: 0,
      project: 0,
      domain: 0,
      task: 0,
    };
    const bySource: Record<MemorySource, number> = {
      manual: 0,
      heuristic: 0,
      scan: 0,
      llm: 0,
    };

    let createdLast24h = 0;
    let createdLast7d = 0;
    let createdLast30d = 0;

    for (const row of rows) {
      byStatus[row.status] += 1;
      byScope[row.scope] += 1;
      bySource[row.source] += 1;
      const age = now - row.createdAt;
      if (age <= day) createdLast24h += 1;
      if (age <= 7 * day) createdLast7d += 1;
      if (age <= 30 * day) createdLast30d += 1;
    }

    return {
      total: rows.length,
      byStatus,
      byScope,
      bySource,
      createdLast24h,
      createdLast7d,
      createdLast30d,
    };
  }

  runMemoryMaintenance(now = Date.now()): MemoryMaintenanceResult {
    const candidateCutoff = now - 90 * 24 * 60 * 60 * 1000;
    const inactiveCutoff = now - 365 * 24 * 60 * 60 * 1000;

    const archivedCandidates = this.db
      .prepare(
        `UPDATE memories
         SET status = 'archived', updated_at = ?
         WHERE status = 'candidate'
           AND source != 'manual'
           AND updated_at < ?`,
      )
      .run(now, candidateCutoff).changes;

    const archivedInactive = this.db
      .prepare(
        `UPDATE memories
         SET status = 'archived', updated_at = ?
         WHERE status = 'active'
           AND source != 'manual'
           AND IFNULL(last_used_at, updated_at) < ?`,
      )
      .run(now, inactiveCutoff).changes;

    return { archivedCandidates, archivedInactive };
  }

  markMemoriesUsed(ids: string[]) {
    if (ids.length === 0) return;
    const placeholders = ids.map(() => "?").join(", ");
    this.db
      .prepare(`UPDATE memories SET last_used_at = ? WHERE id IN (${placeholders})`)
      .run(Date.now(), ...ids);
  }

  listPrsForTask(taskId: string): TaskPrLinkRecord[] {
    const rows = this.db
      .prepare(
        `SELECT p.id, p.project_id as projectId, p.pr_number as prNumber, p.pr_url as prUrl, p.title, p.created_at as createdAt, p.updated_at as updatedAt,
				        e.metadata_json as metadataJson
				 FROM prs p
				 JOIN edges e ON e.from_type = 'pr' AND e.from_id = p.id AND e.edge_type = 'relates_to' AND e.to_type = 'task' AND e.to_id = ?
				 ORDER BY p.updated_at DESC`,
      )
      .all(taskId) as Array<PrRecord & { metadataJson: string | null }>;
    return rows.map(({ metadataJson, ...pr }) => ({
      pr,
      backlinkStatus: parseBacklinkStatus(metadataJson),
    }));
  }
}
