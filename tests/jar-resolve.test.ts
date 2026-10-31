import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AppError } from "../src/errors.js";
import { resolveJarPath } from "../src/services/jar-resolve.js";

const tmpDirs: string[] = [];

function makeRoot(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jpr-jar-"));
  tmpDirs.push(dir);
  fs.mkdirSync(path.join(dir, "target"));
  return dir;
}

afterEach(() => {
  for (const d of tmpDirs.splice(0)) {
    fs.rmSync(d, { recursive: true, force: true });
  }
});

describe("resolveJarPath", () => {
  it("resolves literal jar", () => {
    const root = makeRoot();
    const jar = path.join(root, "target", "app-1.0.jar");
    fs.writeFileSync(jar, "jar");
    expect(resolveJarPath(root, "target/app-1.0.jar")).toBe(fs.realpathSync(jar));
  });

  it("glob picks unique non-sources jar", () => {
    const root = makeRoot();
    const jar = path.join(root, "target", "app-1.0.jar");
    fs.writeFileSync(jar, "jar");
    fs.writeFileSync(path.join(root, "target", "app-1.0-sources.jar"), "src");
    expect(resolveJarPath(root, "target/*.jar")).toBe(fs.realpathSync(jar));
  });

  it("fails on multiple matches", () => {
    const root = makeRoot();
    fs.writeFileSync(path.join(root, "target", "a.jar"), "a");
    fs.writeFileSync(path.join(root, "target", "b.jar"), "b");
    expect(() => resolveJarPath(root, "target/*.jar")).toThrow(AppError);
  });

  it("fails when missing", () => {
    const root = makeRoot();
    expect(() => resolveJarPath(root, "target/missing.jar")).toThrow(AppError);
  });
});
