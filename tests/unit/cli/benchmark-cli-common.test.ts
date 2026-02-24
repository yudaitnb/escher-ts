import { describe, expect, it } from "vitest";
import { parseSuite, selectBenchmarks } from "../../../src/cli/benchmark-cli-common.js";

describe("benchmark CLI common", () => {
  it("parses suite names including dllist/pure/points", () => {
    expect(parseSuite("dllist")).toBe("dllist");
    expect(parseSuite("classes")).toBe("dllist");
    expect(parseSuite("pure")).toBe("pure");
    expect(parseSuite("points")).toBe("points");
    expect(parseSuite(undefined)).toBe("standard");
    expect(() => parseSuite("unknown")).toThrow(/Unknown suite/);
  });

  it("selects dllist benchmarks by default for dllist suite", () => {
    const selected = selectBenchmarks("dllist", undefined);
    expect(selected.length).toBeGreaterThan(0);
    expect(selected.every((b) => b.category === "classes")).toBe(true);
  });

  it("selects pure suite benchmarks from suite file by default", () => {
    const selected = selectBenchmarks("pure", undefined);
    expect(selected.length).toBeGreaterThan(0);
    expect(selected.map((b) => b.name)).toContain("reverse");
    expect(selected.map((b) => b.name)).toContain("nodesAtLevel");
  });

  it("selects point benchmarks by default for points suite", () => {
    const selected = selectBenchmarks("points", undefined);
    expect(selected.length).toBeGreaterThan(0);
    expect(selected.map((b) => b.name)).toContain("getXValue");
    expect(selected.map((b) => b.name)).toContain("getYValue");
  });

  it("filters by benchmark names", () => {
    const selected = selectBenchmarks("dllist", "isNullNode,thisRef");
    expect(selected.map((b) => b.name)).toEqual(["isNullNode", "thisRef"]);
  });
});
