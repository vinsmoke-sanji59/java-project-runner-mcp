import { z } from "zod";

export const ProjectConfigSchema = z.object({
  id: z.string().min(1),
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
