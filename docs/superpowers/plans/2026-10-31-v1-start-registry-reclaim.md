# v1.1 Smart Start, Registry CRUD, Reclaim Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship v1.1: smart JAR freshness skip on start, registry CRUD tools, and reclaim / fingerprint-gated force_stop.

**Architecture:** Add pure `jar-freshness` helper; extend `ProcessManager.startCore` with build policy; add locked write APIs on `RegistryService`; add `reclaim` / `forceStop` on `ProcessManager`; wire new MCP tools in `register.ts`; bump to 1.1.0 and update README.

**Tech Stack:** TypeScript, Vitest, `@modelcontextprotocol/sdk`, `proper-lockfile`, Zod, Node 20+.

## Global Constraints

- macOS v1 process-group semantics unchanged.
- No blind kill; force_stop requires `confirm: true` and cmdline fingerprint match.
- No new `AppError` codes; use `INVALID_ARGS` / `BUSY` / existing codes.
- `package.json` version → `1.1.0`.
- Spec: `docs/superpowers/specs/2026-10-31-v1-start-registry-reclaim-design.md`.

## File map

| File | Responsibility |
|------|----------------|
| `src/services/jar-freshness.ts` | Decide skip vs build from flags + mtimes |
| `src/services/process-manager.ts` | start policy, recover, reclaim, forceStop |
| `src/services/registry.ts` | register / update / unregister with file lock |
| `src/tools/register.ts` | MCP tool wiring + response fields |
| `src/types/results.ts` / start return shape | `buildSkipped` / `buildSkipReason` via tool layer |
| `tests/jar-freshness.test.ts` | Freshness unit tests |
| `tests/registry-crud.test.ts` | CRUD unit tests |
| `tests/reclaim-force-stop.test.ts` | Reclaim / force_stop unit tests |
| `README.md` / `package.json` | Docs + version |

---

### Task 1: Jar freshness helper

**Files:**
- Create: `src/services/jar-freshness.ts`
- Test: `tests/jar-freshness.test.ts`

**Produces:**
- `export type BuildSkipReason = "jar_fresh" | "skipBuild_flag"`
- `export type BuildDecision = { skip: boolean; reason: BuildSkipReason | null }`
- `export function decideBuild(opts: { rebuild?: boolean; skipBuild?: boolean; projectRoot: string; jarResolved: string | null; jarExists: boolean; nowMtimeMs?: never }): BuildDecision` — throws `AppError INVALID_ARGS` if both flags true
- `export function newestSourceMtimeMs(projectRoot: string): number` — max mtime of pom.xml + src/** matching extensions; `0` if none
- `export function isJarFresh(jarPath: string, projectRoot: string): boolean`

- [ ] **Step 1: Write failing tests** in `tests/jar-freshness.test.ts` covering: conflict flags; missing jar → not skip (auto); jar newer than sources → skip `jar_fresh`; source newer → build; `skipBuild` → skip with reason; `rebuild` → never skip.

- [ ] **Step 2: Run** `PATH=.../node/v20.../bin:$PATH npm test -- tests/jar-freshness.test.ts` — expect FAIL.

- [ ] **Step 3: Implement** `src/services/jar-freshness.ts` with recursive walk of `src` for `.java|.xml|.yml|.yaml|.properties` and root `pom.xml`.

- [ ] **Step 4: Tests pass.** Commit.

---

### Task 2: Wire smart skip into start/restart

**Files:**
- Modify: `src/services/process-manager.ts`
- Modify: `src/tools/register.ts`
- Test: extend freshness tests or add `tests/start-build-policy.test.ts` if pure decision already covered — prefer asserting `startCore` options type and a small exported `resolveStartBuildDecision` wrapper if needed.

**Produces:**
- `start` / `restart` options: `{ profile?: string; rebuild?: boolean; skipBuild?: boolean }`
- Start tool returns `buildSkipped` + `buildSkipReason`
- Before Maven: resolve jar if possible; `decideBuild`; if skip and no jar → `START_FAILED`; if not skip → `runMavenBuild`

- [ ] **Step 1–4:** TDD any missing edge; implement; commit.

---

### Task 3: Registry CRUD with file lock

**Files:**
- Modify: `src/services/registry.ts`
- Test: `tests/registry-crud.test.ts`
- Modify: `src/tools/register.ts`

**Produces:**
- `register(config: ProjectConfig): ProjectConfig`
- `update(projectId: string, patch: Partial<Omit<ProjectConfig, "id">>): ProjectConfig`
- `unregister(projectId: string): void` — caller checks runtime; registry method only removes if present
- Validate pom.xml exists under path via `assertProjectRoot` + `fs.existsSync(pom)`
- File lock via `proper-lockfile` on registry path

- [ ] Tools: `project_register`, `project_update`, `project_unregister` (unregister checks state via ProcessManager/stateStore → `BUSY` if active/unknown)
- [ ] Tests + commit.

---

### Task 4: Reclaim + force_stop

**Files:**
- Modify: `src/services/process-manager.ts` (`recover`, add `reclaim`, `forceStop`)
- Modify: `src/tools/register.ts`
- Test: `tests/reclaim-force-stop.test.ts` (mock/spy pid helpers where feasible; test confirm gate and unknown stop refusal messages)

**Produces:**
- `recover()` keeps pid/pgid when fingerprint matches
- `reclaim(projectId, jarHint?: string): ProjectRuntimeState`
- `forceStop(project, { confirm: true, timeoutSeconds? })`
- Tools `project_reclaim`, `project_force_stop`

- [ ] Tests + commit.

---

### Task 5: Docs + version bump

**Files:**
- Modify: `README.md`, `package.json` (`1.1.0`)

- [ ] Document tools/params; commit; run full `npm test` + `npm run build`.

---

## Spec coverage checklist

- Smart skip + flags + response fields → Tasks 1–2  
- Registry CRUD + pom check + unregister busy → Task 3  
- recover / reclaim / force_stop → Task 4  
- README + 1.1.0 → Task 5  
