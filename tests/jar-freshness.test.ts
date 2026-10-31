import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AppError } from "../src/errors.js";
import {
  decideBuild,
  isJarFresh,
  newestSourceMtimeMs,
} from "../src/services/jar-freshness.js";

const tmpDirs: string[] = [];

afterEach(() => {
  for (const d of tmpDirs.splice(0)) {
    fs.rmSync(d, { recursive: true, force: true });
  }
});

function tmpProject(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jpr-fresh-"));
  tmpDirs.push(dir);
  return dir;
}

function touch(file: string, mtimeMs: number): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, "x");
  const t = new Date(mtimeMs);
  fs.utimesSync(file, t, t);
}

describe("decideBuild", () => {
  it("rejects rebuild and skipBuild both true", () => {
    expect(() =>
      decideBuild({
        rebuild: true,
        skipBuild: true,
        projectRoot: "/tmp",
        jarPath: null,
      }),
    ).toThrow(AppError);
  });

  it("skipBuild forces skip even without jar", () => {
    const d = decideBuild({
      skipBuild: true,
      projectRoot: "/tmp",
      jarPath: null,
    });
    expect(d).toEqual({ skip: true, reason: "skipBuild_flag" });
  });

  it("rebuild forces build", () => {
    const root = tmpProject();
    const jar = path.join(root, "app.jar");
    touch(path.join(root, "pom.xml"), 1_000);
    touch(jar, 9_000);
    const d = decideBuild({
      rebuild: true,
      projectRoot: root,
      jarPath: jar,
    });
    expect(d).toEqual({ skip: false, reason: null });
  });

  it("auto skips when jar is fresher than sources", () => {
    const root = tmpProject();
    const jar = path.join(root, "app.jar");
    touch(path.join(root, "pom.xml"), 1_000);
    touch(path.join(root, "src/main/java/A.java"), 2_000);
    touch(jar, 3_000);
    const d = decideBuild({
      projectRoot: root,
      jarPath: jar,
    });
    expect(d).toEqual({ skip: true, reason: "jar_fresh" });
  });

  it("auto builds when source is newer than jar", () => {
    const root = tmpProject();
    const jar = path.join(root, "app.jar");
    touch(jar, 1_000);
    touch(path.join(root, "pom.xml"), 2_000);
    const d = decideBuild({
      projectRoot: root,
      jarPath: jar,
    });
    expect(d).toEqual({ skip: false, reason: null });
  });

  it("auto builds when jar missing", () => {
    const root = tmpProject();
    touch(path.join(root, "pom.xml"), 1_000);
    const d = decideBuild({
      projectRoot: root,
      jarPath: path.join(root, "missing.jar"),
    });
    expect(d).toEqual({ skip: false, reason: null });
  });
});

describe("isJarFresh / newestSourceMtimeMs", () => {
  it("tracks nested src files", () => {
    const root = tmpProject();
    touch(path.join(root, "pom.xml"), 1_000);
    touch(path.join(root, "src/main/resources/a.yml"), 5_000);
    expect(newestSourceMtimeMs(root)).toBe(5_000);
    const jar = path.join(root, "app.jar");
    touch(jar, 6_000);
    expect(isJarFresh(jar, root)).toBe(true);
    touch(path.join(root, "src/main/java/B.java"), 7_000);
    expect(isJarFresh(jar, root)).toBe(false);
  });
});
