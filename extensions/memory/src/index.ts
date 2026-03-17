import { homedir } from "node:os";
import { join } from "node:path";
import { complete } from "@mariozechner/pi-ai";
import {
  convertToLlm,
  serializeConversation,
  type ExtensionAPI,
  type ExtensionContext,
} from "@mariozechner/pi-coding-agent";
import { LovelaceStore } from "./db.js";
import { buildTaskContinuationSummary } from "./continuation.js";
import { createMemoryBackend } from "./memory-backend.js";
import {
  getSessionTaskId,
  mentionsCurrentPr,
  parseRememberArgs,
  toolContentToText,
} from "./helpers.js";
import { extractTaskRef, parseJiraTaskContext, parsePrContext } from "./parse.js";
import { buildMemoryExtractionPrompt, parseExtractedMemories } from "./extract.js";
import { detectRepo, type RepoInfo } from "./repo.js";
import { scanProject } from "./scan.js";
import type {
  BacklinkStatus,
  MemoryKind,
  MemoryRecord,
  PiSessionRecord,
  PrRecord,
  ProjectRecord,
  TaskRecord,
} from "./types.js";
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
  recentExtractionFingerprints: string[];
}

export default function lovelaceMemoryExtension(pi: ExtensionAPI) {
  const store = new LovelaceStore(DEFAULT_DB_PATH);
  const memoryBackend = createMemoryBackend(store);
  const state: RuntimeState = { recentExtractionFingerprints: [] };

  function updateStatus(ctx: ExtensionContext) {
    ctx.ui.setStatus(
      "lovelace-task",
      taskStatusText(state.currentTask, state.currentPr, state.currentBacklinkStatus),
    );
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
    state.repo = await detectRepo(
      (command, args, options) => pi.exec(command, args, options),
      ctx.cwd,
    );
    state.project = store.upsertProject({
      name: state.repo.name,
      rootPath: state.repo.rootPath,
      gitRemote: state.repo.gitRemote,
    });
  }

  async function registerCurrentSession(ctx: ExtensionContext) {
    if (!state.project) return;
    const restoredTask =
      restoreTaskFromBranch(ctx) ??
      store.findTaskForSession(
        ctx.sessionManager.getSessionId(),
        ctx.sessionManager.getSessionFile(),
      );
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
    if (restoredTask)
      store.createEdge("session", state.piSession.id, "for_task", "task", restoredTask.id);
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
    if (state.piSession)
      store.createEdge("pr", pr.id, "created_from", "session", state.piSession.id);
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
    state.currentBacklinkStatus = store.upsertTaskPrLink(
      state.currentPr.id,
      state.currentTask.id,
      status,
    );
  }

  async function chooseMemoryExtractionModel(ctx: ExtensionContext) {
    const preferred: Array<[string, string]> = [
      ["google", "gemini-2.5-flash"],
      ["anthropic", "claude-3-5-haiku-latest"],
      ["openai", "gpt-5-mini"],
    ];
    for (const [provider, id] of preferred) {
      const model = ctx.modelRegistry.find(provider, id);
      if (!model) continue;
      const apiKey = await ctx.modelRegistry.getApiKey(model);
      if (!apiKey) continue;
      return { model, apiKey };
    }
    return undefined;
  }

  async function classifyMemoryKind(text: string, ctx: ExtensionContext): Promise<MemoryKind> {
    const selected = await chooseMemoryExtractionModel(ctx);
    if (!selected) return "note";

    const prompt = [
      "Classify this memory into exactly one kind.",
      "Allowed kinds: preference, structure, workflow, constraint, command, gotcha, note",
      "Return only the kind token with no extra text.",
      `Memory: ${text}`,
    ].join("\n");

    try {
      const response = await complete(
        selected.model,
        {
          messages: [
            {
              role: "user",
              content: [{ type: "text", text: prompt }],
              timestamp: Date.now(),
            },
          ],
        },
        { apiKey: selected.apiKey, maxTokens: 12, reasoningEffort: "low" },
      );

      const raw = response.content
        .filter((block): block is { type: "text"; text: string } => block.type === "text")
        .map((block) => block.text)
        .join("\n")
        .trim()
        .toLowerCase();

      const token = raw.match(
        /\b(preference|structure|workflow|constraint|command|gotcha|note)\b/,
      )?.[1];
      if (!token) return "note";
      return token as MemoryKind;
    } catch {
      return "note";
    }
  }

  function fingerprint(text: string): string {
    let hash = 2166136261;
    for (let i = 0; i < text.length; i++) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
  }

  function rememberExtractionFingerprint(value: string) {
    if (state.recentExtractionFingerprints.includes(value)) return;
    state.recentExtractionFingerprints.push(value);
    if (state.recentExtractionFingerprints.length > 80) state.recentExtractionFingerprints.shift();
  }

  async function learnFromConversationText(
    conversationText: string,
    ctx: ExtensionContext,
    options?: { signal?: AbortSignal; maxChars?: number },
  ) {
    const normalized = conversationText.trim();
    if (!normalized) return;

    const maxChars = options?.maxChars ?? 28_000;
    const trimmedText =
      normalized.length > maxChars ? `...[truncated]\n${normalized.slice(-maxChars)}` : normalized;
    const fp = fingerprint(trimmedText);
    if (state.recentExtractionFingerprints.includes(fp)) return;

    const selected = await chooseMemoryExtractionModel(ctx);
    if (!selected) return;

    rememberExtractionFingerprint(fp);

    const prompt = buildMemoryExtractionPrompt({
      projectName: state.project?.name,
      repoRoot: state.repo?.rootPath,
      currentTaskRef: state.currentTask?.ref,
      conversationText: trimmedText,
    });

    try {
      const response = await complete(
        selected.model,
        {
          messages: [
            {
              role: "user",
              content: [{ type: "text", text: prompt }],
              timestamp: Date.now(),
            },
          ],
        },
        {
          apiKey: selected.apiKey,
          maxTokens: 1100,
          reasoningEffort: "low",
          signal: options?.signal,
        },
      );

      const raw = response.content
        .filter((block): block is { type: "text"; text: string } => block.type === "text")
        .map((block) => block.text)
        .join("\n")
        .trim();
      if (!raw) return;

      const extracted = parseExtractedMemories(raw);
      let promotedCount = 0;
      for (const memory of extracted) {
        if (memory.scope === "project" && !state.project) continue;
        if (memory.scope === "task" && !state.currentTask) continue;
        const outcome = await memoryBackend.proposeMemory({
          scope: memory.scope,
          projectId: memory.scope === "project" ? state.project?.id : null,
          taskId: memory.scope === "task" ? state.currentTask?.id : null,
          kind: memory.kind,
          text: memory.text,
          source: "llm",
          confidence: memory.confidence,
          sessionId: state.piSession?.id,
          evidenceFingerprint: `${fp}:${fingerprint(`${memory.scope}:${memory.text}`)}`,
        });
        if (outcome.promotedMemory) promotedCount += 1;
      }
      if (promotedCount > 0) {
        ctx.ui.notify(
          `Promoted ${promotedCount} memory proposal${promotedCount > 1 ? "s" : ""}`,
          "info",
        );
      }
    } catch {
      // Best effort.
    }
  }

  async function learnFromCompaction(
    messages: Parameters<typeof convertToLlm>[0],
    signal: AbortSignal,
    ctx: ExtensionContext,
  ) {
    if (messages.length === 0) return;
    const conversationText = serializeConversation(convertToLlm(messages)).trim();
    await learnFromConversationText(conversationText, ctx, { signal, maxChars: 30_000 });
  }

  function getBranchMessages(ctx: ExtensionContext): Parameters<typeof convertToLlm>[0] {
    const branch = ctx.sessionManager.getBranch() as Array<{
      type?: string;
      message?: { role?: string; content?: unknown; timestamp?: number };
    }>;
    const messages = branch
      .filter((entry) => entry.type === "message" && entry.message?.role && entry.message.content)
      .map((entry) => ({
        role: entry.message!.role as "user" | "assistant",
        content: entry.message!.content,
        timestamp: entry.message!.timestamp ?? Date.now(),
      }));
    return messages.slice(-220);
  }

  async function learnFromCurrentBranch(ctx: ExtensionContext, options?: { maxChars?: number }) {
    const messages = getBranchMessages(ctx);
    if (messages.length === 0) return;
    const conversationText = serializeConversation(convertToLlm(messages)).trim();
    await learnFromConversationText(conversationText, ctx, options);
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
    const lines = [
      `Project: ${state.project?.name ?? "unknown"}`,
      `Task: ${state.currentTask ? state.currentTask.ref : "none"}`,
    ];
    if (state.currentTask?.title) lines.push(`Title: ${state.currentTask.title}`);
    if (prLink)
      lines.push(
        `Linked PR: ${prLink.pr.prNumber != null ? `#${prLink.pr.prNumber}` : prLink.pr.prUrl}`,
      );
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
    setCurrentTask(
      ctx,
      store.upsertTask({ ref, sourceType: "manual", title: summary, summary, status: "active" }),
    );
    ctx.ui.notify(`Current task set to ${ref}`, "info");
  }

  async function handlePrCommand(args: string | undefined, ctx: ExtensionContext) {
    const input = (args ?? "").trim();
    if (input === "show") {
      const text = state.currentPr
        ? [
            `PR: ${state.currentPr.prNumber != null ? `#${state.currentPr.prNumber}` : (state.currentPr.prUrl ?? "unknown")}`,
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
      ctx.ui.notify(
        "Usage: /ll:pr <number|url> | /ll:pr show | /ll:pr backlink <task|pr|both|unknown>",
        "warning",
      );
      return;
    }
    const parsed = parsePrContext(input);
    if (!parsed) {
      ctx.ui.notify("Could not parse PR number or URL", "error");
      return;
    }
    const pr = store.upsertPr({
      projectId: state.project.id,
      prNumber: parsed.prNumber,
      prUrl: parsed.prUrl,
      title: parsed.title,
    });
    linkPrToCurrentContext(pr);
    updateStatus(ctx);
    ctx.ui.notify(`Linked PR ${pr.prNumber != null ? `#${pr.prNumber}` : pr.prUrl}`, "info");
  }

  pi.on("session_start", async (_event, ctx) => refreshContext(ctx));
  pi.on("session_before_switch", async (_event, ctx) => {
    await learnFromCurrentBranch(ctx, { maxChars: 30_000 });
  });
  pi.on("session_switch", async (_event, ctx) => refreshContext(ctx));
  pi.on("session_fork", async (_event, ctx) => refreshContext(ctx));
  pi.on("session_tree", async (_event, ctx) => refreshContext(ctx));
  pi.on("agent_end", async (event, ctx) => {
    const conversationText = serializeConversation(convertToLlm(event.messages)).trim();
    await learnFromConversationText(conversationText, ctx, { maxChars: 20_000 });
  });
  pi.on("session_shutdown", async (_event, ctx) => {
    await learnFromCurrentBranch(ctx, { maxChars: 30_000 });
    await memoryBackend.close();
    store.close();
  });

  pi.on("session_before_compact", async (event, ctx) => {
    const messages = [
      ...event.preparation.messagesToSummarize,
      ...event.preparation.turnPrefixMessages,
    ];
    await learnFromCompaction(messages, event.signal, ctx);

    if (!state.currentTask) return;
    const summary = buildTaskContinuationSummary({
      task: state.currentTask,
      pr: state.currentPr,
      backlinkStatus: state.currentBacklinkStatus,
      branch: state.repo?.branch,
      messages,
    });
    if (!summary) return;
    store.upsertTaskContinuationSummary(state.currentTask.id, summary);
    ctx.ui.notify(`Saved continuation summary for ${state.currentTask.ref}`, "info");
  });

  pi.on("before_agent_start", async (event, ctx) => {
    await detectTaskFromText(ctx, event.prompt, "manual");
    const memories = (await memoryBackend.getRelevantMemories(
      state.project?.id,
      state.currentTask?.id,
      {
        queryText: event.prompt,
        limit: 14,
      },
    )) as MemoryRecord[];
    if (memories.length === 0 && !state.currentTask && !state.currentPr) return;
    await memoryBackend.markMemoriesUsed(memories.map((memory) => memory.id));
    const memoryBlock = formatMemoryBlock(
      memories,
      state.currentTask,
      state.currentPr,
      state.currentBacklinkStatus,
    );
    if (!memoryBlock) return;
    return { systemPrompt: `${event.systemPrompt}\n\n${memoryBlock}` };
  });

  pi.on("tool_result", async (event, ctx) => {
    if (event.toolName !== "bash" || event.isError) return;
    const command = String((event.input as { command?: string }).command ?? "").trim();
    const output = toolContentToText(event.content);
    if (!command) return;

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
        if (
          /\bgh\s+pr\s+comment\b/.test(command) &&
          state.currentTask &&
          `${command}\n${output}`.includes(state.currentTask.ref)
        ) {
          updateBacklinkStatus("pr-linked-to-task");
        }
        updateStatus(ctx);
      }
    }

    if (
      /\bjira\b.*\bcomment\b/.test(command) &&
      mentionsCurrentPr(state.currentPr, `${command}\n${output}`)
    ) {
      updateBacklinkStatus("task-linked-to-pr");
      updateStatus(ctx);
    }
  });

  pi.registerCommand("ll:task", {
    description: "Set, clear, show, or list recent tasks (/ll:task ...)",
    handler: async (args, ctx) => handleTaskCommand(args, ctx),
  });

  pi.registerCommand("ll:pr", {
    description: "Link a PR, show it, or update backlink status (/ll:pr ...)",
    handler: async (args, ctx) => handlePrCommand(args, ctx),
  });

  pi.registerCommand("ll:remember", {
    description: "Store a Lovelace memory: /ll:remember <scope> <text>",
    handler: async (args, ctx) => {
      const parsed = parseRememberArgs(args ?? "");
      if (!parsed) {
        ctx.ui.notify("Usage: /ll:remember <user|project|domain|task> <text>", "warning");
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
      const memory = await memoryBackend.createMemory({
        scope: parsed.scope,
        projectId: parsed.scope === "project" ? state.project?.id : null,
        taskId: parsed.scope === "task" ? state.currentTask?.id : null,
        kind: await classifyMemoryKind(parsed.text, ctx),
        text: parsed.text,
        source: "manual",
        confidence: 1,
        status: "active",
      });
      ctx.ui.notify(`Saved memory ${memory.id.slice(0, 8)}`, "info");
    },
  });

  pi.registerCommand("ll:forget", {
    description: "Archive a memory by id prefix or full id (/ll:forget ...)",
    handler: async (args, ctx) => {
      const id = (args ?? "").trim();
      if (!id) {
        ctx.ui.notify("Usage: /ll:forget <memory-id>", "warning");
        return;
      }
      const result = await memoryBackend.archiveMemory(id);
      if (!result.ok) {
        if (result.reason === "ambiguous") {
          const options = (result.matches ?? []).slice(0, 5).map((value) => value.slice(0, 8));
          ctx.ui.notify(
            `Ambiguous id prefix '${id}'. Matches: ${options.join(", ")}${(result.matches?.length ?? 0) > 5 ? ", ..." : ""}`,
            "warning",
          );
          return;
        }
        ctx.ui.notify(`No memory found for '${id}'`, "warning");
        return;
      }
      ctx.ui.notify(`Archived memory ${result.id?.slice(0, 8) ?? id}`, "info");
    },
  });

  pi.registerCommand("ll:memory", {
    description:
      "Show memory, proposals, /ll:memory scan|maintain, /ll:memory stats [global], or /ll:memory promote|reject <id>",
    handler: async (args, ctx) => {
      const trimmed = (args ?? "").trim();
      if (/^proposals(?:\s+|$)/i.test(trimmed)) {
        const query = trimmed.replace(/^proposals\s*/i, "").trim();
        const proposals = await memoryBackend.listMemoryProposals(
          state.project?.id,
          state.currentTask?.id,
          {
            queryText: query || undefined,
            limit: 24,
            contextOnly: true,
            statuses: ["proposed", "promoted"],
          },
        );
        const body = proposals.length
          ? proposals
              .map(
                (proposal) =>
                  `- [id:${proposal.id.slice(0, 8)} status:${proposal.status} support:${proposal.supportCount} sessions:${proposal.distinctSessionCount}] (${proposal.scope}/${proposal.kind}) ${proposal.text}`,
              )
              .join("\n")
          : "No memory proposals yet.";
        await showModal(ctx, "Lovelace memory proposals", body);
        return;
      }
      if (/^promote\s+/i.test(trimmed)) {
        const id = trimmed.replace(/^promote\s+/i, "").trim();
        if (!id) {
          ctx.ui.notify("Usage: /ll:memory promote <proposal-id>", "warning");
          return;
        }
        const result = await memoryBackend.promoteMemoryProposal(id);
        if (!result.ok) {
          if (result.reason === "ambiguous") {
            const options = (result.matches ?? []).slice(0, 5).map((value) => value.slice(0, 8));
            ctx.ui.notify(
              `Ambiguous proposal id prefix '${id}'. Matches: ${options.join(", ")}${(result.matches?.length ?? 0) > 5 ? ", ..." : ""}`,
              "warning",
            );
            return;
          }
          ctx.ui.notify(`No proposal found for '${id}'`, "warning");
          return;
        }
        ctx.ui.notify(
          `Promoted proposal ${result.proposal.id.slice(0, 8)}${result.memory ? ` -> memory ${result.memory.id.slice(0, 8)}` : ""}`,
          "info",
        );
        return;
      }
      if (/^reject\s+/i.test(trimmed)) {
        const id = trimmed.replace(/^reject\s+/i, "").trim();
        if (!id) {
          ctx.ui.notify("Usage: /ll:memory reject <proposal-id>", "warning");
          return;
        }
        const result = await memoryBackend.rejectMemoryProposal(id);
        if (!result.ok) {
          if (result.reason === "ambiguous") {
            const options = (result.matches ?? []).slice(0, 5).map((value) => value.slice(0, 8));
            ctx.ui.notify(
              `Ambiguous proposal id prefix '${id}'. Matches: ${options.join(", ")}${(result.matches?.length ?? 0) > 5 ? ", ..." : ""}`,
              "warning",
            );
            return;
          }
          ctx.ui.notify(`No proposal found for '${id}'`, "warning");
          return;
        }
        ctx.ui.notify(`Rejected proposal ${result.proposal.id.slice(0, 8)}`, "info");
        return;
      }
      if (trimmed === "maintain") {
        const result = await memoryBackend.runMaintenance();
        ctx.ui.notify(
          `Maintenance archived ${result.archivedCandidates} candidate and ${result.archivedInactive} inactive memories`,
          "info",
        );
        return;
      }
      if (trimmed === "scan") {
        if (!state.project || !state.repo) {
          ctx.ui.notify("No active project detected", "error");
          return;
        }
        const created = await scanProject(memoryBackend, state.project.id, state.repo.rootPath);
        ctx.ui.notify(
          created.length ? `Scan saved ${created.length} memories` : "Scan found nothing new",
          "info",
        );
        return;
      }
      if (trimmed === "stats" || /^stats\s+/i.test(trimmed)) {
        const global = /\bglobal\b/i.test(trimmed);
        const stats = await memoryBackend.getMemoryStats(state.project?.id, state.currentTask?.id, {
          contextOnly: !global,
        });
        const lines = [
          `Scope: ${global ? "global DB" : "current context"}`,
          state.project ? `Project: ${state.project.name}` : "Project: unknown",
          `Total memories: ${stats.total}`,
          `Status: active ${stats.byStatus.active}, candidate ${stats.byStatus.candidate}, archived ${stats.byStatus.archived}`,
          `Scope mix: user ${stats.byScope.user}, project ${stats.byScope.project}, domain ${stats.byScope.domain}, task ${stats.byScope.task}`,
          `Source mix: manual ${stats.bySource.manual}, llm ${stats.bySource.llm}, scan ${stats.bySource.scan}, heuristic ${stats.bySource.heuristic}`,
          `Created: last24h ${stats.createdLast24h}, last7d ${stats.createdLast7d}, last30d ${stats.createdLast30d}`,
          "",
          "Tips: /ll:memory proposals · /ll:memory stats global",
        ];
        await showModal(ctx, "Lovelace memory stats", lines.join("\n"));
        return;
      }
      const memories = (await memoryBackend.getRelevantMemories(
        state.project?.id,
        state.currentTask?.id,
        {
          queryText: trimmed || undefined,
          limit: 20,
        },
      )) as MemoryRecord[];
      const body =
        formatMemoryBlock(
          memories,
          state.currentTask,
          state.currentPr,
          state.currentBacklinkStatus,
        ) ?? "No relevant memory yet.";
      await showModal(ctx, "Lovelace memory", body);
    },
  });
}
