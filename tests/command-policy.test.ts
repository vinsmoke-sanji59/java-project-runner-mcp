import { describe, expect, it } from "vitest";
import { AppError } from "../src/errors.js";
import {
  assertAllowedGoal,
  assertAllowedJvmArgs,
  assertAllowedProfile,
} from "../src/security/command-policy.js";

describe("assertAllowedGoal", () => {
  it("allows package and clean package", () => {
    expect(assertAllowedGoal("package")).toBe("package");
    expect(assertAllowedGoal("clean package")).toBe("clean package");
  });

  it("rejects arbitrary goals", () => {
    expect(() => assertAllowedGoal("dependency:purge-local-repository")).toThrow(
      AppError,
    );
  });
});

describe("assertAllowedProfile", () => {
  it("requires registry allow-list", () => {
    expect(assertAllowedProfile("local", ["local", "dev"])).toBe("local");
    expect(() => assertAllowedProfile("prod", ["local"])).toThrow(AppError);
  });
});

describe("assertAllowedJvmArgs", () => {
  it("allows common safe args", () => {
    expect(
      assertAllowedJvmArgs(["-Xmx512m", "-Dserver.port=8081", "-XX:+UseG1GC"]),
    ).toHaveLength(3);
  });

  it("rejects agents and classpath", () => {
    expect(() => assertAllowedJvmArgs(["-javaagent:/tmp/x.jar"])).toThrow(
      AppError,
    );
    expect(() => assertAllowedJvmArgs(["-cp", "evil.jar"])).toThrow(AppError);
    expect(() => assertAllowedJvmArgs(["@args"])).toThrow(AppError);
  });
});
