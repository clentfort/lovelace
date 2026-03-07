import type {
  ExtensionAPI,
  ExtensionContext,
  AgentStartEvent,
  ToolResultEvent,
  SessionCompactEvent,
} from "@mariozechner/pi-coding-agent";
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
import type {
  BacklinkStatus,
  MemoryRecord,
  PiSessionRecord,
  PrRecord,
  ProjectRecord,
  TaskRecord,
} from "./types.js";
import { showModal } from "./ui.js";
import { backlinkLabel, formatMemoryBlock, taskStatusText } from "./view.js";

const TASK_ENTRY_TYPE = "lovelace-task";

interface RuntimeState {
  project?: ProjectRecord;
  repo?: RepoInfo;
  piSession?: PiSessionRecord;
  currentTask?: TaskRecord;
  currentPr?: PrRecord;
  currentBacklinkStatus?: BacklinkStatus;
}

export class LovelaceManager {
  private state: RuntimeState = {};

  constructor(
    private pi: ExtensionAPI,
    private store: LovelaceStore,
  ) {}

  public updateStatus(ctx: ExtensionContext) {
    ctx.ui.setStatus(
      "lovelace-task",
      taskStatusText(this.state.currentTask, this.state.currentPr, this.state.currentBacklinkStatus),
    );
  }

  private getCurrentTaskLink(task: TaskRecord | undefined) {
    return task ? this.store.listPrsForTask(task.id)[0] : undefined;
  }

  private restoreTaskFromBranch(ctx: ExtensionContext): TaskRecord | undefined {
    const taskId = getSessionTaskId(ctx, TASK_ENTRY_TYPE);
    if (taskId === undefined) return undefined;
    return taskId ? this.store.getTaskById(taskId) : undefined;
  }

  public async detectAndRegisterProject(ctx: ExtensionContext) {
    this.state.repo = await detectRepo(
      (command, args, options) => this.pi.exec(command, args, options),
      ctx.cwd,
    );
    this.state.project = this.store.upsertProject({
      name: this.state.repo.name,
      rootPath: this.state.repo.rootPath,
      gitRemote: this.state.repo.gitRemote,
    });
  }

  public async registerCurrentSession(ctx: ExtensionContext) {
    if (!this.state.project) return;
    const restoredTask =
      this.restoreTaskFromBranch(ctx) ??
      this.store.findTaskForSession(
        ctx.sessionManager.getSessionId(),
        ctx.sessionManager.getSessionFile(),
      );
    this.state.currentTask = restoredTask;
    const currentLink = this.getCurrentTaskLink(restoredTask);
    this.state.currentPr = currentLink?.pr;
    this.state.currentBacklinkStatus = currentLink?.backlinkStatus;
    this.state.piSession = this.store.upsertPiSession({
      piSessionId: ctx.sessionManager.getSessionId(),
      sessionFile: ctx.sessionManager.getSessionFile(),
      projectId: this.state.project.id,
      taskId: restoredTask?.id,
    });
    this.store.createEdge("session", this.state.piSession.id, "in_project", "project", this.state.project.id);
    if (restoredTask)
      this.store.createEdge("session", this.state.piSession.id, "for_task", "task", restoredTask.id);
  }

  private syncTaskToSession(ctx: ExtensionContext, task: TaskRecord | undefined) {
    if (this.state.piSession) {
      this.store.setTaskForSession(this.state.piSession.id, task?.id ?? null);
      if (task) this.store.createEdge("session", this.state.piSession.id, "for_task", "task", task.id);
    }
    this.pi.appendEntry(TASK_ENTRY_TYPE, { taskId: task?.id ?? null, taskRef: task?.ref ?? null });
  }

  private setCurrentTask(ctx: ExtensionContext, task: TaskRecord | undefined) {
    this.state.currentTask = task;
    const currentLink = this.getCurrentTaskLink(task);
    this.state.currentPr = currentLink?.pr ?? this.state.currentPr;
    this.state.currentBacklinkStatus = currentLink?.backlinkStatus;
    if (this.state.currentPr && task) {
      this.state.currentBacklinkStatus = this.store.upsertTaskPrLink(this.state.currentPr.id, task.id, "unknown");
    }
    this.syncTaskToSession(ctx, task);
    this.updateStatus(ctx);
  }

