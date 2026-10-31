import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { resolveMavenExecutable } from "../services/build.js";
import { jarResolvable } from "../services/jar-resolve.js";
import { logFilePath, tailLogFile } from "../services/logs.js";
import type { ProcessManager } from "../services/process-manager.js";
import type { RegistryService } from "../services/registry.js";
import type { StateStore } from "../services/state-store.js";
import { isLoopbackUrl } from "../security/path-policy.js";
import { errResult, okResult } from "./helpers.js";

export interface AppContext {
  registry: RegistryService;
  stateStore: StateStore;
  processes: ProcessManager;
}

export function registerTools(server: McpServer, ctx: AppContext): void {
  server.registerTool(
    "project_list",
    {
      description:
        "List registered Java/Spring Boot projects from ~/.java-project-runner/projects.json",
      inputSchema: {
        keyword: z
          .string()
          .optional()
          .describe("Optional filter against id/name/path"),
      },
    },
    async ({ keyword }) => {
      try {
        const projects = ctx.registry.list(keyword).map((p) => ({
          id: p.id,
          name: p.name,
          path: p.path,
          enabled: p.enabled,
        }));
        return okResult({
          success: true,
          message: `found ${projects.length} project(s)`,
          projects,
        });
      } catch (err) {
        return errResult(err);
      }
    },
  );

  server.registerTool(
    "project_inspect",
    {
      description:
        "Inspect a registered project: pom/wrapper/javaHome/jarPath resolvability and config summary",
      inputSchema: {
        projectId: z.string().describe("Registry project id"),
      },
    },
    async ({ projectId }) => {
      try {
        const project = ctx.registry.requireEnabled(projectId);
        const maven = resolveMavenExecutable(project.resolvedPath);
        const jar = jarResolvable(project.resolvedPath, project.jarPath);
        const javaHome = project.javaHome ?? process.env.JAVA_HOME ?? null;
        const javaBin = javaHome
          ? path.join(javaHome, "bin", "java")
          : "java (PATH)";
        const healthOk = project.healthCheckUrl
          ? isLoopbackUrl(project.healthCheckUrl)
          : null;
        const state = await ctx.stateStore.get(projectId);

        return okResult({
          success: true,
          projectId,
          status: state.status,
          message: "inspect ok",
          inspect: {
            name: project.name,
            path: project.resolvedPath,
            pomExists: fs.existsSync(path.join(project.resolvedPath, "pom.xml")),
            maven: {
              kind: maven.kind,
              command: maven.command,
              hint:
                maven.kind === "mvn"
                  ? "No executable mvnw; will use system mvn (version may drift)"
                  : "Using project Maven Wrapper",
            },
            javaHome,
            javaBin,
            jarPath: project.jarPath,
            jarResolvable: jar.ok,
            jarResolved: jar.resolved ?? null,
            jarError: jar.error ?? null,
            buildGoal: project.buildGoal ?? "package",
            skipTests: project.skipTests !== false,
            profiles: project.profiles ?? [],
            defaultProfile: project.defaultProfile ?? null,
            jvmArgs: project.jvmArgs ?? [],
            healthCheckUrl: project.healthCheckUrl ?? null,
            healthCheckLoopback: healthOk,
            stopTimeoutSeconds: project.stopTimeoutSeconds ?? 15,
            enabled: project.enabled,
          },
        });
      } catch (err) {
        return errResult(err);
      }
    },
  );

  server.registerTool(
    "project_build",
    {
      description:
        "Run Maven build for a registered project (default goal package, -DskipTests by default)",
      inputSchema: {
        projectId: z.string(),
        goal: z.string().optional().describe("Maven lifecycle goal(s), default package"),
        skipTests: z.boolean().optional(),
        profile: z.string().optional(),
      },
    },
    async ({ projectId, goal, skipTests, profile }) => {
      try {
        const project = ctx.registry.requireEnabled(projectId);
        const result = await ctx.processes.build(project, {
          goal,
          skipTests,
          profile,
        });
        return okResult({
          success: true,
          projectId,
          exitCode: result.exitCode,
          message: result.message,
          logPath: result.logPath,
          durationMs: result.durationMs,
          command: result.command,
        });
      } catch (err) {
        return errResult(err);
      }
    },
  );

  server.registerTool(
    "project_start",
    {
      description:
        "Start the configured JAR (detached process group). Builds with Maven unless the JAR is fresh or skipBuild is set; use rebuild to force package.",
      inputSchema: {
        projectId: z.string(),
        profile: z.string().optional(),
        rebuild: z
          .boolean()
          .optional()
          .describe("Force Maven package before start"),
        skipBuild: z
          .boolean()
          .optional()
          .describe("Skip Maven; require an existing resolvable JAR"),
      },
    },
    async ({ projectId, profile, rebuild, skipBuild }) => {
      try {
        const project = ctx.registry.requireEnabled(projectId);
        const { state, buildSkipped, buildSkipReason } =
          await ctx.processes.start(project, { profile, rebuild, skipBuild });
        return okResult({
          success: true,
          projectId,
          status: state.status,
          message:
            state.readiness === "not_configured"
              ? "started; process alive, readiness not verified"
              : "started; readiness pending health check",
          pid: state.pid,
          pgid: state.pgid,
          jarResolved: state.jarResolved,
          logPaths: state.logPaths,
          buildSkipped,
          buildSkipReason,
        });
      } catch (err) {
        return errResult(err);
      }
    },
  );

  server.registerTool(
    "project_stop",
    {
      description:
        "Stop the managed process group only (SIGTERM then SIGKILL). Never kills by port/main-class.",
      inputSchema: {
        projectId: z.string(),
        timeoutSeconds: z.number().int().positive().optional(),
      },
    },
    async ({ projectId, timeoutSeconds }) => {
      try {
        const project = ctx.registry.requireEnabled(projectId);
        const state = await ctx.processes.stop(project, timeoutSeconds);
        return okResult({
          success: true,
          projectId,
          status: state.status,
          message: "stopped managed process group (SIGTERM→SIGKILL)",
          exitCode: state.exitCode,
        });
      } catch (err) {
        return errResult(err);
      }
    },
  );

  server.registerTool(
    "project_restart",
    {
      description:
        "Stop (if running) then start under one project lock (same build skip / rebuild options as project_start)",
      inputSchema: {
        projectId: z.string(),
        profile: z.string().optional(),
        rebuild: z.boolean().optional(),
        skipBuild: z.boolean().optional(),
      },
    },
    async ({ projectId, profile, rebuild, skipBuild }) => {
      try {
        const project = ctx.registry.requireEnabled(projectId);
        const { state, buildSkipped, buildSkipReason } =
          await ctx.processes.restart(project, {
            profile,
            rebuild,
            skipBuild,
          });
        return okResult({
          success: true,
          projectId,
          status: state.status,
          message: "restarted",
          pid: state.pid,
          pgid: state.pgid,
          buildSkipped,
          buildSkipReason,
        });
      } catch (err) {
        return errResult(err);
      }
    },
  );

  server.registerTool(
    "project_status",
    {
      description: "Query runtime status for one project or all tracked projects",
      inputSchema: {
        projectId: z.string().optional(),
      },
    },
    async ({ projectId }) => {
      try {
        if (projectId) {
          // Ensure project exists in registry (may be disabled — still allow status).
          ctx.registry.get(projectId);
        }
        const result = await ctx.processes.status(projectId);
        return okResult({
          success: true,
          message: "status ok",
          ...result,
        });
      } catch (err) {
        return errResult(err);
      }
    },
  );

  server.registerTool(
    "project_logs",
    {
      description: "Tail project logs (stdout/stderr/both), max 200 lines",
      inputSchema: {
        projectId: z.string(),
        stream: z.enum(["stdout", "stderr", "both"]).optional(),
        tailLines: z.number().int().positive().max(200).optional(),
      },
    },
    async ({ projectId, stream, tailLines }) => {
      try {
        ctx.registry.get(projectId);
        const lines = Math.min(tailLines ?? 100, 200);
        const which = stream ?? "stdout";
        const collect = (s: "stdout" | "stderr") => {
          const file = logFilePath(projectId, s);
          const t = tailLogFile(file, lines);
          return { stream: s, file, ...t };
        };

        if (which === "both") {
          const stdout = collect("stdout");
          const stderr = collect("stderr");
          return okResult({
            success: true,
            projectId,
            message: "logs tail (capped)",
            stdout,
            stderr,
            maxTailLines: 200,
          });
        }
        const one = collect(which);
        return okResult({
          success: true,
          projectId,
          message: "logs tail (capped)",
          ...one,
          maxTailLines: 200,
        });
      } catch (err) {
        return errResult(err);
      }
    },
  );
}
