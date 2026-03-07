import { homedir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { LovelaceStore } from "./db.js";
import { LovelaceManager } from "./manager.js";

export const getDbPath = () => join(homedir(), ".lovelace", "memory.db");

export default function lovelaceMemoryExtension(pi: ExtensionAPI, dbPath: string = getDbPath()) {
  const store = new LovelaceStore(dbPath);
  const manager = new LovelaceManager(pi, store);

  pi.on("session_start", async (_event, ctx) => manager.refreshContext(ctx));
  pi.on("session_switch", async (_event, ctx) => manager.refreshContext(ctx));
  pi.on("session_fork", async (_event, ctx) => manager.refreshContext(ctx));
  pi.on("session_tree", async (_event, ctx) => manager.refreshContext(ctx));
  pi.on("session_shutdown", async () => store.close());

  pi.on("session_before_compact", async (event, ctx) => manager.onSessionBeforeCompact(event, ctx));
  pi.on("before_agent_start", async (event, ctx) => manager.onBeforeAgentStart(event, ctx));
  pi.on("tool_result", async (event, ctx) => manager.onToolResult(event, ctx));

  pi.registerCommand("task", {
    description: "Set, clear, show, or list recent tasks",
    handler: async (args, ctx) => manager.handleTaskCommand(args, ctx),
  });

  pi.registerCommand("pr", {
    description: "Link a PR, show it, or update backlink status",
    handler: async (args, ctx) => manager.handlePrCommand(args, ctx),
  });

  pi.registerCommand("remember", {
    description: "Store a Lovelace memory: /remember <scope> <text>",
    handler: async (args, ctx) => manager.handleRememberCommand(args, ctx),
  });

  pi.registerCommand("forget", {
    description: "Archive a memory by id",
    handler: async (args, ctx) => manager.handleForgetCommand(args, ctx),
  });

  pi.registerCommand("memory", {
    description: "Show relevant Lovelace memory or run /memory scan",
    handler: async (args, ctx) => manager.handleMemoryCommand(args, ctx),
  });
}
