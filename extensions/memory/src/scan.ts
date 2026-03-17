import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import type { CreateMemoryInput } from "./db.js";

interface ScanMemoryWriter {
  createMemory(input: CreateMemoryInput): Promise<{ text: string }> | { text: string };
}

async function addFact(
  created: string[],
  seen: Set<string>,
  text: string | null | undefined,
  create: () => Promise<string> | string,
) {
  if (!text || seen.has(text)) return;
  seen.add(text);
  created.push(await create());
}

async function createFact(
  memoryBackend: ScanMemoryWriter,
  input: CreateMemoryInput,
): Promise<string> {
  const memory = await memoryBackend.createMemory(input);
  return memory.text;
}

export async function scanProject(
  memoryBackend: ScanMemoryWriter,
  projectId: string,
  rootPath: string,
): Promise<string[]> {
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
    await addFact(created, seen, "This repo uses pnpm and has workspace configuration.", () =>
      createFact(memoryBackend, {
        scope: "project",
        projectId,
        kind: "command",
        text: "This repo uses pnpm and has workspace configuration.",
        source: "scan",
        confidence: 0.95,
      }),
    );
  } else {
    if (usesPnpm) {
      await addFact(created, seen, "This repo uses pnpm.", () =>
        createFact(memoryBackend, {
          scope: "project",
          projectId,
          kind: "command",
          text: "This repo uses pnpm.",
          source: "scan",
          confidence: 0.95,
        }),
      );
    }
    if (hasWorkspace) {
      await addFact(
        created,
        seen,
        "This repo appears to be a JavaScript/TypeScript workspace or monorepo.",
        () =>
          createFact(memoryBackend, {
            scope: "project",
            projectId,
            kind: "structure",
            text: "This repo appears to be a JavaScript/TypeScript workspace or monorepo.",
            source: "scan",
            confidence: 0.85,
          }),
      );
    }
  }

  if (existsSync(cargoTomlPath)) {
    await addFact(created, seen, "This repo has Rust/Cargo configuration.", () =>
      createFact(memoryBackend, {
        scope: "project",
        projectId,
        kind: "structure",
        text: "This repo has Rust/Cargo configuration.",
        source: "scan",
        confidence: 0.9,
      }),
    );
  }

  if (existsSync(pyprojectPath)) {
    await addFact(created, seen, "This repo has Python pyproject configuration.", () =>
      createFact(memoryBackend, {
        scope: "project",
        projectId,
        kind: "structure",
        text: "This repo has Python pyproject configuration.",
        source: "scan",
        confidence: 0.9,
      }),
    );
  }

  if (existsSync(makefilePath)) {
    await addFact(
      created,
      seen,
      "This repo has a Makefile; common tasks may be exposed there.",
      () =>
        createFact(memoryBackend, {
          scope: "project",
          projectId,
          kind: "command",
          text: "This repo has a Makefile; common tasks may be exposed there.",
          source: "scan",
          confidence: 0.8,
        }),
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
    await addFact(created, seen, generatedText, () =>
      createFact(memoryBackend, {
        scope: "project",
        projectId,
        kind: "constraint",
        text: generatedText,
        source: "scan",
        confidence: 0.75,
      }),
    );
  }

  if (hasInfrastructureDir) {
    await addFact(created, seen, "This repo has an `_infrastructure` directory.", () =>
      createFact(memoryBackend, {
        scope: "project",
        projectId,
        kind: "structure",
        text: "This repo has an `_infrastructure` directory.",
        source: "scan",
        confidence: 0.75,
      }),
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
      await addFact(created, seen, dirsText, () =>
        createFact(memoryBackend, {
          scope: "project",
          projectId,
          kind: "structure",
          text: dirsText,
          source: "scan",
          confidence: 0.6,
        }),
      );
    }
  } catch {
    // Ignore scan failures.
  }

  return created;
}
