import type { MemoryKind, MemoryScope } from "./types.js";

export interface ExtractedMemory {
  scope: MemoryScope;
  kind: MemoryKind;
  text: string;
  confidence: number;
}

const MEMORY_SCOPE_VALUES: MemoryScope[] = ["user", "project", "domain", "task"];
const MEMORY_KIND_VALUES: MemoryKind[] = [
  "preference",
  "structure",
  "workflow",
  "constraint",
  "command",
  "gotcha",
  "note",
];

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function extractJsonPayload(raw: string): unknown {
  const fencedMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = (fencedMatch?.[1] ?? raw).trim();
  if (!candidate) return undefined;

  const firstBrace = candidate.indexOf("{");
  const lastBrace = candidate.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    const sliced = candidate.slice(firstBrace, lastBrace + 1);
    try {
      return JSON.parse(sliced) as unknown;
    } catch {
      // Fall through.
    }
  }

  try {
    return JSON.parse(candidate) as unknown;
  } catch {
    return undefined;
  }
}

export function parseExtractedMemories(raw: string): ExtractedMemory[] {
  const payload = extractJsonPayload(raw) as
    | { memories?: Array<{ scope?: string; kind?: string; text?: string; confidence?: number }> }
    | undefined;
  if (!payload || !Array.isArray(payload.memories)) return [];

  const parsed: ExtractedMemory[] = [];
  const seen = new Set<string>();
  for (const item of payload.memories) {
    if (!item || typeof item !== "object") continue;
    const scope = MEMORY_SCOPE_VALUES.includes(item.scope as MemoryScope)
      ? (item.scope as MemoryScope)
      : undefined;
    const kind = MEMORY_KIND_VALUES.includes(item.kind as MemoryKind)
      ? (item.kind as MemoryKind)
      : undefined;
    const text = item.text?.trim();
    if (!scope || !kind || !text) continue;

    const confidence = Number.isFinite(item.confidence)
      ? clamp(Number(item.confidence), 0.4, 1)
      : 0.75;
    const key = `${scope}:${text.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    parsed.push({ scope, kind, text, confidence });
  }

  return parsed.slice(0, 10);
}

export function buildMemoryExtractionPrompt(options: {
  projectName?: string;
  repoRoot?: string;
  currentTaskRef?: string;
  conversationText: string;
}): string {
  const lines = [
    "Extract stable, reusable memories from the conversation.",
    "Only include facts that are likely useful in future sessions.",
    "Skip ephemeral progress updates, one-off errors, and raw command output.",
    "Prefer concise canonical text.",
    "",
    "Return ONLY valid JSON with this exact shape:",
    '{"memories":[{"scope":"user|project|domain|task","kind":"preference|structure|workflow|constraint|command|gotcha|note","text":"...","confidence":0.0}]}',
    "",
    "Scoping rules:",
    "- user: user preferences (tone, workflow preferences)",
    "- project: repo-specific facts/tools/layout for this project",
    "- domain: cross-project/tooling facts (e.g. organization-wide conventions)",
    "- task: facts specific to the current task only",
    "",
    "Quality rules:",
    "- At most 10 memories",
    "- confidence in [0,1]",
    "- Do not include secrets, tokens, URLs with credentials, or private keys",
    '- Use direct statements like: "Use `spacectl` for Spacelift."',
    "",
    `Project: ${options.projectName ?? "unknown"}`,
    `Repo root: ${options.repoRoot ?? "unknown"}`,
    `Current task: ${options.currentTaskRef ?? "none"}`,
    "",
    "<conversation>",
    options.conversationText,
    "</conversation>",
  ];
  return lines.join("\n");
}
