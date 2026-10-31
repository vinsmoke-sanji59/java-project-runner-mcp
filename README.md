# Java Project Runner MCP (v1)

Single-process MCP server (stdio) that builds and manages **registered** Spring Boot + Maven projects on macOS: list / inspect / build / start / stop / restart / status / logs.

**Locked v1 behavior**

- Start = Maven `package` (default) then run the configured JAR — not `spring-boot:run`
- Prefer `./mvnw` when executable; otherwise system `mvn`
- `-DskipTests` default **on** (configurable per call / registry)
- Stop signals the **managed process group only** (never by port / main-class)
- Registry is **hand-edited** only: `~/.java-project-runner/projects.json`
- Do **not** run multiple servers against the same registry concurrently

## Requirements

- Node.js **20+** (LTS)
- macOS (v1)
- JDK + Maven (or project `mvnw`) for the projects you register

## Install

```bash
git clone https://github.com/vinsmoke-sanji59/java-project-runner-mcp.git
cd java-project-runner-mcp
nvm use 20   # if you use nvm
npm install
npm run build
npm test
```

Dev (TypeScript directly):

```bash
npm run dev
```

Production entry after build:

```bash
node dist/index.js
```

## Registry

Create `~/.java-project-runner/projects.json` by hand:

```json
{
  "projects": [
    {
      "id": "order-service",
      "name": "Order Service",
      "path": "/Users/you/ws/order-service",
      "jarPath": "target/order-service-0.0.1-SNAPSHOT.jar",
      "javaHome": "/Library/Java/JavaVirtualMachines/temurin-21.jdk/Contents/Home",
      "skipTests": true,
      "defaultProfile": "local",
      "profiles": ["local", "dev"],
      "jvmArgs": ["-Xmx512m"],
      "healthCheckUrl": "http://127.0.0.1:8080/actuator/health",
      "stopTimeoutSeconds": 15,
      "enabled": true
    }
  ]
}
```

Notes:

- `id` must be a single safe path segment: 1–64 chars, start/end alphanumeric; middle may include `.` `_` `-`; no `..` or path separators.
- `jarPath` may be a concrete relative path or a single-glob filename such as `target/*.jar` (exactly one non-`sources`/`javadoc` match).
- `healthCheckUrl` must be loopback (`127.0.0.1` / `localhost` / `::1`).
- State + logs live under `~/.java-project-runner/state/` and `~/.java-project-runner/logs/<id>/`.

## MCP tools

| Tool | Purpose |
|------|---------|
| `project_list` | List registered projects |
| `project_inspect` | pom / wrapper / jar resolvability / config |
| `project_build` | Maven build |
| `project_start` | package → `java -jar` (detached pgid) |
| `project_stop` | SIGTERM → wait → SIGKILL on managed pgid |
| `project_restart` | stop then start under one lock |
| `project_status` | One or all runtime states |
| `project_logs` | Tail stdout/stderr (max 200 lines) |

## Cursor stdio config

Add to Cursor MCP settings (path may be `~/.cursor/mcp.json` or the IDE MCP UI). Replace the paths with your Node binary and clone location:

```json
{
  "mcpServers": {
    "java-project-runner": {
      "command": "/absolute/path/to/node",
      "args": [
        "/absolute/path/to/java-project-runner-mcp/dist/index.js"
      ]
    }
  }
}
```

Use an absolute Node 20+ binary. After `npm run build`, point `args` at `dist/index.js`.

## Claude Code stdio config

In Claude Code MCP settings / `.mcp.json`:

```json
{
  "mcpServers": {
    "java-project-runner": {
      "command": "/absolute/path/to/node",
      "args": [
        "/absolute/path/to/java-project-runner-mcp/dist/index.js"
      ]
    }
  }
}
```

Or with `npx tsx` for local iteration (Node 20+ on PATH):

```json
{
  "mcpServers": {
    "java-project-runner": {
      "command": "npx",
      "args": [
        "tsx",
        "/absolute/path/to/java-project-runner-mcp/src/index.ts"
      ],
      "cwd": "/absolute/path/to/java-project-runner-mcp"
    }
  }
}
```

## Safety

- Only `enabled` registry projects can be built/started/stopped.
- Paths are realpath-checked against the project root.
- `spawn(..., { shell: false })` only; goals / profiles / `jvmArgs` are whitelisted.
- After MCP server restart, unverified PIDs become `unknown` — the server will **not** blind-kill them.
- Do not run more than one MCP server process against the same `~/.java-project-runner` home at once (e.g. Cursor and Claude Code concurrently).

## License

MIT
