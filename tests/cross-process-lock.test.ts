import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import lockfile from "proper-lockfile";
import { afterEach, describe, expect, it } from "vitest";
import { AppError } from "../src/errors.js";
import { projectLockPath } from "../src/paths.js";
import { projectMutex } from "../src/services/state-store.js";

describe("cross-process project lock", () => {
  const prevHome = process.env.JAVA_PROJECT_RUNNER_HOME;
  let tmp = "";

  afterEach(async () => {
    if (prevHome === undefined) {
      delete process.env.JAVA_PROJECT_RUNNER_HOME;
    } else {
      process.env.JAVA_PROJECT_RUNNER_HOME = prevHome;
    }
    if (tmp) {
      fs.rmSync(tmp, { recursive: true, force: true });
      tmp = "";
    }
  });

  it("returns BUSY when another holder has the file lock", async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "jpr-xlock-"));
    process.env.JAVA_PROJECT_RUNNER_HOME = tmp;

    const lockPath = projectLockPath("sharecharge-web");
    fs.mkdirSync(path.dirname(lockPath), { recursive: true });
    fs.writeFileSync(lockPath, "", "utf8");
    const release = await lockfile.lock(lockPath, { retries: 0 });

    try {
      await expect(
        projectMutex.runExclusive("sharecharge-web", "start", async () => "nope"),
      ).rejects.toMatchObject({ code: "BUSY" } satisfies Partial<AppError>);
    } finally {
      await release();
    }

    await expect(
      projectMutex.runExclusive("sharecharge-web", "start", async () => "ok"),
    ).resolves.toBe("ok");
  });
});
