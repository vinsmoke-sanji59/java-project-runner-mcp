import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AppError } from "../src/errors.js";
import { RegistryService } from "../src/services/registry.js";

const tmpDirs: string[] = [];

afterEach(() => {
  for (const d of tmpDirs.splice(0)) {
    fs.rmSync(d, { recursive: true, force: true });
  }
});

function setup(): { reg: RegistryService; projectDir: string; file: string } {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "jpr-crud-"));
  tmpDirs.push(home);
  const projectDir = path.join(home, "app");
  fs.mkdirSync(path.join(projectDir, "src"), { recursive: true });
  fs.writeFileSync(path.join(projectDir, "pom.xml"), "<project/>");
  const file = path.join(home, "projects.json");
  fs.writeFileSync(file, JSON.stringify({ projects: [] }, null, 2));
  return { reg: new RegistryService(file), projectDir, file };
}

describe("RegistryService CRUD", () => {
  it("registers a valid project", async () => {
    const { reg, projectDir } = setup();
    const p = await reg.register({
      id: "order-service",
      name: "Order",
      path: projectDir,
      jarPath: "target/app.jar",
      enabled: true,
    });
    expect(p.id).toBe("order-service");
    expect(reg.list()).toHaveLength(1);
  });

  it("rejects duplicate id", async () => {
    const { reg, projectDir } = setup();
    await reg.register({
      id: "order-service",
      name: "Order",
      path: projectDir,
      jarPath: "target/app.jar",
      enabled: true,
    });
    await expect(
      reg.register({
        id: "order-service",
        name: "Order2",
        path: projectDir,
        jarPath: "target/app.jar",
        enabled: true,
      }),
    ).rejects.toBeInstanceOf(AppError);
  });

  it("rejects path without pom.xml", async () => {
    const { reg, home } = (() => {
      const s = setup();
      const empty = path.join(path.dirname(s.projectDir), "empty");
      fs.mkdirSync(empty);
      return { reg: s.reg, home: empty };
    })();
    await expect(
      reg.register({
        id: "no-pom",
        name: "NoPom",
        path: home,
        jarPath: "target/app.jar",
        enabled: true,
      }),
    ).rejects.toBeInstanceOf(AppError);
  });

  it("updates fields and refuses id change via patch", async () => {
    const { reg, projectDir } = setup();
    await reg.register({
      id: "order-service",
      name: "Order",
      path: projectDir,
      jarPath: "target/app.jar",
      enabled: true,
    });
    const next = await reg.update("order-service", {
      name: "Order Service",
      skipTests: false,
    });
    expect(next.name).toBe("Order Service");
    expect(next.skipTests).toBe(false);
  });

  it("unregisters an existing project", async () => {
    const { reg, projectDir } = setup();
    await reg.register({
      id: "order-service",
      name: "Order",
      path: projectDir,
      jarPath: "target/app.jar",
      enabled: true,
    });
    await reg.unregister("order-service");
    expect(reg.list()).toHaveLength(0);
  });
});
