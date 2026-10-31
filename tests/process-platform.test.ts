import { describe, expect, it } from "vitest";
import {
  mavenWrapperFilenames,
  stopSignalStrategy,
} from "../src/services/process-platform.js";

describe("process-platform", () => {
  it("uses mvnw.cmd first on win32", () => {
    expect(mavenWrapperFilenames("win32")[0]).toBe("mvnw.cmd");
    expect(mavenWrapperFilenames("darwin")).toEqual(["mvnw"]);
    expect(mavenWrapperFilenames("linux")).toEqual(["mvnw"]);
  });

  it("uses taskkill tree strategy on win32", () => {
    expect(stopSignalStrategy("win32")).toBe("taskkill-tree");
    expect(stopSignalStrategy("darwin")).toBe("process-group");
    expect(stopSignalStrategy("linux")).toBe("process-group");
  });
});
