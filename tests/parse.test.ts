import { describe, expect, it } from "vitest";
import {
  extractTaskRef,
  parseJiraTaskContext,
  parsePrContext,
} from "../extensions/memory/src/parse.ts";

describe("parse helpers", () => {
  it("extracts task refs", () => {
    expect(extractTaskRef("Work on PROJ-123 today")).toBe("PROJ-123");
  });

  it("parses jira task context", () => {
    const jira = parseJiraTaskContext(
      `PROJ-123\nSummary: Retry logic is broken\nStatus: In Progress`,
    );
    expect(jira?.ref).toBe("PROJ-123");
    expect(jira?.title).toBe("Retry logic is broken");

    const jiraFallback = parseJiraTaskContext(`Issue: PROJ-999 Billing retries refactor`);
    expect(jiraFallback?.ref).toBe("PROJ-999");
    expect(jiraFallback?.title).toBe("Issue: Billing retries refactor");
  });

  it("parses pr context", () => {
    const pr = parsePrContext(
      `Title: PROJ-123 Fix retry logic\nhttps://github.com/acme/api/pull/42`,
    );
    expect(pr?.prNumber).toBe(42);
    expect(pr?.prUrl).toBe("https://github.com/acme/api/pull/42");
    expect(pr?.title).toBe("PROJ-123 Fix retry logic");
    expect(pr?.taskRef).toBe("PROJ-123");

    const prNumberOnly = parsePrContext(`Created pull request for branch feat/PROJ-123\nPR #77`);
    expect(prNumberOnly?.prNumber).toBe(77);
    expect(prNumberOnly?.taskRef).toBe("PROJ-123");
  });
});
