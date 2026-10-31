import { z } from "zod";

/** Safe for use as a single path segment under ~/.java-project-runner/logs/<id>. */
export const ProjectIdSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(
    /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/,
    "project id must be 1–64 chars: start/end alphanumeric; middle may include . _ -",
  )
  .refine((id) => !id.includes(".."), {
    message: "project id must not contain '..'",
  });

export const ProjectConfigSchema = z.object({
  id: ProjectIdSchema,
  name: z.string().min(1),
  path: z.string().min(1),
  jarPath: z.string().min(1),
  javaHome: z.string().min(1).optional(),
  buildGoal: z.string().min(1).optional(),
  skipTests: z.boolean().optional(),
  jvmArgs: z.array(z.string()).optional(),
  profiles: z.array(z.string().min(1)).optional(),
  defaultProfile: z.string().min(1).optional(),
  healthCheckUrl: z.string().url().optional(),
  stopTimeoutSeconds: z.number().int().positive().optional(),
  enabled: z.boolean(),
});

export const RegistrySchema = z.object({
  projects: z.array(ProjectConfigSchema),
});

export type ProjectConfig = z.infer<typeof ProjectConfigSchema>;
export type Registry = z.infer<typeof RegistrySchema>;
