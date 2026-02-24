import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { anyArgSmaller, recursiveImpl } from "../../src/components/component.js";
import { parseJsonSynthesisSpec, prepareJsonSynthesisJob } from "../../src/components/user-friendly-json.js";
import { AscendRecSynthesizer } from "../../src/synthesis/ascendrec/synthesizer.js";
import { TypedEscherSynthesizer } from "../../src/synthesis/escher/synthesizer.js";

const basicCases = [
  "dllist-is-null.json",
  "dllist-this-ref.json",
  "dllist-next-ref.json",
] as const;

const loadJob = (fileName: string) => {
  const path = resolve(process.cwd(), "examples/benchmarks-dllist", fileName);
  const spec = parseJsonSynthesisSpec(readFileSync(path, "utf8"));
  return prepareJsonSynthesisJob(spec);
};

describe("basic DLList ref tasks", () => {
  it.each(basicCases)("typed-escher synthesizes %s", (fileName) => {
    const job = loadJob(fileName);
    const synth = new TypedEscherSynthesizer({
      maxCost: 6,
      searchSizeFactor: 3,
      maxReboots: 3,
      timeoutMs: 1000,
      goalSearchStrategy: "then-first",
    });
    const result = synth.synthesize(
      job.functionName,
      job.inputTypes,
      job.inputNames,
      job.returnType,
      job.env,
      job.examples,
      job.oracle,
    );
    expect(result, `${fileName} should be synthesizable by typed-escher`).not.toBeNull();

    const impl = recursiveImpl(result!.program.signature, job.env, anyArgSmaller, result!.program.body);
    for (const [args, out] of job.examples) {
      expect(impl.executeEfficient(args), `${fileName} synthesized output mismatch`).toEqual(out);
      expect(job.oracle(args), `${fileName} oracle mismatch`).toEqual(out);
    }
  });

  it.each(basicCases)("ascendrec synthesizes %s", (fileName) => {
    const job = loadJob(fileName);
    const synth = new AscendRecSynthesizer({
      maxCost: 6,
      searchSizeFactor: 3,
      timeoutMs: 1000,
      useReductionRules: true,
      onlyForwardSearch: false,
      argListCompare: anyArgSmaller,
    });
    const result = synth.synthesize(
      job.functionName,
      job.inputTypes,
      job.inputNames,
      job.returnType,
      job.env,
      job.examples,
    );
    expect(result, `${fileName} should be synthesizable by ascendrec`).not.toBeNull();

    const impl = recursiveImpl(result!.program.signature, job.env, anyArgSmaller, result!.program.body);
    for (const [args, out] of job.examples) {
      expect(impl.executeEfficient(args), `${fileName} synthesized output mismatch`).toEqual(out);
    }
  });
});
