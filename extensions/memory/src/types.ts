export type MemoryScope = "user" | "project" | "domain" | "task";
export type MemoryKind =
  | "preference"
  | "structure"
  | "workflow"
  | "constraint"
  | "command"
  | "gotcha"
  | "note";
export type MemoryStatus = "candidate" | "active" | "archived";
export type MemorySource = "manual" | "heuristic" | "scan" | "llm";
export type TaskSourceType = "jira" | "slack" | "mail" | "manual";
export type BacklinkStatus = "unknown" | "task-linked-to-pr" | "pr-linked-to-task" | "both";

export interface ProjectRecord {
  id: string;
  name: string;
  rootPath: string;
  gitRemote: string | null;
  firstSeenAt: number;
  lastSeenAt: number;
}

export interface MemoryRecord {
  id: string;
  scope: MemoryScope;
  projectId: string | null;
  taskId: string | null;
  kind: MemoryKind;
  text: string;
  confidence: number;
  status: MemoryStatus;
  source: MemorySource;
  createdAt: number;
  updatedAt: number;
  lastUsedAt: number | null;
}

export interface TaskRecord {
  id: string;
  ref: string;
  sourceType: TaskSourceType;
  title: string | null;
  summary: string | null;
  status: "active" | "paused" | "done" | "unknown";
  createdAt: number;
  updatedAt: number;
  lastSeenAt: number;
}

export interface PiSessionRecord {
  id: string;
  piSessionId: string | null;
  sessionFile: string | null;
  projectId: string;
  taskId: string | null;
  startedAt: number;
  updatedAt: number;
}

export interface PrRecord {
  id: string;
  projectId: string;
  prNumber: number | null;
  prUrl: string | null;
  title: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface EdgeRecord {
  id: string;
  fromType: string;
  fromId: string;
  edgeType: string;
  toType: string;
  toId: string;
  metadataJson: string | null;
  createdAt: number;
}

export interface TaskPrLinkRecord {
  pr: PrRecord;
  backlinkStatus: BacklinkStatus;
}
