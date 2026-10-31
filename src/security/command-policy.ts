import { AppError } from "../errors.js";

const LIFECYCLE_PHASES = new Set([
  "validate",
  "compile",
  "test",
  "package",
  "verify",
  "install",
  "clean",
]);

/** Allowed single Maven goals/phases (and space-separated lifecycle sequences). */
export function assertAllowedGoal(goal: string): string {
  const trimmed = goal.trim();
  if (!trimmed) {
    throw new AppError("INVALID_ARGS", "goal is empty");
  }
  if (trimmed.length > 64) {
    throw new AppError("INVALID_ARGS", "goal too long");
  }
  const parts = trimmed.split(/\s+/);
  for (const part of parts) {
    if (!LIFECYCLE_PHASES.has(part)) {
      throw new AppError(
        "INVALID_ARGS",
        `goal not allowed: ${part} (allowed: ${[...LIFECYCLE_PHASES].join(", ")})`,
      );
    }
  }
  return parts.join(" ");
}

export function assertAllowedProfile(
  profile: string | undefined,
  allowed: string[] | undefined,
): string | undefined {
  if (profile === undefined || profile === "") return undefined;
  if (!/^[A-Za-z0-9._-]+$/.test(profile)) {
    throw new AppError("INVALID_ARGS", `invalid profile name: ${profile}`);
  }
  const list = allowed ?? [];
  if (!list.includes(profile)) {
    throw new AppError(
      "INVALID_ARGS",
      `profile "${profile}" is not listed in registry profiles`,
    );
  }
  return profile;
}

const FORBIDDEN_JVM_EXACT = new Set([
  "-jar",
  "-cp",
  "-classpath",
  "-javaagent",
  "-agentlib",
  "-agentpath",
]);

/**
 * Whitelist JVM args: -Xmx/-Xms/-Xss, selected -XX:, safe -D keys, a few flags.
 */
export function assertAllowedJvmArgs(args: string[] | undefined): string[] {
  if (!args || args.length === 0) return [];
  if (args.length > 32) {
    throw new AppError("INVALID_ARGS", "too many jvmArgs");
  }
  const out: string[] = [];
  for (const raw of args) {
    if (typeof raw !== "string" || !raw.trim()) {
      throw new AppError("INVALID_ARGS", "empty jvmArg");
    }
    const arg = raw.trim();
    if (arg.length > 512) {
      throw new AppError("INVALID_ARGS", "jvmArg too long");
    }
    if (/\s/.test(arg)) {
      throw new AppError("INVALID_ARGS", `jvmArg must not contain whitespace: ${arg}`);
    }
    if (FORBIDDEN_JVM_EXACT.has(arg) || arg.startsWith("-javaagent") || arg.startsWith("-agent")) {
      throw new AppError("INVALID_ARGS", `jvmArg forbidden: ${arg}`);
    }
    if (arg.startsWith("@")) {
      throw new AppError("INVALID_ARGS", "jvm argfiles (@) are not allowed");
    }

    const ok =
      /^-Xmx[0-9]+[kKmMgG]?$/.test(arg) ||
      /^-Xms[0-9]+[kKmMgG]?$/.test(arg) ||
      /^-Xss[0-9]+[kKmMgG]?$/.test(arg) ||
      arg === "-server" ||
      arg === "-client" ||
      arg === "-ea" ||
      arg === "-enableassertions" ||
      arg === "-da" ||
      arg === "-disableassertions" ||
      (/^-XX:[+A-Za-z0-9_=:.-]+$/.test(arg) && !arg.includes("..")) ||
      (/^-D[A-Za-z0-9_.-]+=/.test(arg) && !arg.includes(".."));

    if (!ok) {
      throw new AppError("INVALID_ARGS", `jvmArg not allowed: ${arg}`);
    }
    out.push(arg);
  }
  return out;
}
