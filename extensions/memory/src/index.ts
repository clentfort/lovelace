import { homedir } from "node:os";
import { join } from "node:path";
import { Text, matchesKey } from "@mariozechner/pi-tui";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { LovelaceStore } from "./db.js";
import { detectRepo, type RepoInfo } from "./repo.js";
import { scanProject } from "./scan.js";
import type { MemoryKind, MemoryScope, PiSessionRecord, PrRecord, ProjectRecord, TaskRecord } from "./types.js";

const TASK_ENTRY_TYPE = "lovelace-task";
const DEFAULT_DB_PATH = join(homedir(), ".lovelace", "memory.db");
const TASK_REF_REGEX = /\b[A-Z][A-Z0-9]+-\d+\b/g;
const PR_URL_REGEX = /https?:\/\/github\.com\/[^\s/]+\/[^\s/]+\/pull\/(\d+)/g;

interface RuntimeState {
	project?: ProjectRecord;
	repo?: RepoInfo;
	piSession?: PiSessionRecord;
	currentTask?: TaskRecord;
	currentPr?: PrRecord;
}

function toText(content: unknown): string {
	if (!Array.isArray(content)) return "";
	return content
		.filter((block): block is { type: string; text?: string } => Boolean(block && typeof block === "object" && "type" in block))
		.map((block) => (block.type === "text" ? block.text ?? "" : ""))
		.join("\n")
		.trim();
}

function extractTaskRef(text: string): string | undefined {
	return text.match(TASK_REF_REGEX)?.[0];
}

