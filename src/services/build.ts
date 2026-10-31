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
  const mvnw = path.join(projectRoot, "mvnw");
  try {
    fs.accessSync(mvnw, fs.constants.X_OK);
    return { command: mvnw, argsPrefix: [], kind: "mvnw" };
  } catch {
    // fall through
  }
  // Non-executable but present: still try via /bin/sh? No — plan says spawn shell:false.
  // Prefer invoking via absolute path only if executable; else system mvn.
  return { command: "mvn", argsPrefix: [], kind: "mvn" };
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
