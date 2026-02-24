import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { BenchmarkEngine, BenchmarkRunHooks, BenchmarkRunReport } from "../benchmarks/harness.js";
import { formatBenchmarkProgramPairs, formatBenchmarkReport } from "../benchmarks/report-formatters.js";
import { benchmarkReportToCsv, benchmarkReportToSvg } from "../benchmarks/report-chart.js";
import {
  dllistBenchmarks,
  dllistExamplesBenchmarks,
  pointBenchmarks,
  pointExamplesBenchmarks,
  pureBenchmarks,
  pureExamplesBenchmarks,
  standardListBenchmarks,
} from "../benchmarks/typed-escher-benchmarks.js";

export type BenchmarkSuite = "standard" | "pure" | "dllist" | "points";
export type GoalSearchStrategy = "then-first" | "cond-first";
export type SharedCliParsedValues = {
  svg?: string;
  csv?: string;
  programs?: string;
  json?: boolean;
};

export const parseNumber = (value: string | undefined, fallback: number): number => {
  if (value === undefined) {
    return fallback;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
};

export const parseStrategy = (value: string | undefined): GoalSearchStrategy =>
  value === "cond-first" ? "cond-first" : "then-first";

export const parseSuite = (value: string | undefined): BenchmarkSuite => {
  if (value === undefined) {
    return "standard";
  }
  if (value === "pure") {
    return "pure";
  }
  if (value === "dllist" || value === "classes") {
    return "dllist";
  }
  if (value === "points") {
    return "points";
  }
  if (value === "standard") {
    return "standard";
  }
  throw new Error(`Unknown suite '${value}'. Expected one of: standard, pure, dllist, points`);
};

export const normalizeCliArgs = (argv: readonly string[]): string[] => (argv[0] === "--" ? argv.slice(1) : [...argv]);

export const outputBase = (engine: "typed-escher" | "ascendrec", suite: BenchmarkSuite): string =>
  `outputs/${suite}-${engine}`;

export const defaultProgramsPath = (engine: "typed-escher" | "ascendrec", suite: BenchmarkSuite): string =>
  `${outputBase(engine, suite)}-programs.md`;

export const defaultSvgPath = (engine: "typed-escher" | "ascendrec", suite: BenchmarkSuite): string =>
  `${outputBase(engine, suite)}-runtime.svg`;

export const defaultCsvPath = (engine: "typed-escher" | "ascendrec", suite: BenchmarkSuite): string =>
  `${outputBase(engine, suite)}-runtime.csv`;

export const selectBenchmarks = (suite: BenchmarkSuite, namesRaw: string | undefined) => {
  const pool =
    suite === "pure"
      ? pureBenchmarks
      : suite === "dllist"
        ? dllistExamplesBenchmarks
        : suite === "points"
          ? pointExamplesBenchmarks
        : standardListBenchmarks;
  if (namesRaw === undefined || namesRaw.trim() === "") {
    return suite === "dllist" ? dllistBenchmarks : suite === "points" ? pointBenchmarks : pool;
  }

  const names = new Set(namesRaw.split(",").map((s) => s.trim()).filter((s) => s.length > 0));
  return pool.filter((benchmark) => names.has(benchmark.name));
};

export const writeIfPath = (path: string | undefined, content: string): void => {
  if (path === undefined || path.trim() === "") {
    return;
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, "utf8");
};

export const emitBenchmarkOutputs = (
  engine: BenchmarkEngine,
  suite: BenchmarkSuite,
  values: SharedCliParsedValues,
  report: BenchmarkRunReport,
): void => {
  const svgPath = values.svg ?? defaultSvgPath(engine, suite);
  const csvPath = values.csv ?? defaultCsvPath(engine, suite);
  const programsPath = values.programs ?? defaultProgramsPath(engine, suite);

  writeIfPath(svgPath, benchmarkReportToSvg(report));
  writeIfPath(csvPath, benchmarkReportToCsv(report));
  writeIfPath(programsPath, formatBenchmarkProgramPairs(report));

  if (values.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(formatBenchmarkReport(report));
    console.log(`SVG written: ${svgPath}`);
    console.log(`CSV written: ${csvPath}`);
    console.log(`Programs written: ${programsPath}`);
  }
};

export const createProgressHooks = (quiet: boolean | undefined): BenchmarkRunHooks | undefined => {
  if (quiet) {
    return undefined;
  }
  return {
    onCaseStart: ({ name, index, total }: { name: string; index: number; total: number }) => {
      console.log(`[${index}/${total}] START ${name}`);
    },
    onCaseFinish: ({
      row,
      index,
      total,
    }: {
      row: { name: string; success: boolean; elapsedMs: number };
      index: number;
      total: number;
    }) => {
      const status = row.success ? "OK" : "FAIL";
      console.log(`[${index}/${total}] DONE  ${row.name} -> ${status} (${row.elapsedMs} ms)`);
    },
  };
};
