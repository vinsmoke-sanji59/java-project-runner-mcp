import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AppError } from "../src/errors.js";
import { projectMutex } from "../src/services/state-store.js";

describe("projectMutex", () => {
  const prevHome = process.env.JAVA_PROJECT_RUNNER_HOME;
  let tmp = "";

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "jpr-mutex-"));
    process.env.JAVA_PROJECT_RUNNER_HOME = tmp;
  });

  afterEach(() => {
    if (prevHome === undefined) delete process.env.JAVA_PROJECT_RUNNER_HOME;
    else process.env.JAVA_PROJECT_RUNNER_HOME = prevHome;
    if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("surfaces BUSY on overlapping ops", async () => {
    let releaseInner!: () => void;
    const gate = new Promise<void>((r) => {
      releaseInner = r;
    });

    const first = projectMutex.runExclusive("p1", "start", async () => {
      await gate;
      return "ok";
    });

    await new Promise((r) => setTimeout(r, 20));

    await expect(
      projectMutex.runExclusive("p1", "stop", async () => "nope"),
    ).rejects.toMatchObject({ code: "BUSY" } satisfies Partial<AppError>);

    releaseInner();
    await expect(first).resolves.toBe("ok");
  });
});
