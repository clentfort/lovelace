import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import type { LovelaceStore } from "./db.js";

function addFact(
  created: string[],
  seen: Set<string>,
  text: string | null | undefined,
  create: () => string,
) {
  if (!text || seen.has(text)) return;
  seen.add(text);
  created.push(create());
}

export function scanProject(store: LovelaceStore, projectId: string, rootPath: string): string[] {
  const created: string[] = [];
  const seen = new Set<string>();

  const packageJsonPath = join(rootPath, "package.json");
  const pnpmWorkspacePath = join(rootPath, "pnpm-workspace.yaml");
  const cargoTomlPath = join(rootPath, "Cargo.toml");
  const pyprojectPath = join(rootPath, "pyproject.toml");
  const makefilePath = join(rootPath, "Makefile");

  let usesPnpm = false;
  let hasWorkspace = false;
  if (existsSync(packageJsonPath)) {
    try {
      const pkg = JSON.parse(readFileSync(packageJsonPath, "utf8")) as {
        packageManager?: string;
        workspaces?: unknown;
      };
      usesPnpm = Boolean(pkg.packageManager?.startsWith("pnpm"));
      hasWorkspace = Array.isArray(pkg.workspaces) || typeof pkg.workspaces === "object";
    } catch {
      // Ignore invalid package.json for now.
    }
  }
  if (existsSync(pnpmWorkspacePath)) {
    usesPnpm = true;
    hasWorkspace = true;
  }

  if (usesPnpm && hasWorkspace) {
    addFact(
      created,
      seen,
      "This repo uses pnpm and has workspace configuration.",
      () =>
        store.createMemory({
          scope: "project",
          projectId,
          kind: "command",
          text: "This repo uses pnpm and has workspace configuration.",
          source: "scan",
          confidence: 0.95,
        }).text,
    );
  } else {
    if (usesPnpm) {
      addFact(
        created,
        seen,
        "This repo uses pnpm.",
        () =>
          store.createMemory({
            scope: "project",
            projectId,
            kind: "command",
            text: "This repo uses pnpm.",
            source: "scan",
            confidence: 0.95,
          }).text,
      );
    }
    if (hasWorkspace) {
      addFact(
        created,
        seen,
        "This repo appears to be a JavaScript/TypeScript workspace or monorepo.",
        () =>
          store.createMemory({
            scope: "project",
            projectId,
            kind: "structure",
            text: "This repo appears to be a JavaScript/TypeScript workspace or monorepo.",
            source: "scan",
            confidence: 0.85,
          }).text,
      );
    }
  }

  if (existsSync(cargoTomlPath)) {
    addFact(
      created,
      seen,
      "This repo has Rust/Cargo configuration.",
      () =>
        store.createMemory({
          scope: "project",
          projectId,
          kind: "structure",
          text: "This repo has Rust/Cargo configuration.",
          source: "scan",
          confidence: 0.9,
        }).text,
    );
  }

  if (existsSync(pyprojectPath)) {
    addFact(
      created,
      seen,
      "This repo has Python pyproject configuration.",
      () =>
        store.createMemory({
          scope: "project",
          projectId,
          kind: "structure",
          text: "This repo has Python pyproject configuration.",
          source: "scan",
          confidence: 0.9,
        }).text,
    );
  }

  if (existsSync(makefilePath)) {
    addFact(
      created,
      seen,
      "This repo has a Makefile; common tasks may be exposed there.",
      () =>
        store.createMemory({
          scope: "project",
          projectId,
          kind: "command",
          text: "This repo has a Makefile; common tasks may be exposed there.",
          source: "scan",
          confidence: 0.8,
        }).text,
    );
  }

  const generatedDirs: string[] = [];
  let hasInfrastructureDir = false;
  for (const candidate of ["src/generated", "generated", "_infrastructure"]) {
    const fullPath = join(rootPath, candidate);
    if (existsSync(fullPath) && statSync(fullPath).isDirectory()) {
      if (candidate === "_infrastructure") hasInfrastructureDir = true;
      else generatedDirs.push(candidate);
    }
  }
  if (generatedDirs.length > 0) {
    const generatedText =
      generatedDirs.length === 1
        ? `This repo has a likely generated-code directory at \`${generatedDirs[0]}\`.`
        : `This repo has likely generated-code directories at ${generatedDirs.map((dir) => `\`${dir}\``).join(", ")}.`;
    addFact(
      created,
      seen,
      generatedText,
      () =>
        store.createMemory({
          scope: "project",
          projectId,
          kind: "constraint",
          text: generatedText,
          source: "scan",
          confidence: 0.75,
        }).text,
    );
  }
  if (hasInfrastructureDir) {
    addFact(
      created,
      seen,
      "This repo has an `_infrastructure` directory.",
      () =>
        store.createMemory({
          scope: "project",
          projectId,
          kind: "structure",
          text: "This repo has an `_infrastructure` directory.",
          source: "scan",
          confidence: 0.75,
        }).text,
    );
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
      .map(({ entry }) => entry)
      .filter((entry) => !["generated", "_infrastructure"].includes(entry))
      .slice(0, 8);
    if (dirs.length > 0) {
      const dirsText = `Top-level directories include: ${dirs.join(", ")}.`;
      addFact(
        created,
        seen,
        dirsText,
        () =>
          store.createMemory({
            scope: "project",
            projectId,
            kind: "structure",
            text: dirsText,
            source: "scan",
            confidence: 0.6,
          }).text,
      );
    }
  } catch {
    // Ignore scan failures.
  }

  return created;
}