  private linkPrToCurrentContext(pr: PrRecord) {
    this.state.currentPr = pr;
    if (this.state.currentTask) {
      this.state.currentBacklinkStatus = this.store.upsertTaskPrLink(pr.id, this.state.currentTask.id, "unknown");
    }
    if (this.state.piSession)
      this.store.createEdge("pr", pr.id, "created_from", "session", this.state.piSession.id);
  }

  private async detectTaskFromText(
    ctx: ExtensionContext,
    text: string,
    sourceType: TaskRecord["sourceType"] = "manual",
  ) {
    if (this.state.currentTask) return;
    const ref = extractTaskRef(text);
    if (!ref) return;
    this.setCurrentTask(ctx, this.store.upsertTask({ ref, sourceType, status: "active" }));
  }

  private updateBacklinkStatus(status: BacklinkStatus) {
    if (!this.state.currentTask || !this.state.currentPr) return;
    this.state.currentBacklinkStatus = this.store.upsertTaskPrLink(
      this.state.currentPr.id,
      this.state.currentTask.id,
      status,
    );
  }

  private rememberCommand(command: string) {
    if (!this.state.project) return;
    const normalized = command.trim();
    if (!normalized || !isInterestingProjectCommand(normalized)) return;
    this.store.noteProjectCommandSuccess(this.state.project.id, normalized);
  }

  public async refreshContext(ctx: ExtensionContext) {
    await this.detectAndRegisterProject(ctx);
    await this.registerCurrentSession(ctx);
    if (!this.state.currentTask && this.state.repo?.branch) {
      await this.detectTaskFromText(ctx, this.state.repo.branch, "manual");
    }
    this.updateStatus(ctx);
  }

  private async handleTaskShow(ctx: ExtensionContext) {
    const prLink = this.getCurrentTaskLink(this.state.currentTask);
    const lines = [
      `Project: ${this.state.project?.name ?? "unknown"}`,
      `Task: ${this.state.currentTask ? this.state.currentTask.ref : "none"}`,
    ];
    if (this.state.currentTask?.title) lines.push(`Title: ${this.state.currentTask.title}`);
    if (prLink)
      lines.push(
        `Linked PR: ${prLink.pr.prNumber != null ? `#${prLink.pr.prNumber}` : prLink.pr.prUrl}`,
      );
    if (prLink) lines.push(`Backlink: ${backlinkLabel(prLink.backlinkStatus)}`);
    await showModal(ctx, "Lovelace task", lines.join("\n"));
  }

  public async handleTaskCommand(args: string | undefined, ctx: ExtensionContext) {
    const trimmed = (args ?? "").trim();
    if (trimmed === "recent") {
      if (!this.state.project) {
        ctx.ui.notify("No current project detected", "error");
        return;
      }
      const tasks = this.store.listRecentTasksForProject(this.state.project.id, 8);
      const body = tasks.length
        ? tasks
            .map(
              (task, index) => `${index + 1}. ${task.ref}${task.title ? ` — ${task.title}` : ""}`,
            )
            .join("\n")
        : "No recent tasks for this project.";
      await showModal(ctx, "Recent tasks", body);
      return;
    }
    if (!trimmed || trimmed === "show") {
      await this.handleTaskShow(ctx);
      return;
    }
    if (trimmed === "clear") {
      this.setCurrentTask(ctx, undefined);
      ctx.ui.notify("Cleared current task", "info");
      return;
    }
    const [ref, ...rest] = trimmed.split(/\s+/);
    const summary = rest.join(" ").trim() || null;
    this.setCurrentTask(
      ctx,
      this.store.upsertTask({ ref, sourceType: "manual", title: summary, summary, status: "active" }),
    );
    ctx.ui.notify(`Current task set to ${ref}`, "info");
  }

