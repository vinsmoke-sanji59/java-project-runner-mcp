# Java Project Runner MCP (v1.3)

Single-process MCP server (stdio) that builds and manages **registered** Spring Boot + Maven projects on **macOS, Linux, and Windows**: list / inspect / build / start / stop / restart / status / logs / registry CRUD / reclaim.

**Locked behavior**

- Start runs the configured JAR via `java -jar` — not `spring-boot:run`
- Before start: Maven `package` (default) **unless** the JAR is fresher than `pom.xml` + `src/**` sources, or `skipBuild` is set; use `rebuild: true` to force package
- Prefer `./mvnw` when executable; otherwise system `mvn`
- `-DskipTests` default **on** (configurable per call / registry)
- Stop targets the **managed process tree only** (POSIX process group, or Windows `taskkill /T`) — never by port / main-class
- Maven Wrapper: `./mvnw` on Unix, `mvnw.cmd` / `mvnw.bat` on Windows; else system `mvn`
- Registry: hand-edit `~/.java-project-runner/projects.json` **or** use `project_register` / `project_update` / `project_unregister`
- **Same home** by default: multiple MCP clients (e.g. Cursor + Claude Code) may share `~/.java-project-runner`; mutating ops use per-project file locks (`locks/<id>.lock`) and return `BUSY` if contended
- Optional `JAVA_PROJECT_RUNNER_HOME` (absolute path) overrides the data root if you need an isolated home

## Requirements

- Node.js **20+** (LTS)
- macOS, Linux, or Windows
- JDK + Maven (or project Maven Wrapper) for the projects you register

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

Create or edit `~/.java-project-runner/projects.json` by hand, or use the register/update tools:

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
- `path` must exist and contain `pom.xml` (enforced on register/update).
- `jarPath` may be a concrete relative path or a single-glob filename such as `target/*.jar` (exactly one non-`sources`/`javadoc` match).
- `healthCheckUrl` must be loopback (`127.0.0.1` / `localhost` / `::1`).
- State / logs / locks live under `~/.java-project-runner/state/`, `logs/<id>/`, and `locks/<id>.lock` (or under `JAVA_PROJECT_RUNNER_HOME` if set).

## MCP tools

| Tool | Purpose |
|------|---------|
| `project_list` | List registered projects |
| `project_inspect` | pom / wrapper / jar resolvability / config |
| `project_register` | Add a project to the registry |
| `project_update` | Patch an existing project (id immutable) |
| `project_unregister` | Remove a project (refuses if running/unknown) |
| `project_build` | Maven build |
| `project_start` | Smart package → `java -jar` (`rebuild` / `skipBuild` optional) |
| `project_stop` | SIGTERM → wait → SIGKILL on managed pgid |
| `project_force_stop` | Fingerprint-gated stop; requires `confirm: true`; allowed for `unknown` |
| `project_reclaim` | Re-verify PID fingerprint after MCP restart |
| `project_restart` | stop then start under one lock |
| `project_status` | One or all runtime states |
| `project_logs` | Tail stdout/stderr (max 200 lines) |

### Start build flags

| Flag | Effect |
|------|--------|
| _(none)_ | Skip Maven if resolved JAR mtime ≥ newest of `pom.xml` and `src/**` (`.java`/`.xml`/`.yml`/`.yaml`/`.properties`); else `package` |
| `rebuild: true` | Always Maven before start |
| `skipBuild: true` | Never Maven; JAR must already resolve |
| both true | `INVALID_ARGS` |

Response includes `buildSkipped` and `buildSkipReason` (`jar_fresh` | `skipBuild_flag` | `null`).

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
- After MCP server restart, unverified PIDs become `unknown` (pid retained for reclaim/force_stop) — the server will **not** blind-kill them.
- `project_force_stop` requires `confirm: true` and a matching `java -jar` cmdline fingerprint.
- Multiple MCP clients may share the same home; overlapping ops on one project return `BUSY` instead of corrupting state.

## License

MIT
