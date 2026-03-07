import type { BacklinkStatus, PrRecord, TaskRecord } from "./types.js";

interface MessageLike {
  role?: string;
  content?: unknown;
}

function toText(content: unknown): string {
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";
  return content
    .map((block) => {
      if (!block || typeof block !== "object" || !("type" in block)) return "";
      const typed = block as { type: string; text?: string; thinking?: string };
      if (typed.type === "text") return typed.text ?? "";
      if (typed.type === "thinking") return typed.thinking ?? "";
      return "";
    })
    .join("\n")
    .trim();
}

function compactLine(text: string | undefined, maxLength = 180): string | undefined {
  if (!text) return undefined;
  const single = text.replace(/\s+/g, " ").trim();
  if (!single) return undefined;
  return single.length <= maxLength ? single : `${single.slice(0, maxLength - 1)}…`;
}

function findLatest(messages: MessageLike[], role: string): string | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.role !== role) continue;
    const text = compactLine(toText(messages[i]?.content));
    if (text) return text;
  }
  return undefined;
}

function backlinkLabel(status?: BacklinkStatus): string {
  switch (status) {
    case "task-linked-to-pr":
      return "task links to PR";
    case "pr-linked-to-task":
      return "PR links to task";
    case "both":
      return "bidirectional links done";
    default:
      return "backlinks unknown";
  }
}

export function buildTaskContinuationSummary(options: {
  task: TaskRecord;
  pr?: PrRecord;
  backlinkStatus?: BacklinkStatus;
  branch?: string | null;
  messages: MessageLike[];
}): string | undefined {
  const recentUser = findLatest(options.messages, "user");
  const recentAssistant = findLatest(options.messages, "assistant");
  const lines: string[] = [];

  lines.push(
    `Continuation summary for ${options.task.ref}${options.task.title ? ` — ${options.task.title}` : ""}`,
  );
  if (options.branch) lines.push(`- Branch: ${options.branch}`);
  if (options.pr?.prNumber != null) lines.push(`- Linked PR: #${options.pr.prNumber}`);
  else if (options.pr?.prUrl) lines.push(`- Linked PR: ${options.pr.prUrl}`);
  if (options.pr) lines.push(`- Backlink state: ${backlinkLabel(options.backlinkStatus)}`);
  if (recentUser) lines.push(`- Latest user intent: ${recentUser}`);
  if (recentAssistant) lines.push(`- Latest assistant context: ${recentAssistant}`);

  return lines.length > 1 ? lines.join("\n") : undefined;
}
