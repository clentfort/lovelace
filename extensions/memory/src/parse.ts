const TASK_REF_REGEX = /\b[A-Z][A-Z0-9]+-\d+\b/g;
const PR_URL_REGEX = /https?:\/\/github\.com\/[^\s/]+\/[^\s/]+\/pull\/(\d+)/g;

export interface ParsedTaskContext {
  ref?: string;
  title?: string;
}

export interface ParsedPrContext {
  prNumber?: number;
  prUrl?: string;
  title?: string;
  taskRef?: string;
}

function compactLine(text: string | null | undefined): string | undefined {
  if (!text) return undefined;
  const single = text.replace(/\s+/g, " ").trim();
  return single || undefined;
}

export function extractTaskRef(text: string): string | undefined {
  return text.match(TASK_REF_REGEX)?.[0];
}

export function parseJiraTaskContext(text: string): ParsedTaskContext | undefined {
  const ref = extractTaskRef(text);
  if (!ref) return undefined;
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const summaryLine = lines.find((line) => /^summary\s*:/i.test(line) || /^title\s*:/i.test(line));
  if (summaryLine) {
    return {
      ref,
      title: compactLine(summaryLine.replace(/^[^:]+:\s*/, "")),
    };
  }
  const refLine = lines.find((line) => line.includes(ref) && line !== ref);
  if (refLine) {
    const title = compactLine(refLine.replace(ref, ""));
    return { ref, title };
  }
  return { ref };
}

export function parsePrContext(text: string): ParsedPrContext | undefined {
  const urlMatch = [...text.matchAll(PR_URL_REGEX)][0];
  const prUrl = urlMatch?.[0];
  const prNumber = urlMatch
    ? Number(urlMatch[1])
    : Number(text.match(/\b(?:PR\s*#?|#)(\d+)\b/i)?.[1] ?? NaN);
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const titleLine = lines.find((line) => /^title\s*:/i.test(line));
  let title = titleLine ? compactLine(titleLine.replace(/^title\s*:\s*/i, "")) : undefined;
  if (!title) {
    const naturalTitle = lines.find(
      (line) => /pull request/i.test(line) && !line.includes("http") && line.length < 180,
    );
    if (naturalTitle) title = compactLine(naturalTitle.replace(/^.*pull request\s*/i, ""));
  }
  if (!title && prUrl) {
    const urlIndex = lines.findIndex((line) => line.includes(prUrl));
    if (urlIndex > 0) title = compactLine(lines[urlIndex - 1]);
  }
  const taskRef = extractTaskRef(`${title ?? ""}\n${text}`);
  if (!prUrl && Number.isNaN(prNumber) && !taskRef) return undefined;
  return {
    prNumber: Number.isNaN(prNumber) ? undefined : prNumber,
    prUrl,
    title,
    taskRef,
  };
}
