import { basename } from "node:path";

export interface RepoInfo {
  rootPath: string;
  name: string;
  gitRemote: string | null;
  branch: string | null;
}

function cleanStdout(text: string): string {
  return text.trim();
}

export async function detectRepo(
  piExec: (
    command: string,
    args: string[],
    options?: { timeout?: number; signal?: AbortSignal },
  ) => Promise<{ stdout: string; stderr: string; code: number | null }>,
  cwd: string,
): Promise<RepoInfo> {
  const rootResult = await piExec("git", ["rev-parse", "--show-toplevel"], { timeout: 5000 });
  const rootPath = rootResult.code === 0 ? cleanStdout(rootResult.stdout) : cwd;
  const remoteResult = await piExec("git", ["remote", "get-url", "origin"], { timeout: 5000 });
  const branchResult = await piExec("git", ["branch", "--show-current"], { timeout: 5000 });

  return {
    rootPath,
    name: basename(rootPath),
    gitRemote: remoteResult.code === 0 ? cleanStdout(remoteResult.stdout) : null,
    branch: branchResult.code === 0 ? cleanStdout(branchResult.stdout) || null : null,
  };
}
