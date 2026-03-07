import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LovelaceStore } from "../extensions/memory/src/db.ts";
import { scanProject } from "../extensions/memory/src/scan.ts";

const cleanupPaths: string[] = [];

afterEach(() => {
	while (cleanupPaths.length > 0) {
		const path = cleanupPaths.pop();
		if (path) rmSync(path, { recursive: true, force: true });
	}
});

describe("scanProject", () => {
	it("dedupes overlapping repo facts", () => {
		const dir = mkdtempSync(join(tmpdir(), "lovelace-scan-"));
		cleanupPaths.push(dir);
		const dbPath = join(dir, "memory.db");
		const repoPath = join(dir, "repo");
		mkdirSync(repoPath);
		mkdirSync(join(repoPath, "src", "generated"), { recursive: true });
		mkdirSync(join(repoPath, "_infrastructure"));
		writeFileSync(join(repoPath, "package.json"), JSON.stringify({ packageManager: "pnpm@10.0.0", workspaces: ["packages/*"] }));
		writeFileSync(join(repoPath, "pnpm-workspace.yaml"), "packages:\n  - packages/*\n");

		const store = new LovelaceStore(dbPath);
		try {
			const project = store.upsertProject({ name: "repo", rootPath: repoPath });
			const created = scanProject(store, project.id, repoPath);
			expect(created.some((entry) => entry.includes("uses pnpm and has workspace configuration"))).toBe(true);
			expect(created.filter((entry) => entry.includes("pnpm")).length).toBe(1);
			expect(created.some((entry) => entry.includes("generated-code directory"))).toBe(true);
			expect(created.some((entry) => entry.includes("`_infrastructure` directory"))).toBe(true);
		} finally {
			store.close();
		}
	});
});
