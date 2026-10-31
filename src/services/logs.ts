import fs from "node:fs";
import fsPromises from "node:fs/promises";
import path from "node:path";
import { logsDir } from "../paths.js";

export type LogStream = "stdout" | "stderr" | "build";

export async function ensureLogDir(projectId: string): Promise<string> {
  const dir = logsDir(projectId);
  await fsPromises.mkdir(dir, { recursive: true });
  return dir;
}

export function logFilePath(projectId: string, stream: LogStream): string {
  return path.join(logsDir(projectId), `${stream}.log`);
}

export async function appendLog(
  projectId: string,
  stream: LogStream,
  chunk: string | Buffer,
): Promise<void> {
  await ensureLogDir(projectId);
  await fsPromises.appendFile(logFilePath(projectId, stream), chunk);
}

/** Tail last N lines (capped). */
export function tailLogFile(
  filePath: string,
  tailLines: number,
): { lines: string[]; truncated: boolean; exists: boolean } {
  const limit = Math.min(Math.max(1, tailLines), 200);
  if (!fs.existsSync(filePath)) {
    return { lines: [], truncated: false, exists: false };
  }
  const text = fs.readFileSync(filePath, "utf8");
  const all = text.split(/\r?\n/);
  // Drop trailing empty line from final newline.
  if (all.length > 0 && all[all.length - 1] === "") {
    all.pop();
  }
  const truncated = all.length > limit;
  const lines = truncated ? all.slice(-limit) : all;
  return { lines, truncated, exists: true };
}

export function createLogWriteStream(projectId: string, stream: LogStream) {
  const file = logFilePath(projectId, stream);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  return fs.createWriteStream(file, { flags: "a" });
}
