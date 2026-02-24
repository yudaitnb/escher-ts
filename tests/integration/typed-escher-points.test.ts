import { describe, expect, it } from "vitest";
import { runTypedEscherBenchmarks } from "../../src/benchmarks/harness.js";
import { pointBenchmarks } from "../../src/benchmarks/typed-escher-benchmarks.js";

describe("typed escher points benchmarks", () => {
  it(
    "synthesizes all point benchmarks",
    () => {
      const report = runTypedEscherBenchmarks({
        benchmarks: pointBenchmarks,
        synthConfig: {
          maxCost: 24,
          searchSizeFactor: 3,
          maxReboots: 10,
          goalSearchStrategy: "then-first",
          deleteAllErr: true,
          timeoutMs: 10000,
          enforceDecreasingMeasure: true,
        },
      });

      const failed = report.cases.filter((c) => !c.success).map((c) => c.name);
      expect(failed).toEqual([]);
      expect(report.succeeded).toBe(report.total);
    },
    120000,
  );
});