function extractPrInfo(text: string): { prNumber?: number; prUrl?: string } | undefined {
	const urlMatch = [...text.matchAll(PR_URL_REGEX)][0];
	if (urlMatch) {
		return { prNumber: Number(urlMatch[1]), prUrl: urlMatch[0] };
	}
	const numberMatch = text.match(/\b(?:PR\s*#?|#)(\d+)\b/i);
	if (numberMatch) {
		return { prNumber: Number(numberMatch[1]) };
	}
	return undefined;
}

function taskStatusText(task?: TaskRecord, pr?: PrRecord): string | undefined {
	if (!task) return undefined;
	const prPart = pr?.prNumber != null ? ` · PR #${pr.prNumber}` : pr?.prUrl ? ` · ${pr.prUrl}` : "";
	return `task: ${task.ref}${prPart}`;
}

async function showModal(ctx: ExtensionContext, title: string, body: string): Promise<void> {
	if (!ctx.hasUI) return;
	await ctx.ui.custom<void>((_tui, theme, _kb, done) => {
		const lines = `${theme.fg("accent", theme.bold(title))}\n\n${body}\n\n${theme.fg("dim", "Press Enter or Escape to close")}`;
		const text = new Text(lines, 1, 1);
		text.onKey = (key) => {
			if (matchesKey(key, "escape") || matchesKey(key, "return") || matchesKey(key, "ctrl+c")) {
				done();
				return true;
			}
			return true;
		};
		return text;
	});
}

function formatMemoryBlock(memories: Array<{ scope: string; text: string }>, task?: TaskRecord, pr?: PrRecord): string | undefined {
	const user = memories.filter((m) => m.scope === "user").slice(0, 3);
	const project = memories.filter((m) => m.scope === "project").slice(0, 5);
	const domain = memories.filter((m) => m.scope === "domain").slice(0, 3);
	const taskNotes = memories.filter((m) => m.scope === "task").slice(0, 3);
	const sections: string[] = [];
	if (user.length) sections.push(`[User preferences]\n${user.map((m) => `- ${m.text}`).join("\n")}`);
	if (project.length) sections.push(`[Project memory]\n${project.map((m) => `- ${m.text}`).join("\n")}`);
	if (domain.length) sections.push(`[Domain memory]\n${domain.map((m) => `- ${m.text}`).join("\n")}`);
	if (task || taskNotes.length || pr) {
		const taskLines: string[] = [];
		if (task) taskLines.push(`- Current task: ${task.ref}${task.title ? ` — ${task.title}` : ""}`);
		if (pr?.prNumber != null) taskLines.push(`- Linked PR: #${pr.prNumber}`);
		else if (pr?.prUrl) taskLines.push(`- Linked PR: ${pr.prUrl}`);
		for (const note of taskNotes) taskLines.push(`- ${note.text}`);
		sections.push(`[Task/session context]\n${taskLines.join("\n")}`);
	}
	if (sections.length === 0) return undefined;
	return `Relevant Lovelace memory:\n\n${sections.join("\n\n")}\n\nTreat memory as helpful but potentially stale. Verify important facts with tools.`;
}

function parseRememberArgs(args: string): { scope: MemoryScope; text: string } | undefined {
	const trimmed = args.trim();
	const match = trimmed.match(/^(user|project|domain|task)\s+(.+)$/s);
	if (!match) return undefined;
	return { scope: match[1] as MemoryScope, text: match[2].trim() };
}

function inferKind(text: string): MemoryKind {
	const lowered = text.toLowerCase();
	if (lowered.includes("prefer") || lowered.includes("ask before")) return "preference";
	if (lowered.includes("do not") || lowered.includes("don't") || lowered.includes("avoid")) return "constraint";
	if (lowered.includes("command") || lowered.includes("pnpm") || lowered.includes("npm") || lowered.includes("make ")) return "command";
	if (lowered.includes("usually") || lowered.includes("workflow")) return "workflow";
	return "note";
}

export default function lovelaceMemoryExtension(pi: ExtensionAPI) {
	const store = new LovelaceStore(DEFAULT_DB_PATH);
	const state: RuntimeState = {};

	async function detectAndRegisterProject(ctx: ExtensionContext) {
		state.repo = await detectRepo((command, args, options) => pi.exec(command, args, options), ctx.cwd);
		state.project = store.upsertProject({
			name: state.repo.name,
			rootPath: state.repo.rootPath,
			gitRemote: state.repo.gitRemote,
		});
	}

	function restoreTaskFromBranch(ctx: ExtensionContext): TaskRecord | undefined {
		const branch = ctx.sessionManager.getBranch();
		let taskId: string | null | undefined;
		for (const entry of branch) {
			if (entry.type === "custom" && entry.customType === TASK_ENTRY_TYPE) {
				const data = entry.data as { taskId?: string | null } | undefined;
				taskId = data?.taskId ?? null;
			}
		}
		if (taskId === undefined) return undefined;
		return taskId ? store.getTaskById(taskId) : undefined;
	}

	function updateStatus(ctx: ExtensionContext) {
		ctx.ui.setStatus("lovelace-task", taskStatusText(state.currentTask, state.currentPr));
	}

	async function registerCurrentSession(ctx: ExtensionContext) {
		if (!state.project) return;
		const restoredTask = restoreTaskFromBranch(ctx) ?? store.findTaskForSession(ctx.sessionManager.getSessionId(), ctx.sessionManager.getSessionFile());
		state.currentTask = restoredTask;
		state.currentPr = restoredTask ? store.listPrsForTask(restoredTask.id)[0] : undefined;
		state.piSession = store.upsertPiSession({
			piSessionId: ctx.sessionManager.getSessionId(),
			sessionFile: ctx.sessionManager.getSessionFile(),
			projectId: state.project.id,
			taskId: restoredTask?.id,
		});
		store.createEdge("session", state.piSession.id, "in_project", "project", state.project.id);
		if (restoredTask) {
			store.createEdge("session", state.piSession.id, "for_task", "task", restoredTask.id);
		}
	}

	async function refreshContext(ctx: ExtensionContext) {
		await detectAndRegisterProject(ctx);
		await registerCurrentSession(ctx);
		updateStatus(ctx);
	}

	function setCurrentTask(ctx: ExtensionContext, task: TaskRecord | undefined) {
		state.currentTask = task;
		state.currentPr = task ? store.listPrsForTask(task.id)[0] : undefined;
		if (state.piSession) {
			store.setTaskForSession(state.piSession.id, task?.id ?? null);
			if (task) store.createEdge("session", state.piSession.id, "for_task", "task", task.id);
		}
		pi.appendEntry(TASK_ENTRY_TYPE, { taskId: task?.id ?? null, taskRef: task?.ref ?? null });
		updateStatus(ctx);
	}

	function linkPrToCurrentContext(pr: PrRecord) {
		state.currentPr = pr;
		if (state.currentTask) store.createEdge("pr", pr.id, "relates_to", "task", state.currentTask.id);
		if (state.piSession) store.createEdge("pr", pr.id, "created_from", "session", state.piSession.id);
	}

	async function detectTaskFromText(ctx: ExtensionContext, text: string, sourceType: TaskRecord["sourceType"] = "manual") {
		if (state.currentTask) return;
		const ref = extractTaskRef(text);
		if (!ref) return;
		const task = store.upsertTask({ ref, sourceType, status: "active" });
		setCurrentTask(ctx, task);
	}

	function rememberCommand(command: string) {
		if (!state.project) return;
		const normalized = command.trim();
		if (!normalized) return;
		const interesting = /^(pnpm|npm|yarn|make|cargo|pytest|go test|just)\b/.test(normalized);
		if (!interesting) return;
		store.createMemory({
			scope: "project",
			projectId: state.project.id,
			kind: "command",
			text: `A useful working command in this repo is: \`${normalized}\``,
			source: "heuristic",
			confidence: 0.55,
			status: "candidate",
		});
	}

	pi.on("session_start", async (_event, ctx) => {
		await refreshContext(ctx);
	});
	pi.on("session_switch", async (_event, ctx) => {
		await refreshContext(ctx);
	});
	pi.on("session_fork", async (_event, ctx) => {
		await refreshContext(ctx);
	});
	pi.on("session_tree", async (_event, ctx) => {
		await refreshContext(ctx);
	});
	pi.on("session_shutdown", async () => {
		store.close();
	});

	pi.on("before_agent_start", async (event, ctx) => {
		await detectTaskFromText(ctx, event.prompt, "manual");
		const memories = store.getRelevantMemories(state.project?.id, state.currentTask?.id);
		if (memories.length === 0 && !state.currentTask && !state.currentPr) return;
		store.markMemoriesUsed(memories.map((memory) => memory.id));
		const memoryBlock = formatMemoryBlock(memories, state.currentTask, state.currentPr);
		if (!memoryBlock) return;
		return {
			systemPrompt: `${event.systemPrompt}\n\n${memoryBlock}`,
		};
	});

	pi.on("tool_result", async (event, ctx) => {
		if (event.toolName !== "bash" || event.isError) return;
		const command = String((event.input as { command?: string }).command ?? "").trim();
		const output = toText(event.content);
		if (!command) return;

		rememberCommand(command);

		if (/\bjira\b/.test(command)) {
			const taskRef = extractTaskRef(`${command}\n${output}`);
			if (taskRef) {
				const title = output.split("\n").map((line) => line.trim()).find(Boolean) ?? null;
				const task = store.upsertTask({ ref: taskRef, sourceType: "jira", title, status: "active" });
				if (!state.currentTask || state.currentTask.ref === taskRef) setCurrentTask(ctx, task);
			}
		}

		if (/\bgh\s+pr\b/.test(command) || output.includes("/pull/")) {
			const prInfo = extractPrInfo(`${command}\n${output}`);
			if (prInfo && state.project) {
				const pr = store.upsertPr({ projectId: state.project.id, prNumber: prInfo.prNumber, prUrl: prInfo.prUrl });
				linkPrToCurrentContext(pr);
				updateStatus(ctx);
			}
		}
	});

	pi.registerCommand("task", {
		description: "Set, clear, or show the current task",
		handler: async (args, ctx) => {
			const trimmed = (args ?? "").trim();
			if (!trimmed || trimmed === "show") {
				const prs = state.currentTask ? store.listPrsForTask(state.currentTask.id) : [];
				const lines = [
					`Project: ${state.project?.name ?? "unknown"}`,
					`Task: ${state.currentTask ? state.currentTask.ref : "none"}`,
				];
				if (state.currentTask?.title) lines.push(`Title: ${state.currentTask.title}`);
				if (prs[0]) lines.push(`Linked PR: ${prs[0].prNumber != null ? `#${prs[0].prNumber}` : prs[0].prUrl}`);
				await showModal(ctx, "Lovelace task", lines.join("\n"));
				return;
			}
			if (trimmed === "clear") {
				setCurrentTask(ctx, undefined);
				ctx.ui.notify("Cleared current task", "info");
				return;
			}
			const [ref, ...rest] = trimmed.split(/\s+/);
			const summary = rest.join(" ").trim() || null;
			const task = store.upsertTask({ ref, sourceType: "manual", title: summary, summary, status: "active" });
			setCurrentTask(ctx, task);
			ctx.ui.notify(`Current task set to ${ref}`, "info");
		},
	});

	pi.registerCommand("pr", {
		description: "Link a PR to the current task/session",
		handler: async (args, ctx) => {
			if (!state.project) {
				ctx.ui.notify("No active project detected", "error");
				return;
			}
			const input = (args ?? "").trim();
			if (!input) {
				ctx.ui.notify("Usage: /pr <number|url>", "warning");
				return;
			}
			const parsed = extractPrInfo(input);
			if (!parsed) {
				ctx.ui.notify("Could not parse PR number or URL", "error");
				return;
			}
			const pr = store.upsertPr({ projectId: state.project.id, prNumber: parsed.prNumber, prUrl: parsed.prUrl });
			linkPrToCurrentContext(pr);
			updateStatus(ctx);
			ctx.ui.notify(`Linked PR ${pr.prNumber != null ? `#${pr.prNumber}` : pr.prUrl}`, "info");
		},
	});

	pi.registerCommand("remember", {
		description: "Store a Lovelace memory: /remember <scope> <text>",
		handler: async (args, ctx) => {
			const parsed = parseRememberArgs(args ?? "");
			if (!parsed) {
				ctx.ui.notify("Usage: /remember <user|project|domain|task> <text>", "warning");
				return;
			}
			if (parsed.scope === "project" && !state.project) {
				ctx.ui.notify("No current project detected", "error");
				return;
			}
			if (parsed.scope === "task" && !state.currentTask) {
				ctx.ui.notify("No current task set", "error");
				return;
			}
			const memory = store.createMemory({
				scope: parsed.scope,
				projectId: parsed.scope === "project" ? state.project?.id : null,
				taskId: parsed.scope === "task" ? state.currentTask?.id : null,
				kind: inferKind(parsed.text),
				text: parsed.text,
				source: "manual",
				confidence: 1,
				status: "active",
			});
			ctx.ui.notify(`Saved memory ${memory.id.slice(0, 8)}`, "info");
		},
	});

	pi.registerCommand("forget", {
		description: "Archive a memory by id",
		handler: async (args, ctx) => {
			const id = (args ?? "").trim();
			if (!id) {
				ctx.ui.notify("Usage: /forget <memory-id>", "warning");
				return;
			}
			store.archiveMemory(id);
			ctx.ui.notify(`Archived memory ${id}`, "info");
		},
	});

	pi.registerCommand("memory", {
		description: "Show relevant Lovelace memory or run /memory scan",
		handler: async (args, ctx) => {
			if ((args ?? "").trim() === "scan") {
				if (!state.project || !state.repo) {
					ctx.ui.notify("No active project detected", "error");
					return;
				}
				const created = scanProject(store, state.project.id, state.repo.rootPath);
				ctx.ui.notify(created.length ? `Scan saved ${created.length} memories` : "Scan found nothing new", "info");
				return;
			}
			const memories = store.getRelevantMemories(state.project?.id, state.currentTask?.id);
			const body = formatMemoryBlock(memories, state.currentTask, state.currentPr) ?? "No relevant memory yet.";
			await showModal(ctx, "Lovelace memory", body);
		},
	});
}
