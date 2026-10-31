import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { AppError } from "../src/errors.js";
import { assertSafeProjectId, logsDir } from "../src/paths.js";
import { ProjectIdSchema } from "../src/types/project.js";

describe("ProjectIdSchema", () => {
  it("accepts normal ids", () => {
    for (const id of ["web", "sharecharge-web", "order_service", "a.b", "A1"]) {
      expect(ProjectIdSchema.parse(id)).toBe(id);
    }
  });

  it("rejects traversal and unsafe ids", () => {
    for (const id of [
      "../secret",
      "..",
      "foo/bar",
      "foo\\bar",
      ".hidden",
      "trailing.",
      "",
      "a".repeat(65),
    ]) {
      expect(ProjectIdSchema.safeParse(id).success).toBe(false);
    }
  });
});

describe("logsDir", () => {
  it("keeps logs under runner home", () => {
    const home = path.join(os.tmpdir(), "jpr-home-safe");
    const dir = logsDir("sharecharge-web", home);
    expect(dir).toBe(path.join(home, ".java-project-runner", "logs", "sharecharge-web"));
  });

  it("throws on unsafe projectId", () => {
    expect(() => assertSafeProjectId("../../.ssh")).toThrow(AppError);
    expect(() => logsDir("../../.ssh")).toThrow(AppError);
  });
});
