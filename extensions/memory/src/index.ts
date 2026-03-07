import { homedir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { LovelaceStore } from "./db.js";
import { buildTaskContinuationSummary } from "./continuation.js";
import {
	getSessionTaskId,
	inferMemoryKind,
	isInterestingProjectCommand,
	mentionsCurrentPr,
	parseRememberArgs,
	toolContentToText,
} from "./helpers.js";
import { extractTaskRef, parseJiraTaskContext, parsePrContext } from "./parse.js";
import { detectRepo, type RepoInfo } from "./repo.js";
import { scanProject } from "./scan.js";
import type { BacklinkStatus, MemoryRecord, PiSessionRecord, PrRecord, ProjectRecord, TaskRecord } from "./types.js";
import { showModal } from "./ui.js";
import { backlinkLabel, formatMemoryBlock, taskStatusText } from "./view.js";

const TASK_ENTRY_TYPE = "lovelace-task";
const DEFAULT_DB_PATH = join(homedir(), ".lovelace", "memory.db");

interface RuntimeState {
	project?: ProjectRecord;
	repo?: RepoInfo;
	piSession?: PiSessionRecord;
	currentTask?: TaskRecord;
	currentPr?: PrRecord;
	currentBacklinkStatus?: BacklinkStatus;
}

export default function lovelaceMemoryExtension(pi: ExtensionAPI) {
	const store = new LovelaceStore(DEFAULT_DB_PATH);
	const state: RuntimeState = {};

	function updateStatus(ctx: ExtensionContext) {
		ctx.ui.setStatus("lovelace-task", taskStatusText(state.currentTask, state.currentPr, state.currentBacklinkStatus));
	}

	function getCurrentTaskLink(task: TaskRecord | undefined) {
		return task ? store.listPrsForTask(task.id)[0] : undefined;
	}

	function restoreTaskFromBranch(ctx: ExtensionContext): TaskRecord | undefined {
		const taskId = getSessionTaskId(ctx, TASK_ENTRY_TYPE);
		if (taskId === undefined) return undefined;
		return taskId ? store.getTaskById(taskId) : undefined;
	}

	async function detectAndRegisterProject(ctx: ExtensionContext) {
		state.repo = await detectRepo((command, args, options) => pi.exec(command, args, options), ctx.cwd);
		state.project = store.upsertProject({
			name: state.repo.name,
			rootPath: state.repo.rootPath,
			gitRemote: state.repo.gitRemote,
		});
	}

	async function registerCurrentSession(ctx: ExtensionContext) {
		if (!state.project) return;
		const restoredTask =
			restoreTaskFromBranch(ctx) ?? store.findTaskForSession(ctx.sessionManager.getSessionId(), ctx.sessionManager.getSessionFile());
		state.currentTask = restoredTask;
		const currentLink = getCurrentTaskLink(restoredTask);
		state.currentPr = currentLink?.pr;
		state.currentBacklinkStatus = currentLink?.backlinkStatus;
		state.piSession = store.upsertPiSession({
			piSessionId: ctx.sessionManager.getSessionId(),
			sessionFile: ctx.sessionManager.getSessionFile(),
			projectId: state.project.id,
			taskId: restoredTask?.id,
		});
		store.createEdge("session", state.piSession.id, "in_project", "project", state.project.id);
		if (restoredTask) store.createEdge("session", state.piSession.id, "for_task", "task", restoredTask.id);
	}

	function syncTaskToSession(ctx: ExtensionContext, task: TaskRecord | undefined) {
		if (state.piSession) {
			store.setTaskForSession(state.piSession.id, task?.id ?? null);
			if (task) store.createEdge("session", state.piSession.id, "for_task", "task", task.id);
		}
		pi.appendEntry(TASK_ENTRY_TYPE, { taskId: task?.id ?? null, taskRef: task?.ref ?? null });
	}

	function setCurrentTask(ctx: ExtensionContext, task: TaskRecord | undefined) {
		state.currentTask = task;
		const currentLink = getCurrentTaskLink(task);
		state.currentPr = currentLink?.pr ?? state.currentPr;
		state.currentBacklinkStatus = currentLink?.backlinkStatus;
		if (state.currentPr && task) {
			state.currentBacklinkStatus = store.upsertTaskPrLink(state.currentPr.id, task.id, "unknown");
		}
		syncTaskToSession(ctx, task);
		updateStatus(ctx);
	}

	function linkPrToCurrentContext(pr: PrRecord) {
		state.currentPr = pr;
		if (state.currentTask) {
			state.currentBacklinkStatus = store.upsertTaskPrLink(pr.id, state.currentTask.id, "unknown");
		}
		if (state.piSession) store.createEdge("pr", pr.id, "created_from", "session", state.piSession.id);
	}

	async function detectTaskFromText(
		ctx: ExtensionContext,
		text: string,
		sourceType: TaskRecord["sourceType"] = "manual",
	) {
		if (state.currentTask) return;
		const ref = extractTaskRef(text);
		if (!ref) return;
		setCurrentTask(ctx, store.upsertTask({ ref, sourceType, status: "active" }));
	}

	function updateBacklinkStatus(status: BacklinkStatus) {
		if (!state.currentTask || !state.currentPr) return;
		state.currentBacklinkStatus = store.upsertTaskPrLink(state.currentPr.id, state.currentTask.id, status);
	}

	function rememberCommand(command: string) {
		if (!state.project) return;
		const normalized = command.trim();
		if (!normalized || !isInterestingProjectCommand(normalized)) return;
		store.noteProjectCommandSuccess(state.project.id, normalized);
	}

	async function refreshContext(ctx: ExtensionContext) {
		await detectAndRegisterProject(ctx);
		await registerCurrentSession(ctx);
		if (!state.currentTask && state.repo?.branch) {
			await detectTaskFromText(ctx, state.repo.branch, "manual");
		}
		updateStatus(ctx);
	}

	async function handleTaskShow(ctx: ExtensionContext) {
		const prLink = getCurrentTaskLink(state.currentTask);
		const lines = [`Project: ${state.project?.name ?? "unknown"}`, `Task: ${state.currentTask ? state.currentTask.ref : "none"}`];
		if (state.currentTask?.title) lines.push(`Title: ${state.currentTask.title}`);
		if (prLink) lines.push(`Linked PR: ${prLink.pr.prNumber != null ? `#${prLink.pr.prNumber}` : prLink.pr.prUrl}`);
		if (prLink) lines.push(`Backlink: ${backlinkLabel(prLink.backlinkStatus)}`);
		await showModal(ctx, "Lovelace task", lines.join("\n"));
	}

	async function handleTaskCommand(args: string | undefined, ctx: ExtensionContext) {
		const trimmed = (args ?? "").trim();
		if (trimmed === "recent") {
			if (!state.project) {
				ctx.ui.notify("No current project detected", "error");
				return;
			}
			const tasks = store.listRecentTasksForProject(state.project.id, 8);
			const body = tasks.length
				? tasks.map((task, index) => `${index + 1}. ${task.ref}${task.title ? ` — ${task.title}` : ""}`).join("\n")
				: "No recent tasks for this project.";
			await showModal(ctx, "Recent tasks", body);
			return;
		}
		if (!trimmed || trimmed === "show") {
			await handleTaskShow(ctx);
			return;
		}
		if (trimmed === "clear") {
			setCurrentTask(ctx, undefined);
			ctx.ui.notify("Cleared current task", "info");
			return;
		}
		const [ref, ...rest] = trimmed.split(/\s+/);
		const summary = rest.join(" ").trim() || null;
		setCurrentTask(ctx, store.upsertTask({ ref, sourceType: "manual", title: summary, summary, status: "active" }));
		ctx.ui.notify(`Current task set to ${ref}`, "info");
	}

	async function handlePrCommand(args: string | undefined, ctx: ExtensionContext) {
		const input = (args ?? "").trim();
		if (input === "show") {
			const text = state.currentPr
				? [
						`PR: ${state.currentPr.prNumber != null ? `#${state.currentPr.prNumber}` : state.currentPr.prUrl ?? "unknown"}`,
						`Backlink: ${backlinkLabel(state.currentBacklinkStatus)}`,
					].join("\n")
				: "No linked PR";
			await showModal(ctx, "Lovelace PR", text);
			return;
		}
		const backlinkMatch = input.match(/^backlink\s+(task|pr|both|unknown)$/);
		if (backlinkMatch) {
			if (!state.currentTask || !state.currentPr) {
				ctx.ui.notify("Need a current task and PR first", "warning");
				return;
			}
			const statusMap: Record<string, BacklinkStatus> = {
				task: "task-linked-to-pr",
				pr: "pr-linked-to-task",
				both: "both",
				unknown: "unknown",
			};
			updateBacklinkStatus(statusMap[backlinkMatch[1]]);
			updateStatus(ctx);
			ctx.ui.notify(`Backlink status set to ${backlinkLabel(state.currentBacklinkStatus)}`, "info");
			return;
		}
		if (!state.project) {
			ctx.ui.notify("No active project detected", "error");
			return;
		}
		if (!input) {
			ctx.ui.notify("Usage: /pr <number|url> | /pr show | /pr backlink <task|pr|both|unknown>", "warning");
			return;
		}
		const parsed = parsePrContext(input);
		if (!parsed) {
			ctx.ui.notify("Could not parse PR number or URL", "error");
			return;
		}
		const pr = store.upsertPr({ projectId: state.project.id, prNumber: parsed.prNumber, prUrl: parsed.prUrl, title: parsed.title });
		linkPrToCurrentContext(pr);
		updateStatus(ctx);
		ctx.ui.notify(`Linked PR ${pr.prNumber != null ? `#${pr.prNumber}` : pr.prUrl}`, "info");
	}

	pi.on("session_start", async (_event, ctx) => refreshContext(ctx));
	pi.on("session_switch", async (_event, ctx) => refreshContext(ctx));
	pi.on("session_fork", async (_event, ctx) => refreshContext(ctx));
	pi.on("session_tree", async (_event, ctx) => refreshContext(ctx));
	pi.on("session_shutdown", async () => store.close());

	pi.on("session_before_compact", async (event, ctx) => {
		if (!state.currentTask) return;
		const summary = buildTaskContinuationSummary({
			task: state.currentTask,
			pr: state.currentPr,
			backlinkStatus: state.currentBacklinkStatus,
			branch: state.repo?.branch,
			messages: [...event.preparation.messagesToSummarize, ...event.preparation.turnPrefixMessages],
		});
		if (!summary) return;
		store.upsertTaskContinuationSummary(state.currentTask.id, summary);
		ctx.ui.notify(`Saved continuation summary for ${state.currentTask.ref}`, "info");
	});

	pi.on("before_agent_start", async (event, ctx) => {
		await detectTaskFromText(ctx, event.prompt, "manual");
		const memories = store.getRelevantMemories(state.project?.id, state.currentTask?.id) as MemoryRecord[];
		if (memories.length === 0 && !state.currentTask && !state.currentPr) return;
		store.markMemoriesUsed(memories.map((memory) => memory.id));
		const memoryBlock = formatMemoryBlock(memories, state.currentTask, state.currentPr, state.currentBacklinkStatus);
		if (!memoryBlock) return;
		return { systemPrompt: `${event.systemPrompt}\n\n${memoryBlock}` };
	});

	pi.on("tool_result", async (event, ctx) => {
		if (event.toolName !== "bash" || event.isError) return;
		const command = String((event.input as { command?: string }).command ?? "").trim();
		const output = toolContentToText(event.content);
		if (!command) return;

		rememberCommand(command);

		if (/\bjira\b/.test(command)) {
			const taskInfo = parseJiraTaskContext(`${command}\n${output}`);
			if (taskInfo?.ref) {
				const task = store.upsertTask({
					ref: taskInfo.ref,
					sourceType: "jira",
					title: taskInfo.title,
					summary: taskInfo.title,
					status: "active",
				});
				if (!state.currentTask || state.currentTask.ref === taskInfo.ref) setCurrentTask(ctx, task);
			}
		}

		if (/\bgh\s+pr\b/.test(command) || output.includes("/pull/")) {
			const prInfo = parsePrContext(`${command}\n${output}`);
			if (prInfo && state.project) {
				if (!state.currentTask && prInfo.taskRef) {
					const inferredTask = store.upsertTask({
						ref: prInfo.taskRef,
						sourceType: "manual",
						title: prInfo.title,
						summary: prInfo.title,
						status: "active",
					});
					setCurrentTask(ctx, inferredTask);
				}
				const pr = store.upsertPr({
					projectId: state.project.id,
					prNumber: prInfo.prNumber,
					prUrl: prInfo.prUrl,
					title: prInfo.title,
				});
				linkPrToCurrentContext(pr);
				if (/\bgh\s+pr\s+comment\b/.test(command) && state.currentTask && `${command}\n${output}`.includes(state.currentTask.ref)) {
					updateBacklinkStatus("pr-linked-to-task");
				}
				updateStatus(ctx);
			}
		}

		if (/\bjira\b.*\bcomment\b/.test(command) && mentionsCurrentPr(state.currentPr, `${command}\n${output}`)) {
			updateBacklinkStatus("task-linked-to-pr");
			updateStatus(ctx);
		}
	});

	pi.registerCommand("task", {
		description: "Set, clear, show, or list recent tasks",
		handler: async (args, ctx) => handleTaskCommand(args, ctx),
	});

	pi.registerCommand("pr", {
		description: "Link a PR, show it, or update backlink status",
		handler: async (args, ctx) => handlePrCommand(args, ctx),
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
				kind: inferMemoryKind(parsed.text),
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
			const memories = store.getRelevantMemories(state.project?.id, state.currentTask?.id) as MemoryRecord[];
			const body =
				formatMemoryBlock(memories, state.currentTask, state.currentPr, state.currentBacklinkStatus) ??
				"No relevant memory yet.";
			await showModal(ctx, "Lovelace memory", body);
		},
	});
}
