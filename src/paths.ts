import os from "node:os";
import path from "node:path";
import { AppError } from "./errors.js";
import { ProjectIdSchema } from "./types/project.js";

export function runnerHome(home = os.homedir()): string {
  return path.join(home, ".java-project-runner");
}

export function registryPath(home = os.homedir()): string {
  return path.join(runnerHome(home), "projects.json");
}

export function stateDir(home = os.homedir()): string {
  return path.join(runnerHome(home), "state");
}

export function stateFilePath(home = os.homedir()): string {
  return path.join(stateDir(home), "projects-state.json");
}

/** Validate projectId before joining under logs/ (defense in depth). */
export function assertSafeProjectId(projectId: string): string {
  const parsed = ProjectIdSchema.safeParse(projectId);
  if (!parsed.success) {
    throw new AppError(
      "INVALID_ARGS",
      `invalid project id: ${parsed.error.issues[0]?.message ?? "rejected"}`,
    );
  }
  if (
    projectId.includes("/") ||
    projectId.includes("\\") ||
    projectId.includes("\0") ||
    path.basename(projectId) !== projectId
  ) {
    throw new AppError("INVALID_ARGS", `invalid project id path segment: ${projectId}`);
  }
  return parsed.data;
}

export function logsDir(projectId: string, home = os.homedir()): string {
  const id = assertSafeProjectId(projectId);
  return path.join(runnerHome(home), "logs", id);
}
