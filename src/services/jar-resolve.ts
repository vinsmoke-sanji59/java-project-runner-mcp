import fs from "node:fs";
import path from "node:path";
import { AppError } from "../errors.js";
import { assertPathInsideRoot } from "../security/path-policy.js";

function isExcludedArtifact(name: string): boolean {
  return (
    name.endsWith("-sources.jar") ||
    name.endsWith("-javadoc.jar") ||
    name.endsWith("-tests.jar")
  );
}

/**
 * Resolve jarPath relative to project root.
 * Supports literal relative/absolute-under-root paths, or a single `*` glob segment
 * (e.g. `target/*.jar`). Exactly one non-sources/javadoc match required for globs.
 */
export function resolveJarPath(projectRoot: string, jarPath: string): string {
  const root = path.resolve(projectRoot);
  if (!jarPath || jarPath.includes("\0")) {
    throw new AppError("START_FAILED", "jarPath is invalid");
  }

  if (jarPath.includes("*")) {
    const absPattern = assertPathInsideRoot(jarPath, root, "jarPath");
    const dir = path.dirname(absPattern);
    const filePattern = path.basename(absPattern);
    if (!fs.existsSync(dir)) {
      throw new AppError("START_FAILED", `jar directory missing: ${dir}`);
    }
    if ((filePattern.match(/\*/g) || []).length !== 1 || filePattern.includes("**")) {
      throw new AppError(
        "START_FAILED",
        "jarPath glob supports a single * in the filename only",
      );
    }
    const [prefix, suffix] = filePattern.split("*");
    const matches = fs
      .readdirSync(dir)
      .filter((name) => name.startsWith(prefix) && name.endsWith(suffix))
      .filter((name) => name.endsWith(".jar"))
      .filter((name) => !isExcludedArtifact(name))
      .map((name) => path.join(dir, name));

    if (matches.length === 0) {
      throw new AppError("START_FAILED", `no JAR matched pattern: ${jarPath}`);
    }
    if (matches.length > 1) {
      throw new AppError(
        "START_FAILED",
        `multiple JARs matched pattern ${jarPath}: ${matches.map((m) => path.basename(m)).join(", ")}`,
      );
    }
    return matches[0]!;
  }

  const abs = assertPathInsideRoot(jarPath, root, "jarPath");
  if (!fs.existsSync(abs)) {
    throw new AppError("START_FAILED", `JAR not found: ${abs}`);
  }
  if (!abs.endsWith(".jar")) {
    throw new AppError("START_FAILED", `not a JAR file: ${abs}`);
  }
  if (isExcludedArtifact(path.basename(abs))) {
    throw new AppError("START_FAILED", `refusing sources/javadoc JAR: ${abs}`);
  }
  return abs;
}

export function jarResolvable(
  projectRoot: string,
  jarPath: string,
): { ok: boolean; resolved?: string; error?: string } {
  try {
    const resolved = resolveJarPath(projectRoot, jarPath);
    return { ok: true, resolved };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}
