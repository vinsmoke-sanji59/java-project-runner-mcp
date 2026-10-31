import fs from "node:fs";
import { AppError } from "../errors.js";
import { registryPath } from "../paths.js";
import { assertProjectRoot, isLoopbackUrl } from "../security/path-policy.js";
import {
  assertAllowedGoal,
  assertAllowedJvmArgs,
  assertAllowedProfile,
} from "../security/command-policy.js";
import {
  RegistrySchema,
  type ProjectConfig,
  type Registry,
} from "../types/project.js";

export class RegistryService {
  constructor(private readonly filePath = registryPath()) {}

  load(): Registry {
    if (!fs.existsSync(this.filePath)) {
      return { projects: [] };
    }
    let raw: unknown;
    try {
      raw = JSON.parse(fs.readFileSync(this.filePath, "utf8"));
    } catch (err) {
      throw new AppError(
        "INVALID_ARGS",
        `failed to parse registry ${this.filePath}: ${(err as Error).message}`,
      );
    }
    const parsed = RegistrySchema.safeParse(raw);
    if (!parsed.success) {
      throw new AppError(
        "INVALID_ARGS",
        `invalid registry schema: ${parsed.error.message}`,
      );
    }
    const ids = new Set<string>();
    for (const p of parsed.data.projects) {
      if (ids.has(p.id)) {
        throw new AppError("INVALID_ARGS", `duplicate project id: ${p.id}`);
      }
      ids.add(p.id);
      if (p.healthCheckUrl && !isLoopbackUrl(p.healthCheckUrl)) {
        throw new AppError(
          "INVALID_ARGS",
          `healthCheckUrl must be loopback for ${p.id}`,
        );
      }
      if (p.defaultProfile) {
        assertAllowedProfile(p.defaultProfile, p.profiles ?? [p.defaultProfile]);
      }
      if (p.buildGoal) assertAllowedGoal(p.buildGoal);
      assertAllowedJvmArgs(p.jvmArgs);
    }
    return parsed.data;
  }

  list(keyword?: string): ProjectConfig[] {
    const all = this.load().projects;
    if (!keyword) return all;
    const k = keyword.toLowerCase();
    return all.filter(
      (p) =>
        p.id.toLowerCase().includes(k) ||
        p.name.toLowerCase().includes(k) ||
        p.path.toLowerCase().includes(k),
    );
  }

  get(projectId: string): ProjectConfig {
    const project = this.load().projects.find((p) => p.id === projectId);
    if (!project) {
      throw new AppError("NOT_FOUND", `project not found: ${projectId}`);
    }
    return project;
  }

  /** Resolve + validate an enabled project for mutating / inspect ops. */
  requireEnabled(projectId: string): ProjectConfig & { resolvedPath: string } {
    const project = this.get(projectId);
    if (!project.enabled) {
      throw new AppError("DISABLED", `project disabled: ${projectId}`);
    }
    const resolvedPath = assertProjectRoot(project.path);
    return { ...project, resolvedPath };
  }
}
