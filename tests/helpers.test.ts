import { describe, expect, it } from "vitest";
import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import {
  getSessionTaskId,
  inferMemoryKind,
  isInterestingProjectCommand,
  mentionsCurrentPr,
  parseRememberArgs,
  toolContentToText,
} from "../extensions/memory/src/helpers.js";

describe("helpers", () => {
  describe("toolContentToText", () => {
    it("handles non-array content", () => {
      expect(toolContentToText("string")).toBe("");
      expect(toolContentToText(null)).toBe("");
    });

    it("extracts text from blocks", () => {
      const content = [
        { type: "text", text: "Hello" },
        { type: "image" },
        { type: "text", text: "World" },
      ];
      expect(toolContentToText(content)).toBe("Hello\n\nWorld");
    });

    it("handles missing text in text blocks", () => {
      const content = [{ type: "text" }];
      expect(toolContentToText(content)).toBe("");
    });
  });

  describe("parseRememberArgs", () => {
    it("parses valid scopes", () => {
      expect(parseRememberArgs("user some text")).toEqual({ scope: "user", text: "some text" });
      expect(parseRememberArgs("project more text")).toEqual({
        scope: "project",
        text: "more text",
      });
      expect(parseRememberArgs("domain something")).toEqual({
        scope: "domain",
        text: "something",
      });
      expect(parseRememberArgs("task task detail")).toEqual({
        scope: "task",
        text: "task detail",
      });
    });

    it("handles multiline text", () => {
      expect(parseRememberArgs("user line 1\nline 2")).toEqual({
        scope: "user",
        text: "line 1\nline 2",
      });
    });

    it("returns undefined for invalid args", () => {
      expect(parseRememberArgs("invalid text")).toBeUndefined();
      expect(parseRememberArgs("user")).toBeUndefined();
    });
  });

  describe("inferMemoryKind", () => {
    it("infers preference", () => {
      expect(inferMemoryKind("I prefer pnpm")).toBe("preference");
      expect(inferMemoryKind("Always ask before deleting")).toBe("preference");
    });

    it("infers constraint", () => {
      expect(inferMemoryKind("Do not use yarn")).toBe("constraint");
      expect(inferMemoryKind("Don't touch the dist folder")).toBe("constraint");
      expect(inferMemoryKind("Avoid global variables")).toBe("constraint");
    });

    it("infers command", () => {
      expect(inferMemoryKind("Run pnpm install")).toBe("command");
      expect(inferMemoryKind("Try npm start")).toBe("command");
      expect(inferMemoryKind("Use make build")).toBe("command");
    });

    it("infers workflow", () => {
      expect(inferMemoryKind("I usually test after build")).toBe("workflow");
      expect(inferMemoryKind("Standard workflow involves CI")).toBe("workflow");
    });

    it("defaults to note", () => {
      expect(inferMemoryKind("Just a random thought")).toBe("note");
    });
  });

  describe("isInterestingProjectCommand", () => {
    it("identifies interesting commands", () => {
      expect(isInterestingProjectCommand("pnpm test")).toBe(true);
      expect(isInterestingProjectCommand("npm run build")).toBe(true);
      expect(isInterestingProjectCommand("yarn dev")).toBe(true);
      expect(isInterestingProjectCommand("make all")).toBe(true);
      expect(isInterestingProjectCommand("cargo build")).toBe(true);
      expect(isInterestingProjectCommand("pytest")).toBe(true);
      expect(isInterestingProjectCommand("go test ./...")).toBe(true);
      expect(isInterestingProjectCommand("just run")).toBe(true);
    });

    it("rejects uninteresting commands", () => {
      expect(isInterestingProjectCommand("ls -la")).toBe(false);
      expect(isInterestingProjectCommand("echo hello")).toBe(false);
    });
  });

  describe("mentionsCurrentPr", () => {
    const pr = {
      id: "pr-1",
      projectId: "proj-1",
      prNumber: 42,
      prUrl: "https://github.com/org/repo/pull/42",
      title: "Fix bug",
      createdAt: 0,
      updatedAt: 0,
    };

    it("returns false if no pr", () => {
      expect(mentionsCurrentPr(undefined, "some text")).toBe(false);
    });

    it("matches pr url", () => {
      expect(mentionsCurrentPr(pr, "See https://github.com/org/repo/pull/42 for details")).toBe(
        true,
      );
    });

    it("matches pr number with #", () => {
      expect(mentionsCurrentPr(pr, "Linked to #42")).toBe(true);
    });

    it("matches pr number in path", () => {
      expect(mentionsCurrentPr(pr, "Referencing /pull/42")).toBe(true);
    });

    it("returns false if no match", () => {
      expect(mentionsCurrentPr(pr, "Fixing issue #43")).toBe(false);
    });
  });

  describe("getSessionTaskId", () => {
    it("finds task id in session branch", () => {
      const ctx = {
        sessionManager: {
          getBranch: () => [
            { type: "bash", data: {} },
            { type: "custom", customType: "lovelace-task", data: { taskId: "task-123" } },
          ],
        },
      } as unknown as ExtensionContext;

      expect(getSessionTaskId(ctx, "lovelace-task")).toBe("task-123");
    });

    it("returns null if task id is null in entry", () => {
      const ctx = {
        sessionManager: {
          getBranch: () => [
            { type: "custom", customType: "lovelace-task", data: { taskId: null } },
          ],
        },
      } as unknown as ExtensionContext;

      expect(getSessionTaskId(ctx, "lovelace-task")).toBe(null);
    });

    it("returns null if taskId is missing in entry data", () => {
      const ctx = {
        sessionManager: {
          getBranch: () => [{ type: "custom", customType: "lovelace-task", data: {} }],
        },
      } as unknown as ExtensionContext;

      expect(getSessionTaskId(ctx, "lovelace-task")).toBe(null);
    });

    it("returns undefined if no entry found", () => {
      const ctx = {
        sessionManager: {
          getBranch: () => [{ type: "bash", data: {} }],
        },
      } as unknown as ExtensionContext;

      expect(getSessionTaskId(ctx, "lovelace-task")).toBeUndefined();
    });
  });
});
