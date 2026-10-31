import { spawn, type ChildProcess } from "node:child_process";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { AppError } from "../errors.js";
import {
  assertAllowedJvmArgs,
  assertAllowedProfile,
} from "../security/command-policy.js";
import type { ProjectConfig } from "../types/project.js";
import type { ProjectRuntimeState } from "../types/state.js";
import { runMavenBuild } from "./build.js";
import { checkLoopbackHealth } from "./health.js";
import {
  decideBuild,
  type BuildSkipReason,
} from "./jar-freshness.js";
import { jarResolvable, resolveJarPath } from "./jar-resolve.js";
import {
  createLogWriteStream,
  ensureLogDir,
  logFilePath,
} from "./logs.js";
import { projectMutex, StateStore } from "./state-store.js";

export interface StartOptions {
  profile?: string;
  rebuild?: boolean;
  skipBuild?: boolean;
}

export interface StartResult {
  state: ProjectRuntimeState;
  buildSkipped: boolean;
  buildSkipReason: BuildSkipReason | null;
}

interface LiveHandle {
  child: ChildProcess;
  pid: number;
  pgid: number;
  jarResolved: string;
  javaCommand: string;
}

export class ProcessManager {
  private readonly live = new Map<string, LiveHandle>();

  constructor(private readonly stateStore: StateStore) {}

  /** On server boot: reconcile persisted PIDs; mark unknown when argv mismatch. */
  async recover(): Promise<void> {
    const all = await this.stateStore.getAll();
    for (const [projectId, st] of Object.entries(all)) {
      if (
        st.status !== "running" &&
        st.status !== "starting" &&
        st.status !== "stopping"
      ) {
        continue;
      }
      const pid = st.pid ?? null;
      const jar = st.jarResolved ?? "";
      if (!pid || !isPidAlive(pid) || !cmdlineMatchesManagedJava(pid, jar)) {
        await this.stateStore.update(projectId, {
          status: "unknown",
          lastError:
            "process not verified after server restart (PID missing or argv mismatch); refusing blind kill",
          pid: null,
          pgid: null,
        });
        continue;
      }
      await this.stateStore.update(projectId, {
        status: "running",
        readiness: "unverified",
        lastError: null,
      });
    }
  }

  async build(
    project: ProjectConfig & { resolvedPath: string },
    options: { goal?: string; skipTests?: boolean; profile?: string } = {},
  ) {
    return projectMutex.runExclusive(project.id, "build", async () => {
      const result = await runMavenBuild(project, options);
      const prev = await this.stateStore.get(project.id);
      await this.stateStore.update(project.id, {
        logPaths: { ...prev.logPaths, build: result.logPath },
        lastError: result.success ? null : result.message,
      });
      if (!result.success) {
        throw new AppError("BUILD_FAILED", result.message);
      }
      return result;
    });
  }

  async start(
    project: ProjectConfig & { resolvedPath: string },
    options: StartOptions = {},
  ): Promise<StartResult> {
    return projectMutex.runExclusive(project.id, "start", () =>
      this.startCore(project, options),
    );
  }

  async stop(
    project: ProjectConfig & { resolvedPath: string },
    timeoutSeconds?: number,
  ): Promise<ProjectRuntimeState> {
    return projectMutex.runExclusive(project.id, "stop", () =>
      this.stopCore(project, timeoutSeconds),
    );
  }

  async restart(
    project: ProjectConfig & { resolvedPath: string },
    options: StartOptions = {},
  ): Promise<StartResult> {
    return projectMutex.runExclusive(project.id, "restart", async () => {
      const current = await this.stateStore.get(project.id);
      if (
        current.status === "running" ||
        current.status === "starting" ||
        this.live.has(project.id) ||
        (current.pid != null && isPidAlive(current.pid))
      ) {
        await this.stopCore(project);
      }
      return this.startCore(project, options);
    });
  }

  async status(projectId?: string): Promise<
    | { projectId: string; state: ProjectRuntimeState; note?: string }
    | {
        projects: Array<{
          projectId: string;
          state: ProjectRuntimeState;
          note?: string;
        }>;
      }
  > {
    const annotate = async (id: string, state: ProjectRuntimeState) => {
      let note: string | undefined;
      if (state.status === "running") {
        if (!state.pid || !isPidAlive(state.pid)) {
          const next = await this.stateStore.update(id, {
            status: "failed",
            lastError: "pid no longer alive",
            pid: null,
            pgid: null,
          });
          return { projectId: id, state: next, note: "process gone" };
        }
        if (
          state.readiness === "not_configured" ||
          state.readiness === "unverified"
        ) {
          note = "process alive; application readiness not verified";
        }
      }
      return { projectId: id, state, note };
    };

    if (projectId) {
      return annotate(projectId, await this.stateStore.get(projectId));
    }
    const all = await this.stateStore.getAll();
    const projects = [];
    for (const [id, st] of Object.entries(all)) {
      projects.push(await annotate(id, st));
    }
    return { projects };
  }

