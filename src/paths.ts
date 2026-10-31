import os from "node:os";
import path from "node:path";
import { AppError } from "./errors.js";
import { ProjectIdSchema } from "./types/project.js";

/**
 * Runner data root (registry/state/logs/locks).
 * Override with absolute `JAVA_PROJECT_RUNNER_HOME` (optional escape hatch).
 * Default: `~/.java-project-runner` (same home for all MCP clients).
 */
export function runnerHome(userHome = os.homedir()): string {
  const env = process.env.JAVA_PROJECT_RUNNER_HOME?.trim();
  if (env) {
    return path.resolve(env);
  }
  return path.join(userHome, ".java-project-runner");
}

export function registryPath(userHome = os.homedir()): string {
  return path.join(runnerHome(userHome), "projects.json");
}

export function stateDir(userHome = os.homedir()): string {
  return path.join(runnerHome(userHome), "state");
}

export function stateFilePath(userHome = os.homedir()): string {
  return path.join(stateDir(userHome), "projects-state.json");
}

export function locksDir(userHome = os.homedir()): string {
  return path.join(runnerHome(userHome), "locks");
}

export function projectLockPath(
  projectId: string,
  userHome = os.homedir(),
): string {
  const id = assertSafeProjectId(projectId);
  return path.join(locksDir(userHome), `${id}.lock`);
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
