import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join } from "node:path";
import lovelaceMemoryExtension from "../extensions/memory/src/index.js";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";

// Mock homedir at top level
vi.mock("node:os", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:os")>();
  return {
    ...original,
    homedir: vi.fn(),
  };
});

describe("lovelaceMemoryExtension", () => {
  let dbDir: string;
  let pi: any;
  let ctx: any;
  let eventHandlers: Record<string, any> = {};
  let commands: Record<string, any> = {};

  beforeEach(() => {
    dbDir = mkdtempSync(join(tmpdir(), "lovelace-index-test-"));
    (homedir as any).mockReturnValue(dbDir);

    eventHandlers = {};
    commands = {};

    pi = {
      on: vi.fn().mockImplementation((event, handler) => {
        eventHandlers[event] = handler;
      }),
      registerCommand: vi.fn().mockImplementation((name, config) => {
        commands[name] = config;
      }),
      exec: vi.fn().mockImplementation(async (command, args) => {
        if (command === "git" && args[0] === "rev-parse") return { stdout: dbDir, code: 0 };
        return { stdout: "", code: 0 };
      }),
      appendEntry: vi.fn(),
    };

    ctx = {
      cwd: dbDir,
      sessionManager: {
        getSessionId: () => "session-1",
        getSessionFile: () => "file-1",
        getBranch: () => [],
      },
      ui: {
        setStatus: vi.fn(),
        notify: vi.fn(),
        custom: vi.fn(),
      },
    };
  });

  afterEach(() => {
    rmSync(dbDir, { recursive: true, force: true });
  });

  it("registers events and commands", () => {
    lovelaceMemoryExtension(pi as unknown as ExtensionAPI, join(dbDir, "test.db"));
    expect(pi.on).toHaveBeenCalledWith("session_start", expect.any(Function));
    expect(pi.registerCommand).toHaveBeenCalledWith("task", expect.any(Object));
    expect(pi.registerCommand).toHaveBeenCalledWith("pr", expect.any(Object));
    expect(pi.registerCommand).toHaveBeenCalledWith("remember", expect.any(Object));
  });

  it("handles session_start and refreshContext", async () => {
    lovelaceMemoryExtension(pi as unknown as ExtensionAPI, join(dbDir, "test.db"));
    await eventHandlers["session_start"]({}, ctx);

    expect(ctx.ui.setStatus).toHaveBeenCalled();
  });

  it("handles tool_result for bash commands", async () => {
    lovelaceMemoryExtension(pi as unknown as ExtensionAPI, join(dbDir, "test.db"));
    await eventHandlers["session_start"]({}, ctx);

    const event = {
      toolName: "bash",
      isError: false,
      input: { command: "pnpm test" },
      content: [{ type: "text", text: "Tests passed" }],
    };

    await eventHandlers["tool_result"](event, ctx);
    // Should have noted the command
  });

  it("handles jira tasks in tool_result", async () => {
    lovelaceMemoryExtension(pi as unknown as ExtensionAPI, join(dbDir, "test.db"));
    await eventHandlers["session_start"]({}, ctx);

    const event = {
      toolName: "bash",
      isError: false,
      input: { command: "jira issue view PROJ-123" },
      content: [{ type: "text", text: "Summary: Fix the thing" }],
    };

    await eventHandlers["tool_result"](event, ctx);
    expect(ctx.ui.setStatus).toHaveBeenCalledWith("lovelace-task", expect.stringContaining("PROJ-123"));
  });

  it("handles PRs in tool_result", async () => {
    lovelaceMemoryExtension(pi as unknown as ExtensionAPI, join(dbDir, "test.db"));
    await eventHandlers["session_start"]({}, ctx);

    const event = {
      toolName: "bash",
      isError: false,
      input: { command: "gh pr view 42" },
      content: [{ type: "text", text: "Title: PROJ-123 Fix it\nhttps://github.com/org/repo/pull/42" }],
    };

    await eventHandlers["tool_result"](event, ctx);
    expect(ctx.ui.setStatus).toHaveBeenCalledWith("lovelace-task", expect.stringContaining("#42"));
  });

  it("handles before_agent_start and injects system prompt", async () => {
    lovelaceMemoryExtension(pi as unknown as ExtensionAPI, join(dbDir, "test.db"));
    await eventHandlers["session_start"]({}, ctx);

    const event = {
      systemPrompt: "Base prompt",
      prompt: "PROJ-123 is the task",
    };

    const result = await eventHandlers["before_agent_start"](event, ctx);
    expect(result.systemPrompt).toContain("Base prompt");
    expect(result.systemPrompt).toContain("PROJ-123");
  });

  it("handles /task command", async () => {
    lovelaceMemoryExtension(pi as unknown as ExtensionAPI, join(dbDir, "test.db"));
    await eventHandlers["session_start"]({}, ctx);

    await commands["task"].handler("PROJ-999 My Task", ctx);
    expect(ctx.ui.notify).toHaveBeenCalledWith(expect.stringContaining("PROJ-999"), "info");
    expect(ctx.ui.setStatus).toHaveBeenCalledWith("lovelace-task", expect.stringContaining("PROJ-999"));
  });

  it("handles /remember command", async () => {
    lovelaceMemoryExtension(pi as unknown as ExtensionAPI, join(dbDir, "test.db"));
    await eventHandlers["session_start"]({}, ctx);

    await commands["remember"].handler("user likes tests", ctx);
    expect(ctx.ui.notify).toHaveBeenCalledWith(expect.stringContaining("Saved memory"), "info");
  });
});
