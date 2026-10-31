import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AppError } from "../src/errors.js";
import { RegistryService } from "../src/services/registry.js";

const tmpFiles: string[] = [];

afterEach(() => {
  for (const f of tmpFiles.splice(0)) {
    fs.rmSync(f, { force: true });
    try {
      fs.rmSync(path.dirname(f), { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
});

describe("RegistryService", () => {
  it("returns empty when file missing", () => {
    const file = path.join(os.tmpdir(), `jpr-reg-${Date.now()}.json`);
    tmpFiles.push(file);
    const reg = new RegistryService(file);
    expect(reg.list()).toEqual([]);
  });

  it("loads valid projects and filters keyword", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jpr-reg-"));
    const file = path.join(dir, "projects.json");
    tmpFiles.push(file);
    fs.writeFileSync(
      file,
      JSON.stringify({
        projects: [
          {
            id: "order-service",
            name: "Order Service",
            path: "/tmp/order",
            jarPath: "target/app.jar",
            enabled: true,
          },
          {
            id: "pay-service",
            name: "Pay",
            path: "/tmp/pay",
            jarPath: "target/app.jar",
            enabled: false,
          },
        ],
      }),
    );
    const reg = new RegistryService(file);
    expect(reg.list("order")).toHaveLength(1);
    expect(reg.get("pay-service").enabled).toBe(false);
  });

  it("rejects non-loopback healthCheckUrl", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jpr-reg-"));
    const file = path.join(dir, "projects.json");
    tmpFiles.push(file);
    fs.writeFileSync(
      file,
      JSON.stringify({
        projects: [
          {
            id: "x",
            name: "X",
            path: "/tmp/x",
            jarPath: "target/app.jar",
            healthCheckUrl: "http://evil.example/health",
            enabled: true,
          },
        ],
      }),
    );
    const reg = new RegistryService(file);
    expect(() => reg.load()).toThrow(AppError);
  });
});
