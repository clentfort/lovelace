import { describe, expect, it, vi } from "vitest";
import { detectRepo } from "../extensions/memory/src/repo.js";

describe("repo", () => {
  it("detects repo info successfully", async () => {
    const piExec = vi.fn().mockImplementation((command, args) => {
      if (command === "git" && args[0] === "rev-parse") {
        return Promise.resolve({ stdout: "/path/to/repo\n", stderr: "", code: 0 });
      }
      if (command === "git" && args[0] === "remote") {
        return Promise.resolve({ stdout: "https://github.com/org/repo.git\n", stderr: "", code: 0 });
      }
      if (command === "git" && args[0] === "branch") {
        return Promise.resolve({ stdout: "main\n", stderr: "", code: 0 });
      }
      return Promise.resolve({ stdout: "", stderr: "", code: 0 });
    });

    const info = await detectRepo(piExec, "/some/cwd");

    expect(info).toEqual({
      rootPath: "/path/to/repo",
      name: "repo",
      gitRemote: "https://github.com/org/repo.git",
      branch: "main",
    });
    expect(piExec).toHaveBeenCalledTimes(3);
  });

  it("handles git failures and empty branch", async () => {
    const piExec = vi.fn().mockImplementation((command, args) => {
      if (command === "git" && args[0] === "rev-parse") {
        return Promise.resolve({ stdout: "", stderr: "fatal: not a git repo", code: 128 });
      }
      if (command === "git" && args[0] === "remote") {
        return Promise.resolve({ stdout: "", stderr: "error", code: 1 });
      }
      if (command === "git" && args[0] === "branch") {
        return Promise.resolve({ stdout: "\n", stderr: "", code: 0 });
      }
      return Promise.resolve({ stdout: "", stderr: "", code: 0 });
    });

    const info = await detectRepo(piExec, "/some/cwd");

    expect(info).toEqual({
      rootPath: "/some/cwd",
      name: "cwd", // basename of /some/cwd
      gitRemote: null,
      branch: null,
    });
  });

  it("handles branch command failure", async () => {
    const piExec = vi.fn().mockImplementation((command, args) => {
      if (command === "git" && args[0] === "rev-parse") {
        return Promise.resolve({ stdout: "/path/to/repo", code: 0 });
      }
      if (command === "git" && args[0] === "remote") {
        return Promise.resolve({ stdout: "remote-url", code: 0 });
      }
      if (command === "git" && args[0] === "branch") {
        return Promise.resolve({ stdout: "", stderr: "error", code: 1 });
      }
      return Promise.resolve({ stdout: "", stderr: "", code: 0 });
    });

    const info = await detectRepo(piExec, "/some/cwd");
    expect(info.branch).toBeNull();
  });
});
