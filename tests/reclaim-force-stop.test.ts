import { describe, expect, it } from "vitest";
import { AppError } from "../src/errors.js";
import { ProcessManager } from "../src/services/process-manager.js";
import { StateStore } from "../src/services/state-store.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

describe("forceStop confirm gate", () => {
  it("rejects when confirm is false", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jpr-fs-"));
    const store = new StateStore(
      path.join(dir, "state.json"),
      dir,
    );
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
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe("reclaim without pid", () => {
  it("marks unknown when no pid", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jpr-rc-"));
    const store = new StateStore(path.join(dir, "state.json"), dir);
    await store.ensureReady();
    await store.update("demo", { status: "unknown", pid: null });
    const pm = new ProcessManager(store);
    const state = await pm.reclaim("demo", "/tmp/app.jar");
    expect(state.status).toBe("unknown");
    expect(state.lastError).toMatch(/no persisted pid/);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
