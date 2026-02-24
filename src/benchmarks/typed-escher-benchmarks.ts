import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { type ComponentImpl } from "../components/component.js";
import { parseJsonSynthesisSpec, prepareJsonSynthesisJob } from "../components/user-friendly-json.js";
import { type Term } from "../types/term.js";
import { type Type } from "../types/type.js";
import { type TermValue } from "../types/value.js";

export type BenchmarkCategory = "lists" | "integers" | "trees" | "classes";

export interface TypedEscherBenchmarkCase {
  name: string;
  category: BenchmarkCategory;
  inputTypes: readonly Type[];
  inputNames: readonly string[];
  returnType: Type;
  env: ReadonlyMap<string, ComponentImpl>;
  synthConfigOverride?: {
    readonly enforceDecreasingMeasure?: boolean;
  };
  ascendRecEnv?: ReadonlyMap<string, ComponentImpl>;
  examples: readonly (readonly [readonly TermValue[], TermValue])[];
  ascendRecExamples?: readonly (readonly [readonly TermValue[], TermValue])[];
  oracle: (args: readonly TermValue[]) => TermValue;
  oraclePretty?: string;
  ascendRecReductionRules?: ReadonlyMap<string, (args: readonly Term[]) => boolean>;
}

const PURE_BENCHMARK_DIR = join(process.cwd(), "examples", "benchmarks-pure");
const DLLIST_BENCHMARK_DIR = join(process.cwd(), "examples", "benchmarks-dllist");
const POINT_BENCHMARK_DIR = join(process.cwd(), "examples", "benchmarks-points");
const SUITE_DIR = join(process.cwd(), "examples", "benchmark-suites");
const PURE_SUITE_PATH = join(SUITE_DIR, "pure.json");
const STANDARD_SUITE_PATH = join(SUITE_DIR, "standard.json");
const DLLIST_SUITE_PATH = join(SUITE_DIR, "dllist.json");
const POINTS_SUITE_PATH = join(SUITE_DIR, "points.json");
const asCategory = (value: unknown, benchmarkName: string): BenchmarkCategory => {
  if (value === "lists" || value === "integers" || value === "trees" || value === "classes") {
    return value;
  }
  throw new Error(`Benchmark '${benchmarkName}' must define category as 'lists' | 'integers' | 'trees' | 'classes'`);
};

const loadBenchmarksFromJsonDir = (benchmarkDir: string): readonly TypedEscherBenchmarkCase[] => {
  const files = readdirSync(benchmarkDir).filter((file) => file.endsWith(".json")).sort();
  return files.map((file) => {
    const rawText = readFileSync(join(benchmarkDir, file), "utf8");
    const rawObj = JSON.parse(rawText) as Record<string, unknown>;
    const spec = parseJsonSynthesisSpec(rawText);
    const job = prepareJsonSynthesisJob(spec);
    return {
      name: job.functionName,
      category: asCategory(rawObj.category, job.functionName),
      inputTypes: job.inputTypes,
      inputNames: job.inputNames,
      returnType: job.returnType,
      env: job.env,
      examples: job.examples,
      oracle: job.oracle,
    };
  });
};

const pureByName = new Map(loadBenchmarksFromJsonDir(PURE_BENCHMARK_DIR).map((benchmark) => [benchmark.name, benchmark] as const));
const dllistByName = new Map(loadBenchmarksFromJsonDir(DLLIST_BENCHMARK_DIR).map((benchmark) => [benchmark.name, benchmark] as const));
const pointByName = new Map(loadBenchmarksFromJsonDir(POINT_BENCHMARK_DIR).map((benchmark) => [benchmark.name, benchmark] as const));

const requirePureBenchmark = (name: string): TypedEscherBenchmarkCase => {
  const benchmark = pureByName.get(name);
  if (benchmark === undefined) {
    throw new Error(`Benchmark '${name}' is not defined in ${PURE_BENCHMARK_DIR}`);
  }
  return benchmark;
};

const requireDllistBenchmark = (name: string): TypedEscherBenchmarkCase => {
  const benchmark = dllistByName.get(name);
  if (benchmark === undefined) {
    throw new Error(`Benchmark '${name}' is not defined in ${DLLIST_BENCHMARK_DIR}`);
  }
  return benchmark;
};

const requirePointBenchmark = (name: string): TypedEscherBenchmarkCase => {
  const benchmark = pointByName.get(name);
  if (benchmark === undefined) {
    throw new Error(`Benchmark '${name}' is not defined in ${POINT_BENCHMARK_DIR}`);
  }
  return benchmark;
};

const loadSuiteNames = (path: string): readonly string[] => {
  const raw = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  if (!Array.isArray(raw.benchmarks)) {
    throw new Error(`Suite file '${path}' must define 'benchmarks' array`);
  }
  return raw.benchmarks.map((name, index) => {
    if (typeof name !== "string" || name.length === 0) {
      throw new Error(`Suite file '${path}' has invalid benchmark name at index ${index}`);
    }
    return name;
  });
};

export const pureExamplesBenchmarks: readonly TypedEscherBenchmarkCase[] = [...pureByName.values()];
export const dllistExamplesBenchmarks: readonly TypedEscherBenchmarkCase[] = [...dllistByName.values()];
export const pointExamplesBenchmarks: readonly TypedEscherBenchmarkCase[] = [...pointByName.values()];

export const pureBenchmarks: readonly TypedEscherBenchmarkCase[] = loadSuiteNames(PURE_SUITE_PATH).map((name) =>
  requirePureBenchmark(name),
);
export const standardListBenchmarks: readonly TypedEscherBenchmarkCase[] = loadSuiteNames(STANDARD_SUITE_PATH).map((name) =>
  requirePureBenchmark(name),
);
export const dllistBenchmarks: readonly TypedEscherBenchmarkCase[] = loadSuiteNames(DLLIST_SUITE_PATH).map((name) =>
  requireDllistBenchmark(name),
);
export const pointBenchmarks: readonly TypedEscherBenchmarkCase[] = loadSuiteNames(POINTS_SUITE_PATH).map((name) =>
  requirePointBenchmark(name),
);

// Backward compatibility aliases.
export const classExamplesBenchmarks = dllistExamplesBenchmarks;
export const classBenchmarks = dllistBenchmarks;

export const reverseBenchmark = requirePureBenchmark("reverse");
export const lengthBenchmark = requirePureBenchmark("length");
export const compressBenchmark = requirePureBenchmark("compress");
export const stutterBenchmark = requirePureBenchmark("stutter");
export const squareListBenchmark = requirePureBenchmark("squareList");
export const insertBenchmark = requirePureBenchmark("insert");
export const lastInListBenchmark = requirePureBenchmark("lastInList");
export const cartesianBenchmark = requirePureBenchmark("cartesian");
export const fibBenchmark = requirePureBenchmark("fib");
export const sumUnderBenchmark = requirePureBenchmark("sumUnder");
export const dropLastBenchmark = requirePureBenchmark("dropLast");
export const evensBenchmark = requirePureBenchmark("evens");
export const shiftLeftBenchmark = requirePureBenchmark("shiftLeft");
export const maxInListBenchmark = requirePureBenchmark("maxInList");
export const flattenTreeBenchmark = requirePureBenchmark("flattenTree");
export const tConcatBenchmark = requirePureBenchmark("tConcat");
export const nodesAtLevelBenchmark = requirePureBenchmark("nodesAtLevel");
