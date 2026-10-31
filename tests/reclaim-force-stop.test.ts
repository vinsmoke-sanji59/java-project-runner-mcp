import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AppError } from "../src/errors.js";
import { ProcessManager } from "../src/services/process-manager.js";
import { StateStore } from "../src/services/state-store.js";

const prevHome = process.env.JAVA_PROJECT_RUNNER_HOME;
const tmpHomes: string[] = [];

afterEach(() => {
  if (prevHome === undefined) delete process.env.JAVA_PROJECT_RUNNER_HOME;
  else process.env.JAVA_PROJECT_RUNNER_HOME = prevHome;
  for (const d of tmpHomes.splice(0)) {
    fs.rmSync(d, { recursive: true, force: true });
  }
});

function withTempRunnerHome(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jpr-rcfs-"));
  tmpHomes.push(dir);
  process.env.JAVA_PROJECT_RUNNER_HOME = dir;
  return dir;
}

describe("forceStop confirm gate", () => {
  it("rejects when confirm is false", async () => {
    const dir = withTempRunnerHome();
    const store = new StateStore(path.join(dir, "state.json"), dir);
    await store.ensureReady();
    const pm = new ProcessManager(store);
    await expect(
      pm.forceStop(
        {
          id: "x",
          name: "X",
          path: dir,
          jarPath: "a.jar",
          enabled: true,
          resolvedPath: dir,
        },
        { confirm: false },
      ),
    ).rejects.toMatchObject({ code: "INVALID_ARGS" } satisfies Partial<AppError>);
  });
});

describe("reclaim without pid", () => {
  it("marks unknown when no pid", async () => {
    const dir = withTempRunnerHome();
    const store = new StateStore(path.join(dir, "state.json"), dir);
    await store.ensureReady();
    await store.update("demo", { status: "unknown", pid: null });
    const pm = new ProcessManager(store);
    const state = await pm.reclaim("demo", "/tmp/app.jar");
    expect(state.status).toBe("unknown");
    expect(state.lastError).toMatch(/no persisted pid/);
  });
});
