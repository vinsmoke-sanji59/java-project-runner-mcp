import { z } from "zod";

export const ProjectStatusSchema = z.enum([
  "stopped",
  "starting",
  "running",
  "stopping",
  "failed",
  "unknown",
]);

export type ProjectStatus = z.infer<typeof ProjectStatusSchema>;

export const ProjectRuntimeStateSchema = z.object({
  status: ProjectStatusSchema,
  pid: z.number().int().positive().nullable().optional(),
  pgid: z.number().int().nullable().optional(),
  startedAt: z.string().nullable().optional(),
  exitCode: z.number().int().nullable().optional(),
  jarResolved: z.string().nullable().optional(),
  javaCommand: z.string().nullable().optional(),
  profile: z.string().nullable().optional(),
  logPaths: z
    .object({
      stdout: z.string().optional(),
      stderr: z.string().optional(),
      build: z.string().optional(),
    })
    .optional(),
  lastError: z.string().nullable().optional(),
  readiness: z
    .enum(["unverified", "healthy", "unhealthy", "not_configured"])
    .optional(),
  updatedAt: z.string().optional(),
});

export type ProjectRuntimeState = z.infer<typeof ProjectRuntimeStateSchema>;

export const StateFileSchema = z.object({
  projects: z.record(z.string(), ProjectRuntimeStateSchema).default({}),
});

export type StateFile = z.infer<typeof StateFileSchema>;

export function emptyRuntimeState(
  overrides: Partial<ProjectRuntimeState> = {},
): ProjectRuntimeState {
  return {
    status: "stopped",
    pid: null,
    pgid: null,
    startedAt: null,
    exitCode: null,
    jarResolved: null,
    javaCommand: null,
    profile: null,
    logPaths: {},
    lastError: null,
    readiness: "not_configured",
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}
