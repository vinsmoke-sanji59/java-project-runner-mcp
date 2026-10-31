import fs from "node:fs";
import fsPromises from "node:fs/promises";
import path from "node:path";
import lockfile from "proper-lockfile";
import { AppError } from "../errors.js";
import { registryPath } from "../paths.js";
import { assertProjectRoot, isLoopbackUrl } from "../security/path-policy.js";
import {
  assertAllowedGoal,
  assertAllowedJvmArgs,
  assertAllowedProfile,
} from "../security/command-policy.js";
import {
  ProjectConfigSchema,
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
    this.assertRegistryInvariants(parsed.data);
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

  async register(config: ProjectConfig): Promise<ProjectConfig> {
    const parsed = ProjectConfigSchema.safeParse(config);
    if (!parsed.success) {
      throw new AppError(
        "INVALID_ARGS",
        `invalid project config: ${parsed.error.message}`,
      );
    }
    this.validateProjectEntry(parsed.data);
    return this.withFileLock(async (read, write) => {
      const reg = read();
      if (reg.projects.some((p) => p.id === parsed.data.id)) {
        throw new AppError(
          "INVALID_ARGS",
          `duplicate project id: ${parsed.data.id}`,
        );
      }
      const next: Registry = {
        projects: [...reg.projects, parsed.data],
      };
      this.assertRegistryInvariants(next);
      write(next);
      return parsed.data;
    });
  }

  async update(
    projectId: string,
    patch: Partial<Omit<ProjectConfig, "id">>,
  ): Promise<ProjectConfig> {
    if ("id" in (patch as Record<string, unknown>)) {
      throw new AppError("INVALID_ARGS", "project id cannot be changed");
    }
    return this.withFileLock(async (read, write) => {
      const reg = read();
      const idx = reg.projects.findIndex((p) => p.id === projectId);
      if (idx < 0) {
        throw new AppError("NOT_FOUND", `project not found: ${projectId}`);
      }
      const merged = { ...reg.projects[idx]!, ...patch, id: projectId };
      const parsed = ProjectConfigSchema.safeParse(merged);
      if (!parsed.success) {
        throw new AppError(
          "INVALID_ARGS",
          `invalid project config after update: ${parsed.error.message}`,
        );
      }
      this.validateProjectEntry(parsed.data);
      const projects = [...reg.projects];
      projects[idx] = parsed.data;
      const next: Registry = { projects };
      this.assertRegistryInvariants(next);
      write(next);
      return parsed.data;
    });
  }

  async unregister(projectId: string): Promise<void> {
    return this.withFileLock(async (read, write) => {
      const reg = read();
      if (!reg.projects.some((p) => p.id === projectId)) {
        throw new AppError("NOT_FOUND", `project not found: ${projectId}`);
      }
      write({
        projects: reg.projects.filter((p) => p.id !== projectId),
      });
    });
  }

  private validateProjectEntry(project: ProjectConfig): void {
    const root = assertProjectRoot(project.path);
    const pom = path.join(root, "pom.xml");
    if (!fs.existsSync(pom)) {
      throw new AppError(
        "INVALID_ARGS",
        `project path must contain pom.xml: ${root}`,
      );
    }
    if (project.healthCheckUrl && !isLoopbackUrl(project.healthCheckUrl)) {
      throw new AppError(
        "INVALID_ARGS",
        `healthCheckUrl must be loopback for ${project.id}`,
      );
    }
    if (project.defaultProfile) {
      assertAllowedProfile(
        project.defaultProfile,
        project.profiles ?? [project.defaultProfile],
      );
    }
    if (project.buildGoal) assertAllowedGoal(project.buildGoal);
    assertAllowedJvmArgs(project.jvmArgs);
  }

  private assertRegistryInvariants(reg: Registry): void {
    const ids = new Set<string>();
    for (const p of reg.projects) {
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
  }

  private async withFileLock<T>(
    fn: (
      read: () => Registry,
      write: (reg: Registry) => void,
    ) => Promise<T>,
  ): Promise<T> {
    await fsPromises.mkdir(path.dirname(this.filePath), { recursive: true });
    if (!fs.existsSync(this.filePath)) {
      await fsPromises.writeFile(
        this.filePath,
        JSON.stringify({ projects: [] }, null, 2),
        "utf8",
      );
    }
    const release = await lockfile.lock(this.filePath, {
      retries: {
        retries: 20,
        factor: 1.2,
        minTimeout: 25,
        maxTimeout: 500,
      },
      stale: 30_000,
    });
    try {
      const read = (): Registry => {
        const text = fs.readFileSync(this.filePath, "utf8");
        let raw: unknown;
        try {
          raw = JSON.parse(text);
        } catch {
          return { projects: [] };
        }
        const parsed = RegistrySchema.safeParse(raw);
        if (!parsed.success) {
          throw new AppError(
            "INVALID_ARGS",
            `invalid registry schema: ${parsed.error.message}`,
          );
        }
        return parsed.data;
      };
      const write = (reg: Registry): void => {
        const tmp = `${this.filePath}.${process.pid}.tmp`;
        fs.writeFileSync(tmp, JSON.stringify(reg, null, 2), "utf8");
        fs.renameSync(tmp, this.filePath);
      };
      return await fn(read, write);
    } finally {
      await release();
    }
  }
}
