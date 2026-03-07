import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import { LovelaceStore } from "../extensions/memory/src/db.ts";
import { scanProject } from "../extensions/memory/src/scan.ts";

const dir = mkdtempSync(join(tmpdir(), "lovelace-scan-"));
const dbPath = join(dir, "memory.db");
const repoPath = join(dir, "repo");
mkdirSync(repoPath);
mkdirSync(join(repoPath, "src"));
mkdirSync(join(repoPath, "src", "generated"), { recursive: true });
mkdirSync(join(repoPath, "_infrastructure"));
writeFileSync(join(repoPath, "package.json"), JSON.stringify({ packageManager: "pnpm@10.0.0", workspaces: ["packages/*"] }));
writeFileSync(join(repoPath, "pnpm-workspace.yaml"), "packages:\n  - packages/*\n");

const store = new LovelaceStore(dbPath);
try {
	const project = store.upsertProject({ name: "repo", rootPath: repoPath });
	const created = scanProject(store, project.id, repoPath);
	assert.ok(created.some((entry) => entry.includes("uses pnpm and has workspace configuration")));
	assert.equal(created.filter((entry) => entry.includes("pnpm")).length, 1);
	assert.ok(created.some((entry) => entry.includes("generated-code directory")));
	assert.ok(created.some((entry) => entry.includes("`_infrastructure` directory")));
	console.log("scan tests passed");
} finally {
	store.close();
	rmSync(dir, { recursive: true, force: true });
}
