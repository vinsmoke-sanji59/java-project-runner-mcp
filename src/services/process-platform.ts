import { execFile, execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import type { SpawnOptions } from "node:child_process";

const execFileAsync = promisify(execFile);

export function isWin32(platform = process.platform): boolean {
  return platform === "win32";
}

/** Maven Wrapper script names to try, in preference order. */
export function mavenWrapperFilenames(platform = process.platform): string[] {
  if (isWin32(platform)) {
    return ["mvnw.cmd", "mvnw.bat", "mvnw"];
  }
  return ["mvnw"];
}

export function stopSignalStrategy(
  platform = process.platform,
): "process-group" | "taskkill-tree" {
  return isWin32(platform) ? "taskkill-tree" : "process-group";
}

export function resolveMavenWrapperPath(projectRoot: string): string | null {
  for (const name of mavenWrapperFilenames()) {
    const candidate = path.join(projectRoot, name);
    try {
      fs.accessSync(candidate, fs.constants.F_OK);
      if (!isWin32()) {
        fs.accessSync(candidate, fs.constants.X_OK);
      }
      return candidate;
    } catch {
      // try next
    }
  }
  return null;
}

export function javaSpawnOptions(): SpawnOptions {
  if (isWin32()) {
    return {
      detached: true,
      windowsHide: true,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    };
  }
  return {
    detached: true,
    shell: false,
    stdio: ["ignore", "pipe", "pipe"],
  };
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
  if (isWin32()) {
    try {
      const out = execFileSync(
        "powershell.exe",
        [
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          `(Get-CimInstance Win32_Process -Filter "ProcessId=${pid}").CommandLine`,
        ],
        { encoding: "utf8", windowsHide: true, timeout: 5_000 },
      ).trim();
      return out || null;
    } catch {
      return null;
    }
  }
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
  const lower = cmd.toLowerCase();
  if (!lower.includes("java")) return false;
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

/**
 * Signal the managed process tree.
 * - POSIX: kill(-pid) process group (start used detached pgid≈pid)
 * - Windows: taskkill /T tree rooted at pid
 */
export async function signalManagedTree(
  pid: number,
  mode: "term" | "kill",
): Promise<void> {
  if (stopSignalStrategy() === "taskkill-tree") {
    const args =
      mode === "kill"
        ? ["/PID", String(pid), "/T", "/F"]
        : ["/PID", String(pid), "/T"];
    try {
      await execFileAsync("taskkill", args, {
        windowsHide: true,
      });
    } catch (err) {
      const msg = (err as Error).message ?? "";
      // 128 / not found — process already gone
      if (/not found|no running|exit code 1[28]/i.test(msg)) {
        return;
      }
      const code = (err as { code?: number | string }).code;
      if (code === 128 || code === "128") return;
      throw err;
    }
    return;
  }

  const sig = mode === "kill" ? "SIGKILL" : "SIGTERM";
  try {
    process.kill(-pid, sig);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ESRCH") return;
    throw err;
  }
}
