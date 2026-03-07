import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import type { MemoryKind, MemoryRecord, MemoryScope, MemorySource, PiSessionRecord, PrRecord, ProjectRecord, TaskRecord, TaskSourceType } from "./types.js";

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
			CREATE INDEX IF NOT EXISTS idx_tasks_ref ON tasks(ref);
			CREATE INDEX IF NOT EXISTS idx_sessions_file ON pi_sessions(session_file);
			CREATE INDEX IF NOT EXISTS idx_sessions_pi_id ON pi_sessions(pi_session_id);
			CREATE INDEX IF NOT EXISTS idx_edges_from ON edges(from_type, from_id);
			CREATE INDEX IF NOT EXISTS idx_edges_to ON edges(to_type, to_id);
		`);
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
		return this.db.prepare("SELECT id, name, root_path as rootPath, git_remote as gitRemote, first_seen_at as firstSeenAt, last_seen_at as lastSeenAt FROM projects WHERE id = ?").get(id) as ProjectRecord | undefined;
	}

	upsertTask(input: UpsertTaskInput): TaskRecord {
		const now = Date.now();
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
				.run(input.sourceType ?? null, input.title ?? null, input.summary ?? null, input.status ?? null, now, now, existing.id);
			return this.getTaskById(existing.id)!;
		}

		const id = randomUUID();
		this.db
			.prepare(
				`INSERT INTO tasks (id, ref, source_type, title, summary, status, created_at, updated_at, last_seen_at)
				 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			)
			.run(id, input.ref, input.sourceType ?? "manual", input.title ?? null, input.summary ?? null, input.status ?? "active", now, now, now);
		return this.getTaskById(id)!;
	}

	getTaskByRef(ref: string): TaskRecord | undefined {
		return this.db.prepare("SELECT id, ref, source_type as sourceType, title, summary, status, created_at as createdAt, updated_at as updatedAt, last_seen_at as lastSeenAt FROM tasks WHERE ref = ?").get(ref) as TaskRecord | undefined;
	}

	getTaskById(id: string): TaskRecord | undefined {
		return this.db.prepare("SELECT id, ref, source_type as sourceType, title, summary, status, created_at as createdAt, updated_at as updatedAt, last_seen_at as lastSeenAt FROM tasks WHERE id = ?").get(id) as TaskRecord | undefined;
	}

	upsertPiSession(input: UpsertSessionInput): PiSessionRecord {
		const now = Date.now();
		const existing = input.piSessionId
			? ((this.db.prepare("SELECT * FROM pi_sessions WHERE pi_session_id = ?").get(input.piSessionId) as PiSessionRecord | undefined) ??
				(input.sessionFile
					? (this.db.prepare("SELECT * FROM pi_sessions WHERE session_file = ?").get(input.sessionFile) as PiSessionRecord | undefined)
					: undefined))
			: input.sessionFile
				? (this.db.prepare("SELECT * FROM pi_sessions WHERE session_file = ?").get(input.sessionFile) as PiSessionRecord | undefined)
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
				.run(input.piSessionId ?? null, input.sessionFile ?? null, input.projectId, input.taskId ?? null, now, existing.id);
			return this.getPiSessionById(existing.id)!;
		}

		const id = randomUUID();
		this.db
			.prepare(
				`INSERT INTO pi_sessions (id, pi_session_id, session_file, project_id, task_id, started_at, updated_at)
				 VALUES (?, ?, ?, ?, ?, ?, ?)`,
			)
			.run(id, input.piSessionId ?? null, input.sessionFile ?? null, input.projectId, input.taskId ?? null, now, now);
		return this.getPiSessionById(id)!;
	}

	getPiSessionById(id: string): PiSessionRecord | undefined {
		return this.db.prepare("SELECT id, pi_session_id as piSessionId, session_file as sessionFile, project_id as projectId, task_id as taskId, started_at as startedAt, updated_at as updatedAt FROM pi_sessions WHERE id = ?").get(id) as PiSessionRecord | undefined;
	}

	setTaskForSession(sessionId: string, taskId: string | null) {
		this.db.prepare("UPDATE pi_sessions SET task_id = ?, updated_at = ? WHERE id = ?").run(taskId, Date.now(), sessionId);
	}

	findTaskForSession(piSessionId?: string | null, sessionFile?: string | null): TaskRecord | undefined {
		const session = piSessionId
			? (this.db.prepare("SELECT task_id as taskId FROM pi_sessions WHERE pi_session_id = ?").get(piSessionId) as { taskId: string | null } | undefined)
			: sessionFile
				? (this.db.prepare("SELECT task_id as taskId FROM pi_sessions WHERE session_file = ?").get(sessionFile) as { taskId: string | null } | undefined)
				: undefined;
		if (!session?.taskId) return undefined;
		return this.getTaskById(session.taskId);
	}

	upsertPr(input: UpsertPrInput): PrRecord {
		const now = Date.now();
		let existing: PrRecord | undefined;
		if (input.prUrl) {
			existing = this.db.prepare("SELECT id, project_id as projectId, pr_number as prNumber, pr_url as prUrl, title, created_at as createdAt, updated_at as updatedAt FROM prs WHERE pr_url = ?").get(input.prUrl) as PrRecord | undefined;
		}
		if (!existing && input.prNumber != null) {
			existing = this.db.prepare("SELECT id, project_id as projectId, pr_number as prNumber, pr_url as prUrl, title, created_at as createdAt, updated_at as updatedAt FROM prs WHERE project_id = ? AND pr_number = ?").get(input.projectId, input.prNumber) as PrRecord | undefined;
		}
		if (existing) {
			this.db
				.prepare(
					`UPDATE prs
					 SET pr_number = COALESCE(?, pr_number), pr_url = COALESCE(?, pr_url), title = COALESCE(?, title), updated_at = ?
					 WHERE id = ?`,
				)
				.run(input.prNumber ?? null, input.prUrl ?? null, input.title ?? null, now, existing.id);
			return this.getPrById(existing.id)!;
		}
		const id = randomUUID();
		this.db
			.prepare(
				`INSERT INTO prs (id, project_id, pr_number, pr_url, title, created_at, updated_at)
				 VALUES (?, ?, ?, ?, ?, ?, ?)`,
			)
			.run(id, input.projectId, input.prNumber ?? null, input.prUrl ?? null, input.title ?? null, now, now);
		return this.getPrById(id)!;
	}

	getPrById(id: string): PrRecord | undefined {
		return this.db.prepare("SELECT id, project_id as projectId, pr_number as prNumber, pr_url as prUrl, title, created_at as createdAt, updated_at as updatedAt FROM prs WHERE id = ?").get(id) as PrRecord | undefined;
	}

	createEdge(fromType: string, fromId: string, edgeType: string, toType: string, toId: string, metadataJson?: string | null) {
		this.db
			.prepare(
				`INSERT INTO edges (id, from_type, from_id, edge_type, to_type, to_id, metadata_json, created_at)
				 VALUES (?, ?, ?, ?, ?, ?, ?, ?)
				 ON CONFLICT(from_type, from_id, edge_type, to_type, to_id) DO NOTHING`,
			)
			.run(randomUUID(), fromType, fromId, edgeType, toType, toId, metadataJson ?? null, Date.now());
	}

	createMemory(input: CreateMemoryInput): MemoryRecord {
		const normalized = input.text.trim();
		const existing = this.db
			.prepare(
				`SELECT id, scope, project_id as projectId, task_id as taskId, kind, text, confidence, status, source, created_at as createdAt, updated_at as updatedAt, last_used_at as lastUsedAt
				 FROM memories
				 WHERE scope = ? AND IFNULL(project_id, '') = IFNULL(?, '') AND IFNULL(task_id, '') = IFNULL(?, '') AND text = ? AND status != 'archived'`,
			)
			.get(input.scope, input.projectId ?? null, input.taskId ?? null, normalized) as MemoryRecord | undefined;
		const now = Date.now();
		if (existing) {
			this.db.prepare("UPDATE memories SET updated_at = ?, source = ?, kind = ?, confidence = MAX(confidence, ?) WHERE id = ?").run(now, input.source ?? "manual", input.kind, input.confidence ?? 1, existing.id);
			return this.getMemoryById(existing.id)!;
		}
		const id = randomUUID();
		this.db
			.prepare(
				`INSERT INTO memories (id, scope, project_id, task_id, kind, text, confidence, status, source, created_at, updated_at, last_used_at)
				 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
			)
			.run(id, input.scope, input.projectId ?? null, input.taskId ?? null, input.kind, normalized, input.confidence ?? 1, input.status ?? "active", input.source ?? "manual", now, now);
		return this.getMemoryById(id)!;
	}

	getMemoryById(id: string): MemoryRecord | undefined {
		return this.db.prepare("SELECT id, scope, project_id as projectId, task_id as taskId, kind, text, confidence, status, source, created_at as createdAt, updated_at as updatedAt, last_used_at as lastUsedAt FROM memories WHERE id = ?").get(id) as MemoryRecord | undefined;
	}

	archiveMemory(id: string): void {
		this.db.prepare("UPDATE memories SET status = 'archived', updated_at = ? WHERE id = ?").run(Date.now(), id);
	}

	getRelevantMemories(projectId?: string | null, taskId?: string | null): MemoryRecord[] {
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
				 ORDER BY
				   CASE scope WHEN 'task' THEN 0 WHEN 'project' THEN 1 WHEN 'domain' THEN 2 ELSE 3 END,
				   confidence DESC,
				   updated_at DESC
				 LIMIT 20`,
			)
			.all(projectId ?? null, taskId ?? null) as MemoryRecord[];
		return rows;
	}

	markMemoriesUsed(ids: string[]) {
		if (ids.length === 0) return;
		const placeholders = ids.map(() => "?").join(", ");
		this.db.prepare(`UPDATE memories SET last_used_at = ? WHERE id IN (${placeholders})`).run(Date.now(), ...ids);
	}

	listPrsForTask(taskId: string): PrRecord[] {
		return this.db
			.prepare(
				`SELECT p.id, p.project_id as projectId, p.pr_number as prNumber, p.pr_url as prUrl, p.title, p.created_at as createdAt, p.updated_at as updatedAt
				 FROM prs p
				 JOIN edges e ON e.from_type = 'pr' AND e.from_id = p.id AND e.edge_type = 'relates_to' AND e.to_type = 'task' AND e.to_id = ?
				 ORDER BY p.updated_at DESC`,
			)
			.all(taskId) as PrRecord[];
	}
}