  public async handlePrCommand(args: string | undefined, ctx: ExtensionContext) {
    const input = (args ?? "").trim();
    if (input === "show") {
      const text = this.state.currentPr
        ? [
            `PR: ${this.state.currentPr.prNumber != null ? `#${this.state.currentPr.prNumber}` : (this.state.currentPr.prUrl ?? "unknown")}`,
            `Backlink: ${backlinkLabel(this.state.currentBacklinkStatus)}`,
          ].join("\n")
        : "No linked PR";
      await showModal(ctx, "Lovelace PR", text);
      return;
    }
    const backlinkMatch = input.match(/^backlink\s+(task|pr|both|unknown)$/);
    if (backlinkMatch) {
      if (!this.state.currentTask || !this.state.currentPr) {
        ctx.ui.notify("Need a current task and PR first", "warning");
        return;
      }
      const statusMap: Record<string, BacklinkStatus> = {
        task: "task-linked-to-pr",
        pr: "pr-linked-to-task",
        both: "both",
        unknown: "unknown",
      };
      this.updateBacklinkStatus(statusMap[backlinkMatch[1]]);
      this.updateStatus(ctx);
      ctx.ui.notify(`Backlink status set to ${backlinkLabel(this.state.currentBacklinkStatus)}`, "info");
      return;
    }
    if (!this.state.project) {
      ctx.ui.notify("No active project detected", "error");
      return;
    }
    if (!input) {
      ctx.ui.notify(
        "Usage: /pr <number|url> | /pr show | /pr backlink <task|pr|both|unknown>",
        "warning",
      );
      return;
    }
    const parsed = parsePrContext(input);
    if (!parsed) {
      ctx.ui.notify("Could not parse PR number or URL", "error");
      return;
    }
    const pr = this.store.upsertPr({
      projectId: this.state.project.id,
      prNumber: parsed.prNumber,
      prUrl: parsed.prUrl,
      title: parsed.title,
    });
    this.linkPrToCurrentContext(pr);
    this.updateStatus(ctx);
    ctx.ui.notify(`Linked PR ${pr.prNumber != null ? `#${pr.prNumber}` : pr.prUrl}`, "info");
  }

  public async handleRememberCommand(args: string | undefined, ctx: ExtensionContext) {
    const parsed = parseRememberArgs(args ?? "");
    if (!parsed) {
      ctx.ui.notify("Usage: /remember <user|project|domain|task> <text>", "warning");
      return;
    }
    if (parsed.scope === "project" && !this.state.project) {
      ctx.ui.notify("No current project detected", "error");
      return;
    }
    if (parsed.scope === "task" && !this.state.currentTask) {
      ctx.ui.notify("No current task set", "error");
      return;
    }
    const memory = this.store.createMemory({
      scope: parsed.scope,
      projectId: parsed.scope === "project" ? this.state.project?.id : null,
      taskId: parsed.scope === "task" ? this.state.currentTask?.id : null,
      kind: inferMemoryKind(parsed.text),
      text: parsed.text,
      source: "manual",
      confidence: 1,
      status: "active",
    });
    ctx.ui.notify(`Saved memory ${memory.id.slice(0, 8)}`, "info");
  }

  public async handleForgetCommand(args: string | undefined, ctx: ExtensionContext) {
    const id = (args ?? "").trim();
    if (!id) {
      ctx.ui.notify("Usage: /forget <memory-id>", "warning");
      return;
    }
    this.store.archiveMemory(id);
    ctx.ui.notify(`Archived memory ${id}`, "info");
  }

  public async handleMemoryCommand(args: string | undefined, ctx: ExtensionContext) {
    if ((args ?? "").trim() === "scan") {
      if (!this.state.project || !this.state.repo) {
        ctx.ui.notify("No active project detected", "error");
        return;
      }
      const created = scanProject(this.store, this.state.project.id, this.state.repo.rootPath);
      ctx.ui.notify(
        created.length ? `Scan saved ${created.length} memories` : "Scan found nothing new",
        "info",
      );
      return;
    }
    const memories = this.store.getRelevantMemories(
      this.state.project?.id,
      this.state.currentTask?.id,
    ) as MemoryRecord[];
    const body =
      formatMemoryBlock(
        memories,
        this.state.currentTask,
        this.state.currentPr,
        this.state.currentBacklinkStatus,
      ) ?? "No relevant memory yet.";
    await showModal(ctx, "Lovelace memory", body);
  }

  public async onBeforeAgentStart(event: AgentStartEvent, ctx: ExtensionContext) {
    await this.detectTaskFromText(ctx, event.prompt, "manual");
    const memories = this.store.getRelevantMemories(
      this.state.project?.id,
      this.state.currentTask?.id,
    ) as MemoryRecord[];
    if (memories.length === 0 && !this.state.currentTask && !this.state.currentPr) return;
    this.store.markMemoriesUsed(memories.map((memory) => memory.id));
    const memoryBlock = formatMemoryBlock(
      memories,
      this.state.currentTask,
      this.state.currentPr,
      this.state.currentBacklinkStatus,
    );
    if (!memoryBlock) return;
    return { systemPrompt: `${event.systemPrompt}\n\n${memoryBlock}` };
  }

  public async onSessionBeforeCompact(event: SessionCompactEvent, ctx: ExtensionContext) {
    if (!this.state.currentTask) return;
    const summary = buildTaskContinuationSummary({
      task: this.state.currentTask,
      pr: this.state.currentPr,
      backlinkStatus: this.state.currentBacklinkStatus,
      branch: this.state.repo?.branch,
      messages: [...event.preparation.messagesToSummarize, ...event.preparation.turnPrefixMessages],
    });
    if (!summary) return;
    this.store.upsertTaskContinuationSummary(this.state.currentTask.id, summary);
    ctx.ui.notify(`Saved continuation summary for ${this.state.currentTask.ref}`, "info");
  }

  public async onToolResult(event: ToolResultEvent, ctx: ExtensionContext) {
    if (event.toolName !== "bash" || event.isError) return;
    const command = String((event.input as { command?: string }).command ?? "").trim();
    const output = toolContentToText(event.content);
    if (!command) return;

    this.rememberCommand(command);

    if (/\bjira\b/.test(command)) {
      const taskInfo = parseJiraTaskContext(`${command}\n${output}`);
      if (taskInfo?.ref) {
        const task = this.store.upsertTask({
          ref: taskInfo.ref,
          sourceType: "jira",
          title: taskInfo.title,
          summary: taskInfo.title,
          status: "active",
        });
        if (!this.state.currentTask || this.state.currentTask.ref === taskInfo.ref) this.setCurrentTask(ctx, task);
      }
    }

    if (/\bgh\s+pr\b/.test(command) || output.includes("/pull/")) {
      const prInfo = parsePrContext(`${command}\n${output}`);
      if (prInfo && this.state.project) {
        if (!this.state.currentTask && prInfo.taskRef) {
          const inferredTask = this.store.upsertTask({
            ref: prInfo.taskRef,
            sourceType: "manual",
            title: prInfo.title,
            summary: prInfo.title,
            status: "active",
          });
          this.setCurrentTask(ctx, inferredTask);
        }
        const pr = this.store.upsertPr({
          projectId: this.state.project.id,
          prNumber: prInfo.prNumber,
          prUrl: prInfo.prUrl,
          title: prInfo.title,
        });
        this.linkPrToCurrentContext(pr);
        if (
          /\bgh\s+pr\s+comment\b/.test(command) &&
          this.state.currentTask &&
          `${command}\n${output}`.includes(this.state.currentTask.ref)
        ) {
          this.updateBacklinkStatus("pr-linked-to-task");
        }
        this.updateStatus(ctx);
      }
    }

    if (
      /\bjira\b.*\bcomment\b/.test(command) &&
      mentionsCurrentPr(this.state.currentPr, `${command}\n${output}`)
    ) {
      this.updateBacklinkStatus("task-linked-to-pr");
      this.updateStatus(ctx);
    }
  }
}
