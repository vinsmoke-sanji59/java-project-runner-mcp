import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import lockfile from "proper-lockfile";
import { AppError } from "../errors.js";
import { stateDir, stateFilePath } from "../paths.js";
import {
  StateFileSchema,
  emptyRuntimeState,
  type ProjectRuntimeState,
  type StateFile,
} from "../types/state.js";

/** In-process per-project mutex to surface BUSY on overlapping ops. */
class ProjectMutex {
  private readonly held = new Map<string, string>();

  tryAcquire(projectId: string, op: string): void {
    const current = this.held.get(projectId);
    if (current) {
      throw new AppError(
        "BUSY",
        `project ${projectId} is busy with operation: ${current}`,
      );
    }
    this.held.set(projectId, op);
  }

  release(projectId: string): void {
    this.held.delete(projectId);
  }

  async runExclusive<T>(
    projectId: string,
    op: string,
    fn: () => Promise<T>,
  ): Promise<T> {
    this.tryAcquire(projectId, op);
    try {
      return await fn();
    } finally {
      this.release(projectId);
    }
  }
}

export const projectMutex = new ProjectMutex();

export class StateStore {
  constructor(
    private readonly filePath = stateFilePath(),
    private readonly dir = stateDir(),
  ) {}

  async ensureReady(): Promise<void> {
    await fs.mkdir(this.dir, { recursive: true });
    if (!fsSync.existsSync(this.filePath)) {
      await fs.writeFile(
        this.filePath,
        JSON.stringify({ projects: {} }, null, 2),
        "utf8",
      );
    }
  }

  private async readUnlocked(): Promise<StateFile> {
    await this.ensureReady();
    const text = await fs.readFile(this.filePath, "utf8");
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      return { projects: {} };
    }
    const parsed = StateFileSchema.safeParse(raw);
    if (!parsed.success) {
      return { projects: {} };
    }
    return parsed.data;
  }

  private async writeUnlocked(state: StateFile): Promise<void> {
    await this.ensureReady();
    const tmp = `${this.filePath}.${process.pid}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(state, null, 2), "utf8");
    await fs.rename(tmp, this.filePath);
  }

  async withFileLock<T>(fn: (api: {
    read: () => Promise<StateFile>;
    write: (s: StateFile) => Promise<void>;
  }) => Promise<T>): Promise<T> {
    await this.ensureReady();
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
      return await fn({
        read: () => this.readUnlocked(),
        write: (s) => this.writeUnlocked(s),
      });
    } finally {
      await release();
    }
  }

  async get(projectId: string): Promise<ProjectRuntimeState> {
    const state = await this.readUnlocked();
    return state.projects[projectId] ?? emptyRuntimeState();
  }

  async getAll(): Promise<Record<string, ProjectRuntimeState>> {
    return (await this.readUnlocked()).projects;
  }

  async update(
    projectId: string,
    patch: Partial<ProjectRuntimeState>,
  ): Promise<ProjectRuntimeState> {
    return this.withFileLock(async ({ read, write }) => {
      const state = await read();
      const prev = state.projects[projectId] ?? emptyRuntimeState();
      const next: ProjectRuntimeState = {
        ...prev,
        ...patch,
        updatedAt: new Date().toISOString(),
      };
      state.projects[projectId] = next;
      await write(state);
      return next;
    });
  }

  async set(
    projectId: string,
    next: ProjectRuntimeState,
  ): Promise<ProjectRuntimeState> {
    return this.withFileLock(async ({ read, write }) => {
      const state = await read();
      const value = { ...next, updatedAt: new Date().toISOString() };
      state.projects[projectId] = value;
      await write(state);
      return value;
    });
  }

  backupPath(): string {
    return path.join(this.dir, "projects-state.json");
  }
}
