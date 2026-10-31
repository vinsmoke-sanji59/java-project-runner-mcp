#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registryPath, runnerHome } from "./paths.js";
import { ProcessManager } from "./services/process-manager.js";
import { RegistryService } from "./services/registry.js";
import { StateStore } from "./services/state-store.js";
import { registerTools } from "./tools/register.js";

async function main(): Promise<void> {
  const registry = new RegistryService();
  const stateStore = new StateStore();
  await stateStore.ensureReady();
  const processes = new ProcessManager(stateStore);
  await processes.recover();

  const server = new McpServer({
    name: "java-project-runner",
    version: "1.0.0",
  });

  registerTools(server, { registry, stateStore, processes });

  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Never log to stdout (stdio transport). Use stderr for diagnostics.
  console.error(
    `[java-project-runner] ready home=${runnerHome()} registry=${registryPath()}`,
  );
  console.error(
    "[java-project-runner] Do NOT run multiple servers against the same registry concurrently.",
  );
}

main().catch((err) => {
  console.error("[java-project-runner] fatal:", err);
  process.exit(1);
});