  private async startCore(
    project: ProjectConfig & { resolvedPath: string },
    options: StartOptions = {},
  ): Promise<StartResult> {
    const current = await this.stateStore.get(project.id);
    if (
      this.live.has(project.id) ||
      (current.pid != null &&
        isPidAlive(current.pid) &&
        (current.status === "running" || current.status === "starting"))
    ) {
      throw new AppError(
        "BUSY",
        `project already running (pid=${current.pid})`,
      );
    }

    await this.stateStore.update(project.id, {
      status: "starting",
      lastError: null,
      exitCode: null,
      readiness: project.healthCheckUrl ? "unverified" : "not_configured",
    });

    const pre = jarResolvable(project.resolvedPath, project.jarPath);
    const decision = decideBuild({
      rebuild: options.rebuild,
      skipBuild: options.skipBuild,
      projectRoot: project.resolvedPath,
      jarPath: pre.ok && pre.resolved ? pre.resolved : null,
    });

    let buildLogPath: string | undefined = current.logPaths?.build;
    if (!decision.skip) {
      const buildResult = await runMavenBuild(project, {
        goal: project.buildGoal ?? "package",
        profile: options.profile,
      });
      buildLogPath = buildResult.logPath;
      if (!buildResult.success) {
        const prev = await this.stateStore.get(project.id);
        await this.stateStore.update(project.id, {
          status: "failed",
          lastError: buildResult.message,
          logPaths: { ...prev.logPaths, build: buildResult.logPath },
        });
        throw new AppError("BUILD_FAILED", buildResult.message);
      }
    }

    let jarResolved: string;
    try {
      jarResolved = resolveJarPath(project.resolvedPath, project.jarPath);
    } catch (err) {
      const msg =
        decision.skip && options.skipBuild
          ? `skipBuild set but JAR not resolvable: ${(err as Error).message}`
          : (err as Error).message;
      await this.stateStore.update(project.id, {
        status: "failed",
        lastError: msg,
      });
      throw new AppError("START_FAILED", msg);
    }

    const profile = assertAllowedProfile(
      options.profile ?? project.defaultProfile,
      project.profiles,
    );
    const jvmArgs = assertAllowedJvmArgs(project.jvmArgs);
    const javaBin = project.javaHome
      ? path.join(project.javaHome, "bin", "java")
      : "java";
    if (project.javaHome && !fs.existsSync(javaBin)) {
      const msg = `java binary not found: ${javaBin}`;
      await this.stateStore.update(project.id, {
        status: "failed",
        lastError: msg,
      });
      throw new AppError("START_FAILED", msg);
    }

    const springArgs: string[] = [];
    if (profile) {
      springArgs.push(`--spring.profiles.active=${profile}`);
    }
    const args = [...jvmArgs, "-jar", jarResolved, ...springArgs];

    await ensureLogDir(project.id);
    const stdoutPath = logFilePath(project.id, "stdout");
    const stderrPath = logFilePath(project.id, "stderr");
    fs.writeFileSync(stdoutPath, "", "utf8");
    fs.writeFileSync(stderrPath, "", "utf8");
    const stdout = createLogWriteStream(project.id, "stdout");
    const stderr = createLogWriteStream(project.id, "stderr");

    const env = { ...process.env };
    if (project.javaHome) {
      env.JAVA_HOME = project.javaHome;
      env.PATH = `${path.join(project.javaHome, "bin")}${path.delimiter}${env.PATH ?? ""}`;
    }

    let child: ChildProcess;
    try {
      child = spawn(javaBin, args, {
        cwd: project.resolvedPath,
        env,
        shell: false,
        detached: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (err) {
      const msg = `spawn failed: ${(err as Error).message}`;
      await this.stateStore.update(project.id, {
        status: "failed",
        lastError: msg,
      });
      throw new AppError("START_FAILED", msg);
    }

    const pid = child.pid;
    if (!pid) {
      await this.stateStore.update(project.id, {
        status: "failed",
        lastError: "spawn produced no pid",
      });
      throw new AppError("START_FAILED", "spawn produced no pid");
    }

    const pgid = pid;
    const javaCommand = [javaBin, ...args].join(" ");
    child.stdout?.pipe(stdout);
    child.stderr?.pipe(stderr);
    this.live.set(project.id, { child, pid, pgid, jarResolved, javaCommand });
    child.on("exit", (code) => {
      void this.onChildExit(project.id, code);
    });
    child.on("error", (err) => {
      void this.stateStore.update(project.id, {
        status: "failed",
        lastError: err.message,
      });
    });

    const prev = await this.stateStore.get(project.id);
    const state = await this.stateStore.update(project.id, {
      status: "running",
      pid,
      pgid,
      startedAt: new Date().toISOString(),
      jarResolved,
      javaCommand,
      profile: profile ?? null,
      exitCode: null,
      lastError: null,
      readiness: project.healthCheckUrl ? "unverified" : "not_configured",
      logPaths: {
        stdout: stdoutPath,
        stderr: stderrPath,
        ...(buildLogPath
          ? { build: buildLogPath }
          : prev.logPaths?.build
            ? { build: prev.logPaths.build }
            : {}),
      },
    });

    if (project.healthCheckUrl) {
      void (async () => {
        await sleep(1500);
        const readiness = await checkLoopbackHealth(project.healthCheckUrl!);
        await this.stateStore.update(project.id, { readiness });
      })();
    }

    return {
      state,
      buildSkipped: decision.skip,
      buildSkipReason: decision.reason,
    };
  }

  private async stopCore(
    project: ProjectConfig & { resolvedPath: string },
    timeoutSeconds?: number,
  ): Promise<ProjectRuntimeState> {
    const current = await this.stateStore.get(project.id);
    const live = this.live.get(project.id);
    const pgid = live?.pgid ?? current.pgid ?? null;
    const pid = live?.pid ?? current.pid ?? null;

    if (!pgid && !pid) {
      if (current.status === "stopped") {
        return current;
      }
      throw new AppError("NOT_RUNNING", `project not running: ${project.id}`);
    }

    if (current.status === "unknown") {
      throw new AppError(
        "NOT_RUNNING",
        "project status is unknown; refusing to kill (verify manually)",
      );
    }

    const jar = current.jarResolved ?? live?.jarResolved ?? "";
    if (pid && !cmdlineMatchesManagedJava(pid, jar)) {
      await this.stateStore.update(project.id, {
        status: "unknown",
        lastError: "PID argv mismatch; refusing stop",
      });
      throw new AppError(
        "NOT_RUNNING",
        "PID no longer matches managed java -jar process; refusing stop",
      );
    }

    const timeout = timeoutSeconds ?? project.stopTimeoutSeconds ?? 15;

    await this.stateStore.update(project.id, {
      status: "stopping",
      lastError: null,
    });

    try {
      process.kill(-pgid!, "SIGTERM");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ESRCH") {
        throw new AppError(
          "START_FAILED",
          `SIGTERM failed: ${(err as Error).message}`,
        );
      }
    }

    const exited = await waitForExit(pid!, timeout * 1000);
    if (!exited) {
      try {
        process.kill(-pgid!, "SIGKILL");
      } catch {
        // ignore
      }
      const killed = await waitForExit(pid!, 3000);
      if (!killed) {
        await this.stateStore.update(project.id, {
          status: "failed",
          lastError: `STOP_TIMEOUT after ${timeout}s (SIGKILL also did not clear)`,
        });
        throw new AppError(
          "STOP_TIMEOUT",
          `process group did not exit after ${timeout}s`,
        );
      }
    }

    this.live.delete(project.id);
    return this.stateStore.update(project.id, {
      status: "stopped",
      pid: null,
      pgid: null,
      exitCode: 0,
      lastError: null,
      readiness: "not_configured",
    });
  }

  private async onChildExit(
    projectId: string,
    code: number | null,
  ): Promise<void> {
    this.live.delete(projectId);
    const current = await this.stateStore.get(projectId);
    if (current.status === "stopping" || current.status === "stopped") {
      await this.stateStore.update(projectId, {
        status: "stopped",
        pid: null,
        pgid: null,
        exitCode: code,
      });
      return;
    }
    await this.stateStore.update(projectId, {
      status: "failed",
      pid: null,
      pgid: null,
      exitCode: code,
      lastError: `process exited unexpectedly with code ${code}`,
    });
  }
}

export function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function readCmdline(pid: number): string | null {
  try {
    const out = execFileSync("ps", ["-p", String(pid), "-o", "command="], {
      encoding: "utf8",
    }).trim();
    return out || null;
  } catch {
    return null;
  }
}

export function cmdlineMatchesManagedJava(
  pid: number,
  jarResolved: string,
): boolean {
  const cmd = readCmdline(pid);
  if (!cmd) return false;
  if (!cmd.includes("java")) return false;
  if (!cmd.includes("-jar")) return false;
  if (
    jarResolved &&
    !cmd.includes(path.basename(jarResolved)) &&
    !cmd.includes(jarResolved)
  ) {
    return false;
  }
  return true;
}

function waitForExit(pid: number, timeoutMs: number): Promise<boolean> {
  const start = Date.now();
  return new Promise((resolve) => {
    const tick = () => {
      if (!isPidAlive(pid)) {
        resolve(true);
        return;
      }
      if (Date.now() - start >= timeoutMs) {
        resolve(false);
        return;
      }
      setTimeout(tick, 100);
    };
    tick();
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
