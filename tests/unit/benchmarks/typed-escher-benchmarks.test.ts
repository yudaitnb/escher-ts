import { describe, expect, it } from "vitest";
import {
  dllistBenchmarks,
  dllistExamplesBenchmarks,
  pointBenchmarks,
  pointExamplesBenchmarks,
  pureBenchmarks,
  pureExamplesBenchmarks,
  standardListBenchmarks,
} from "../../../src/benchmarks/typed-escher-benchmarks.js";

describe("typed escher benchmarks", () => {
  it("defines benchmark cases with consistent examples", () => {
    for (const benchmark of standardListBenchmarks) {
      expect(benchmark.examples.length).toBeGreaterThan(0);
      for (const [args, out] of benchmark.examples) {
        expect(args.length).toBe(benchmark.inputTypes.length);
        expect(benchmark.oracle(args)).toEqual(out);
      }
    }
  });

  it("keeps oracle-consistent examples for all pure cases", () => {
    for (const benchmark of pureExamplesBenchmarks) {
      expect(benchmark.examples.length).toBeGreaterThan(0);
      for (const [args, out] of benchmark.examples) {
        expect(benchmark.oracle(args)).toEqual(out);
      }
    }
  });

  it("uses benchmark-local component envs", () => {
    for (const benchmark of pureExamplesBenchmarks) {
      const ascendRecEnv = benchmark.ascendRecEnv ?? benchmark.env;
      const baselineNames = new Set([...benchmark.env.keys()]);
      const ascendRecNames = new Set([...ascendRecEnv.keys()]);
      expect(ascendRecNames).toEqual(baselineNames);
    }
  });

  it("loads all 17 benchmark specs from JSON", () => {
    expect(pureExamplesBenchmarks).toHaveLength(17);
    expect(pureBenchmarks).toHaveLength(17);
  });

  it("loads dllist benchmark specs from JSON", () => {
    expect(dllistExamplesBenchmarks.length).toBeGreaterThan(0);
    expect(dllistExamplesBenchmarks.every((b) => b.category === "classes")).toBe(true);
    expect(dllistBenchmarks.length).toBeGreaterThan(0);
  });

  it("loads point benchmark specs from JSON", () => {
    expect(pointExamplesBenchmarks.length).toBeGreaterThan(0);
    expect(pointExamplesBenchmarks.every((b) => b.category === "classes")).toBe(true);
    expect(pointBenchmarks.length).toBeGreaterThan(0);
  });
});
