import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AppError } from "../src/errors.js";
import {
  assertPathInsideRoot,
  assertProjectRoot,
  isLoopbackUrl,
} from "../src/security/path-policy.js";

const tmpDirs: string[] = [];

function makeTempProject(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jpr-path-"));
  tmpDirs.push(dir);
  fs.writeFileSync(path.join(dir, "pom.xml"), "<project/>");
  fs.mkdirSync(path.join(dir, "target"));
  return dir;
}

afterEach(() => {
  for (const d of tmpDirs.splice(0)) {
    fs.rmSync(d, { recursive: true, force: true });
  }
});

describe("assertPathInsideRoot", () => {
  it("allows relative path under root", () => {
    const root = makeTempProject();
    const abs = assertPathInsideRoot("target/app.jar", root, "jarPath");
    expect(abs).toBe(path.join(fs.realpathSync(root), "target", "app.jar"));
  });

  it("rejects .. escape", () => {
    const root = makeTempProject();
    expect(() => assertPathInsideRoot("../secret.jar", root)).toThrow(AppError);
    try {
      assertPathInsideRoot("../secret.jar", root);
    } catch (e) {
      expect((e as AppError).code).toBe("PATH_DENIED");
    }
  });

  it("rejects symlink escape when link exists", () => {
    const root = makeTempProject();
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "jpr-out-"));
    tmpDirs.push(outside);
    const link = path.join(root, "escape");
    try {
      fs.symlinkSync(outside, link);
    } catch {
      // Some CI sandboxes disallow symlinks — skip.
      return;
    }
    expect(() => assertPathInsideRoot("escape/file.jar", root)).toThrow(
      AppError,
    );
  });
});

describe("assertProjectRoot", () => {
  it("requires pom.xml", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jpr-nopom-"));
    tmpDirs.push(dir);
    expect(() => assertProjectRoot(dir)).toThrow(AppError);
  });

  it("returns realpath when pom exists", () => {
    const root = makeTempProject();
    expect(assertProjectRoot(root)).toBe(fs.realpathSync(root));
  });
});

describe("isLoopbackUrl", () => {
  it("accepts localhost and 127.0.0.1", () => {
    expect(isLoopbackUrl("http://127.0.0.1:8080/actuator/health")).toBe(true);
    expect(isLoopbackUrl("http://localhost:8080/health")).toBe(true);
  });

  it("rejects non-loopback", () => {
    expect(isLoopbackUrl("http://example.com/health")).toBe(false);
    expect(isLoopbackUrl("http://192.168.1.1/health")).toBe(false);
  });
});
