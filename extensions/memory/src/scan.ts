import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import type { LovelaceStore } from "./db.js";

export function scanProject(store: LovelaceStore, projectId: string, rootPath: string): string[] {
	const created: string[] = [];

	const packageJsonPath = join(rootPath, "package.json");
	const pnpmWorkspacePath = join(rootPath, "pnpm-workspace.yaml");
	const cargoTomlPath = join(rootPath, "Cargo.toml");
	const pyprojectPath = join(rootPath, "pyproject.toml");
	const makefilePath = join(rootPath, "Makefile");

	if (existsSync(packageJsonPath)) {
		try {
			const pkg = JSON.parse(readFileSync(packageJsonPath, "utf8")) as { packageManager?: string; workspaces?: unknown };
			if (pkg.packageManager?.startsWith("pnpm")) {
				created.push(store.createMemory({
					scope: "project",
					projectId,
					kind: "command",
					text: "This repo uses pnpm.",
					source: "scan",
					confidence: 0.95,
				}).text);
			}
			if (Array.isArray(pkg.workspaces) || typeof pkg.workspaces === "object") {
				created.push(store.createMemory({
					scope: "project",
					projectId,
					kind: "structure",
					text: "This repo appears to be a JavaScript/TypeScript workspace or monorepo.",
					source: "scan",
					confidence: 0.85,
				}).text);
			}
		} catch {
			// Ignore invalid package.json for now.
		}
	}

	if (existsSync(pnpmWorkspacePath)) {
		created.push(store.createMemory({
			scope: "project",
			projectId,
			kind: "structure",
			text: "This repo has a pnpm workspace configuration.",
			source: "scan",
			confidence: 0.95,
		}).text);
	}

	if (existsSync(cargoTomlPath)) {
		created.push(store.createMemory({
			scope: "project",
			projectId,
			kind: "structure",
			text: "This repo has Rust/Cargo configuration.",
			source: "scan",
			confidence: 0.9,
		}).text);
	}

	if (existsSync(pyprojectPath)) {
		created.push(store.createMemory({
			scope: "project",
			projectId,
			kind: "structure",
			text: "This repo has Python pyproject configuration.",
			source: "scan",
			confidence: 0.9,
		}).text);
	}

	if (existsSync(makefilePath)) {
		created.push(store.createMemory({
			scope: "project",
			projectId,
			kind: "command",
			text: "This repo has a Makefile; common tasks may be exposed there.",
			source: "scan",
			confidence: 0.8,
		}).text);
	}

	for (const candidate of ["src/generated", "generated", "_infrastructure"]) {
		const fullPath = join(rootPath, candidate);
		if (existsSync(fullPath) && statSync(fullPath).isDirectory()) {
			const text =
				candidate === "_infrastructure"
					? "This repo has an `_infrastructure` directory."
					: `This repo has a likely generated-code directory at \`${candidate}\`.`;
			created.push(store.createMemory({
				scope: "project",
				projectId,
				kind: candidate === "_infrastructure" ? "structure" : "constraint",
				text,
				source: "scan",
				confidence: 0.75,
			}).text);
		}
	}

	try {
		const dirs = readdirSync(rootPath)
			.filter((entry) => !entry.startsWith("."))
			.map((entry) => ({ entry, path: join(rootPath, entry) }))
			.filter(({ path }) => {
				try {
					return statSync(path).isDirectory();
				} catch {
					return false;
				}
			})
			.slice(0, 8)
			.map(({ entry }) => entry);
		if (dirs.length > 0) {
			created.push(store.createMemory({
				scope: "project",
				projectId,
				kind: "structure",
				text: `Top-level directories include: ${dirs.join(", ")}.`,
				source: "scan",
				confidence: 0.6,
			}).text);
		}
	} catch {
		// Ignore scan failures.
	}

	return created;
}
