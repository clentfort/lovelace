import assert from "node:assert/strict";
import { extractTaskRef, parseJiraTaskContext, parsePrContext } from "../extensions/memory/src/parse.ts";

assert.equal(extractTaskRef("Work on PROJ-123 today"), "PROJ-123");

const jira = parseJiraTaskContext(`PROJ-123\nSummary: Retry logic is broken\nStatus: In Progress`);
assert.equal(jira?.ref, "PROJ-123");
assert.equal(jira?.title, "Retry logic is broken");

const jiraFallback = parseJiraTaskContext(`Issue: PROJ-999 Billing retries refactor`);
assert.equal(jiraFallback?.ref, "PROJ-999");
assert.equal(jiraFallback?.title, "Issue: Billing retries refactor");

const pr = parsePrContext(`Title: PROJ-123 Fix retry logic\nhttps://github.com/acme/api/pull/42`);
assert.equal(pr?.prNumber, 42);
assert.equal(pr?.prUrl, "https://github.com/acme/api/pull/42");
assert.equal(pr?.title, "PROJ-123 Fix retry logic");
assert.equal(pr?.taskRef, "PROJ-123");

const prNumberOnly = parsePrContext(`Created pull request for branch feat/PROJ-123\nPR #77`);
assert.equal(prNumberOnly?.prNumber, 77);
assert.equal(prNumberOnly?.taskRef, "PROJ-123");

console.log("parse tests passed");
