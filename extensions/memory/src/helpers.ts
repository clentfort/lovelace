import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import type { MemoryKind, MemoryScope, PrRecord } from "./types.js";

export function toolContentToText(content: unknown): string {
  if (!Array.isArray(content)) return "";
  return content
    .filter((block): block is { type: string; text?: string } =>
      Boolean(block && typeof block === "object" && "type" in block),
    )
    .map((block) => (block.type === "text" ? (block.text ?? "") : ""))
    .join("\n")
    .trim();
}

export function parseRememberArgs(args: string): { scope: MemoryScope; text: string } | undefined {
  const trimmed = args.trim();
  const match = trimmed.match(/^(user|project|domain|task)\s+(.+)$/s);
  if (!match) return undefined;
  return { scope: match[1] as MemoryScope, text: match[2].trim() };
}

export function inferMemoryKind(text: string): MemoryKind {
  const lowered = text.toLowerCase();
  if (lowered.includes("prefer") || lowered.includes("ask before")) return "preference";
  if (lowered.includes("do not") || lowered.includes("don't") || lowered.includes("avoid"))
    return "constraint";
  if (
    lowered.includes("command") ||
    lowered.includes("pnpm") ||
    lowered.includes("npm") ||
    lowered.includes("make ")
  )
    return "command";
  if (lowered.includes("usually") || lowered.includes("workflow")) return "workflow";
  return "note";
}

export function isInterestingProjectCommand(command: string): boolean {
  return /^(pnpm|npm|yarn|make|cargo|pytest|go test|just)\b/.test(command.trim());
}

export function mentionsCurrentPr(pr: PrRecord | undefined, text: string): boolean {
  if (!pr) return false;
  if (pr.prUrl && text.includes(pr.prUrl)) return true;
  if (
    pr.prNumber != null &&
    (text.includes(`#${pr.prNumber}`) || text.includes(`/pull/${pr.prNumber}`))
  )
    return true;
  return false;
}

export function getSessionTaskId(
  ctx: ExtensionContext,
  entryType: string,
): string | null | undefined {
  for (const entry of ctx.sessionManager.getBranch()) {
    if (entry.type !== "custom" || entry.customType !== entryType) continue;
    const data = entry.data as { taskId?: string | null } | undefined;
    return data?.taskId ?? null;
  }
  return undefined;
}
