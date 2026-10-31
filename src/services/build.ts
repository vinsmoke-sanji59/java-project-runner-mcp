import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { AppError } from "../errors.js";
import {
  assertAllowedGoal,
  assertAllowedProfile,
} from "../security/command-policy.js";
import type { ProjectConfig } from "../types/project.js";
import { createLogWriteStream, ensureLogDir, logFilePath } from "./logs.js";
import { resolveMavenWrapperPath } from "./process-platform.js";

export interface BuildOptions {
  goal?: string;
  skipTests?: boolean;
  profile?: string;
}

export interface BuildResult {
  success: boolean;
  exitCode: number;
  durationMs: number;
  command: string[];
  logPath: string;
  message: string;
}

export function resolveMavenExecutable(projectRoot: string): {
  command: string;
  argsPrefix: string[];
  kind: "mvnw" | "mvn";
} {
  const wrapper = resolveMavenWrapperPath(projectRoot);
  if (wrapper) {
    return { command: wrapper, argsPrefix: [], kind: "mvnw" };
  }
  return { command: "mvn", argsPrefix: [], kind: "mvn" };
}

/** Extract `Apache Maven x.y.z` from `mvn -v` / `mvnw -v` stdout. */
export function parseMavenVersionOutput(stdout: string): string | null {
  const m = stdout.match(/Apache Maven\s+(\S+)/i);
  return m ? `Apache Maven ${m[1]}` : null;
}

/**
 * Probe Maven version via `<command> -v` (shell: false).
 * Used by inspect when falling back to system mvn (drift warning).
 */
export async function probeMavenVersion(
  command: string,
  opts: { cwd?: string; env?: NodeJS.ProcessEnv; timeoutMs?: number } = {},
): Promise<{ version: string | null; output: string; error: string | null }> {
  const timeoutMs = opts.timeoutMs ?? 8_000;
  const env = opts.env ?? process.env;

  return new Promise((resolve) => {
    let settled = false;
    const child = spawn(command, ["-v"], {
      cwd: opts.cwd,
      env,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let out = "";
    const onChunk = (chunk: Buffer) => {
      out += chunk.toString("utf8");
    };
    child.stdout?.on("data", onChunk);
    child.stderr?.on("data", onChunk);

    const finish = (error: string | null) => {
      if (settled) return;
      settled = true;
      resolve({
        version: parseMavenVersionOutput(out),
        output: out.trim(),
        error,
      });
    };

    const timer = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
        // ignore
      }
      finish(`timed out after ${timeoutMs}ms`);
    }, timeoutMs);

    child.on("error", (err) => {
      clearTimeout(timer);
      finish(err.message);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0 && !parseMavenVersionOutput(out)) {
        finish(`exitCode=${code ?? 1}`);
        return;
      }
      finish(null);
    });
  });
}

export async function runMavenBuild(
  project: ProjectConfig & { resolvedPath: string },
  options: BuildOptions = {},
): Promise<BuildResult> {
  const goal = assertAllowedGoal(
    options.goal ?? project.buildGoal ?? "package",
  );
  const skipTests =
    options.skipTests !== undefined
      ? options.skipTests
      : project.skipTests !== false; // default true
  const profile = assertAllowedProfile(
    options.profile ?? project.defaultProfile,
    project.profiles,
  );

  const maven = resolveMavenExecutable(project.resolvedPath);
  const args: string[] = [...maven.argsPrefix, "-B", ...goal.split(/\s+/)];
  if (skipTests) {
    args.push("-DskipTests");
  }
  if (profile) {
    args.push(`-P${profile}`);
  }

  await ensureLogDir(project.id);
  const logPath = logFilePath(project.id, "build");
  // Truncate previous build log for this run.
  fs.writeFileSync(logPath, "", "utf8");
  const out = createLogWriteStream(project.id, "build");

  const env = { ...process.env };
  if (project.javaHome) {
    env.JAVA_HOME = project.javaHome;
    env.PATH = `${path.join(project.javaHome, "bin")}${path.delimiter}${env.PATH ?? ""}`;
  }

  const started = Date.now();
  const exitCode = await new Promise<number>((resolve, reject) => {
    const child = spawn(maven.command, args, {
      cwd: project.resolvedPath,
      env,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });

    child.stdout?.on("data", (chunk: Buffer) => out.write(chunk));
    child.stderr?.on("data", (chunk: Buffer) => out.write(chunk));
    child.on("error", (err) => {
      out.write(`\n[spawn error] ${err.message}\n`);
      out.end();
      reject(
        new AppError(
          "BUILD_FAILED",
          `failed to spawn ${maven.command}: ${err.message}`,
        ),
      );
    });
    child.on("close", (code) => {
      out.end();
      resolve(code ?? 1);
    });
  });

  const durationMs = Date.now() - started;
  const command = [maven.command, ...args];
  if (exitCode !== 0) {
    return {
      success: false,
      exitCode,
      durationMs,
      command,
      logPath,
      message: `build failed with exitCode=${exitCode}`,
    };
  }
  return {
    success: true,
    exitCode: 0,
    durationMs,
    command,
    logPath,
    message: `build succeeded in ${durationMs}ms`,
  };
}
