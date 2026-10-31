import os from "node:os";
import path from "node:path";

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

export function logsDir(projectId: string, home = os.homedir()): string {
  return path.join(runnerHome(home), "logs", projectId);
}
