import { describe, expect, it } from "vitest";
import {
  classBenchmarks,
  reverseBenchmark,
  runAscendRecBenchmarks,
  runTypedEscherBenchmarks,
  stutterBenchmark,
} from "../../../src/index.js";

describe("benchmark harness", () => {
  it("runs selected benchmarks and returns summary", () => {
    const report = runTypedEscherBenchmarks({
      benchmarks: [reverseBenchmark, stutterBenchmark],
      synthConfig: {
        maxCost: 11,
        searchSizeFactor: 3,
        maxReboots: 3,
        goalSearchStrategy: "then-first",
        deleteAllErr: true,
        timeoutMs: 5000,
      },
    });

    expect(report.total).toBe(2);
    expect(report.failed).toBe(0);
    expect(report.succeeded).toBe(2);
    expect(report.cases.every((c) => c.success)).toBe(true);
  });

  it("applies global synth config uniformly", () => {
    const report = runTypedEscherBenchmarks({
      benchmarks: [reverseBenchmark],
      synthConfig: {
        maxCost: 11,
        searchSizeFactor: 2,
        maxReboots: 1,
        goalSearchStrategy: "then-first",
        deleteAllErr: true,
        timeoutMs: 5000,
      },
    });

    expect(report.total).toBe(1);
    expect(report.succeeded).toBe(1);
    expect(report.cases[0]?.config.maxCost).toBe(11);
    expect(report.cases[0]?.config.timeoutMs).toBe(5000);
  });

  it("runs the same benchmark cases with ascendrec engine", () => {
    const benchmarks = [reverseBenchmark, stutterBenchmark].map((benchmark) => ({
      ...benchmark,
      ascendRecEnv: benchmark.env,
    }));
    const report = runAscendRecBenchmarks({
      benchmarks,
      synthConfig: {
        maxCost: 11,
        searchSizeFactor: 3,
        maxReboots: 10,
        goalSearchStrategy: "then-first",
        deleteAllErr: true,
        timeoutMs: 5000,
        onlyForwardSearch: false,
      },
    });

    expect(report.total).toBe(2);
    expect(report.failed).toBe(0);
    expect(report.succeeded).toBe(2);
    expect(report.cases.every((c) => c.success)).toBe(true);
    expect(report.engine).toBe("ascendrec");
  });

  it("runs class benchmark cases with typed-escher engine", () => {
    const classCase = classBenchmarks.find((b) => b.name === "isNullNode");
    expect(classCase).toBeDefined();
    const report = runTypedEscherBenchmarks({
      benchmarks: [classCase!],
      synthConfig: {
        maxCost: 6,
        searchSizeFactor: 3,
        maxReboots: 3,
        goalSearchStrategy: "then-first",
        deleteAllErr: true,
        timeoutMs: 1000,
      },
    });

    expect(report.total).toBe(1);
    expect(report.failed).toBe(0);
    expect(report.succeeded).toBe(1);
    expect(report.cases[0]?.category).toBe("classes");
  });

  it("applies per-benchmark synth config overrides", () => {
    const classCase = classBenchmarks.find((b) => b.name === "thisRef");
    expect(classCase).toBeDefined();
    const benchmark = {
      ...classCase!,
      synthConfigOverride: {
        enforceDecreasingMeasure: false,
      },
    };
    const report = runTypedEscherBenchmarks({
      benchmarks: [benchmark],
      synthConfig: {
        maxCost: 11,
        searchSizeFactor: 2,
        maxReboots: 1,
        goalSearchStrategy: "then-first",
        deleteAllErr: true,
        timeoutMs: 1000,
        enforceDecreasingMeasure: true,
      },
    });
    expect(report.failed).toBe(0);
    expect(report.cases[0]?.config.enforceDecreasingMeasure).toBe(false);
  });
});
