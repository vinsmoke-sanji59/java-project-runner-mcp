import fs from "node:fs";
import path from "node:path";
import { AppError } from "../errors.js";

/**
 * Resolve a candidate path and ensure it stays inside allowedRoot (realpath).
 * Rejects `..` escape and symlink escape outside the root.
 */
export function assertPathInsideRoot(
  candidatePath: string,
  allowedRoot: string,
  label = "path",
): string {
  if (!candidatePath || typeof candidatePath !== "string") {
    throw new AppError("PATH_DENIED", `${label} is empty`);
  }
  if (candidatePath.includes("\0")) {
    throw new AppError("PATH_DENIED", `${label} contains NUL`);
  }

  const rootReal = fs.realpathSync(path.resolve(allowedRoot));
  const absCandidate = path.resolve(rootReal, candidatePath);

  // Soft check before existence (for files that may not exist yet).
  const relative = path.relative(rootReal, absCandidate);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new AppError(
      "PATH_DENIED",
      `${label} escapes allowed root: ${candidatePath}`,
    );
  }

  // If the path (or a parent) exists, re-check via realpath to catch symlink escapes.
  let probe = absCandidate;
  while (!fs.existsSync(probe)) {
    const parent = path.dirname(probe);
    if (parent === probe) break;
    probe = parent;
  }
  if (fs.existsSync(probe)) {
    const probeReal = fs.realpathSync(probe);
    const rel2 = path.relative(rootReal, probeReal);
    if (rel2.startsWith("..") || path.isAbsolute(rel2)) {
      throw new AppError(
        "PATH_DENIED",
        `${label} escapes allowed root via symlink: ${candidatePath}`,
      );
    }
  }

  return absCandidate;
}

export function assertProjectRoot(projectPath: string): string {
  if (!projectPath || typeof projectPath !== "string") {
    throw new AppError("PATH_DENIED", "project path is empty");
  }
  if (projectPath.includes("\0") || projectPath.includes("..")) {
    // Allow absolute paths that contain ".." as a segment after normalize only via realpath.
  }

  let real: string;
  try {
    real = fs.realpathSync(path.resolve(projectPath));
  } catch {
    throw new AppError("PATH_DENIED", `project path not found: ${projectPath}`);
  }

  const pom = path.join(real, "pom.xml");
  if (!fs.existsSync(pom)) {
    throw new AppError("PATH_DENIED", `pom.xml missing under ${real}`);
  }
  return real;
}

export function isLoopbackUrl(urlString: string): boolean {
  try {
    const u = new URL(urlString);
    const host = u.hostname.toLowerCase();
    return host === "127.0.0.1" || host === "localhost" || host === "::1";
  } catch {
    return false;
  }
}
