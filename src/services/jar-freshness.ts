import fs from "node:fs";
import path from "node:path";
import { AppError } from "../errors.js";

const SOURCE_EXTS = new Set([
  ".java",
  ".xml",
  ".yml",
  ".yaml",
  ".properties",
]);

export type BuildSkipReason = "jar_fresh" | "skipBuild_flag";

export interface BuildDecision {
  skip: boolean;
  reason: BuildSkipReason | null;
}

export interface DecideBuildOptions {
  rebuild?: boolean;
  skipBuild?: boolean;
  projectRoot: string;
  /** Absolute path to resolved JAR, or null if not resolvable yet. */
  jarPath: string | null;
}

function walkSourceMtimes(dir: string, acc: number[]): void {
  if (!fs.existsSync(dir)) return;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const ent of entries) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      walkSourceMtimes(full, acc);
      continue;
    }
    if (!ent.isFile()) continue;
    const ext = path.extname(ent.name);
    if (!SOURCE_EXTS.has(ext)) continue;
    try {
      acc.push(fs.statSync(full).mtimeMs);
    } catch {
      // ignore
    }
  }
}

/** Newest mtime among root pom.xml and files under src/ with source extensions. */
export function newestSourceMtimeMs(projectRoot: string): number {
  const times: number[] = [];
  const pom = path.join(projectRoot, "pom.xml");
  if (fs.existsSync(pom)) {
    try {
      times.push(fs.statSync(pom).mtimeMs);
    } catch {
      // ignore
    }
  }
  walkSourceMtimes(path.join(projectRoot, "src"), times);
  if (times.length === 0) return 0;
  return Math.max(...times);
}

export function isJarFresh(jarPath: string, projectRoot: string): boolean {
  if (!fs.existsSync(jarPath)) return false;
  let jarMtime: number;
  try {
    jarMtime = fs.statSync(jarPath).mtimeMs;
  } catch {
    return false;
  }
  const sourceMtime = newestSourceMtimeMs(projectRoot);
  return jarMtime >= sourceMtime;
}

export function decideBuild(opts: DecideBuildOptions): BuildDecision {
  if (opts.rebuild && opts.skipBuild) {
    throw new AppError(
      "INVALID_ARGS",
      "rebuild and skipBuild cannot both be true",
    );
  }
  if (opts.skipBuild) {
    return { skip: true, reason: "skipBuild_flag" };
  }
  if (opts.rebuild) {
    return { skip: false, reason: null };
  }
  if (opts.jarPath && isJarFresh(opts.jarPath, opts.projectRoot)) {
    return { skip: true, reason: "jar_fresh" };
  }
  return { skip: false, reason: null };
}
