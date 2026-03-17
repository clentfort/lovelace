import type { BacklinkStatus, MemoryRecord, PrRecord, TaskRecord } from "./types.js";

const DAY_MS = 24 * 60 * 60 * 1000;

export function backlinkLabel(status?: BacklinkStatus): string {
  switch (status) {
    case "task-linked-to-pr":
      return "task→pr";
    case "pr-linked-to-task":
      return "pr→task";
    case "both":
      return "both-links";
    default:
      return "link?";
  }
}

export function isMemoryStale(
  memory: Pick<MemoryRecord, "scope" | "source" | "updatedAt">,
  now = Date.now(),
): boolean {
  const age = now - memory.updatedAt;
  if (memory.scope === "user" && memory.source === "manual") return false;
  if (memory.scope === "task") return age > 14 * DAY_MS;
  if (memory.source === "scan") return age > 45 * DAY_MS;
  return age > 90 * DAY_MS;
}

function formatRecordedAt(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(0, 10);
}

function formatMemoryLine(memory: MemoryRecord, now = Date.now()): string {
  const stalePrefix = isMemoryStale(memory, now) ? "[stale] " : "";
  const meta = `[id:${memory.id.slice(0, 8)} recorded:${formatRecordedAt(memory.createdAt)}]`;
  return `- ${stalePrefix}${meta} ${memory.text}`;
}

export function taskStatusText(
  task?: TaskRecord,
  pr?: PrRecord,
  backlinkStatus?: BacklinkStatus,
): string | undefined {
  if (!task) return undefined;
  const prPart = pr?.prNumber != null ? ` · PR #${pr.prNumber}` : pr?.prUrl ? ` · ${pr.prUrl}` : "";
  const backlinkPart = pr ? ` · ${backlinkLabel(backlinkStatus)}` : "";
  return `task: ${task.ref}${prPart}${backlinkPart}`;
}

export function formatMemoryBlock(
  memories: MemoryRecord[],
  task?: TaskRecord,
  pr?: PrRecord,
  backlinkStatus?: BacklinkStatus,
  now = Date.now(),
): string | undefined {
  const user = memories.filter((m) => m.scope === "user").slice(0, 3);
  const project = memories.filter((m) => m.scope === "project").slice(0, 5);
  const domain = memories.filter((m) => m.scope === "domain").slice(0, 3);
  const taskNotes = memories.filter((m) => m.scope === "task").slice(0, 3);
  const sections: string[] = [];
  if (user.length)
    sections.push(`[User preferences]\n${user.map((m) => formatMemoryLine(m, now)).join("\n")}`);
  if (project.length)
    sections.push(`[Project memory]\n${project.map((m) => formatMemoryLine(m, now)).join("\n")}`);
  if (domain.length)
    sections.push(`[Domain memory]\n${domain.map((m) => formatMemoryLine(m, now)).join("\n")}`);
  if (task || taskNotes.length || pr) {
    const taskLines: string[] = [];
    if (task) taskLines.push(`- Current task: ${task.ref}${task.title ? ` — ${task.title}` : ""}`);
    if (pr?.prNumber != null) taskLines.push(`- Linked PR: #${pr.prNumber}`);
    else if (pr?.prUrl) taskLines.push(`- Linked PR: ${pr.prUrl}`);
    if (pr) taskLines.push(`- Backlink status: ${backlinkLabel(backlinkStatus)}`);
    for (const note of taskNotes) taskLines.push(formatMemoryLine(note, now));
    sections.push(`[Task/session context]\n${taskLines.join("\n")}`);
  }
  if (sections.length === 0) return undefined;
  return `Relevant Lovelace memory:\n\n${sections.join("\n\n")}\n\nTreat memory as helpful but potentially stale. Verify important facts with tools.`;
}
