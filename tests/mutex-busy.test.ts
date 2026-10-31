import { describe, expect, it } from "vitest";
import { AppError } from "../src/errors.js";
import { projectMutex } from "../src/services/state-store.js";

describe("projectMutex", () => {
  it("surfaces BUSY on overlapping ops", async () => {
    let releaseInner!: () => void;
    const gate = new Promise<void>((r) => {
      releaseInner = r;
    });

    const first = projectMutex.runExclusive("p1", "start", async () => {
      await gate;
      return "ok";
    });

    // Give first a tick to acquire.
    await new Promise((r) => setTimeout(r, 10));

    await expect(
      projectMutex.runExclusive("p1", "stop", async () => "nope"),
    ).rejects.toMatchObject({ code: "BUSY" } satisfies Partial<AppError>);

    releaseInner();
    await expect(first).resolves.toBe("ok");
  });
});
