import { describe, expect, it } from "vitest";
import { parseMavenVersionOutput } from "../src/services/build.js";

describe("parseMavenVersionOutput", () => {
  it("extracts Apache Maven version line", () => {
    const out = [
      "Apache Maven 3.9.6 (bc0240f3c744dd6b6ec2920b3cd08dcc295161ae)",
      "Maven home: /usr/local/Cellar/maven/3.9.6/libexec",
      "Java version: 1.8.0_392",
    ].join("\n");
    expect(parseMavenVersionOutput(out)).toBe("Apache Maven 3.9.6");
  });

  it("returns null when output has no maven banner", () => {
    expect(parseMavenVersionOutput("command not found")).toBeNull();
  });
});
