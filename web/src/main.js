import pureSuiteRaw from "../../examples/benchmark-suites/pure.json";
import dllistSuiteRaw from "../../examples/benchmark-suites/dllist.json";
import pointsSuiteRaw from "../../examples/benchmark-suites/points.json";
import { prepareJsonSynthesisJob, parseJsonSynthesisSpec } from "../../src/components/user-friendly-json.ts";
import { showTerm } from "../../src/types/term.ts";
import { showType } from "../../src/types/type.ts";
import { TypedEscherSynthesizer } from "../../src/synthesis/escher/synthesizer.ts";
import { AscendRecSynthesizer } from "../../src/synthesis/ascendrec/synthesizer.ts";
import { benchmarkReportToSvg } from "../../src/benchmarks/report-chart.ts";

const jsonModules = {
  pure: import.meta.glob("../../examples/benchmarks-pure/*.json", { eager: true }),
  dllist: import.meta.glob("../../examples/benchmarks-dllist/*.json", { eager: true }),
  points: import.meta.glob("../../examples/benchmarks-points/*.json", { eager: true }),
  basic: import.meta.glob("../../examples/basic/*.json", { eager: true }),
};

const asSuite = (value, name) => {
  if (typeof value !== "object" || value === null) {
    throw new Error(`${name} must be an object`);
  }
  const raw = value;
  if (!Array.isArray(raw.benchmarks) || raw.benchmarks.some((b) => typeof b !== "string")) {
    throw new Error(`${name}.benchmarks must be string[]`);
  }
  return { benchmarks: raw.benchmarks };
};

const pureSuite = asSuite(pureSuiteRaw, "pure suite");
const dllistSuite = asSuite(dllistSuiteRaw, "dllist suite");
const pointsSuite = asSuite(pointsSuiteRaw, "points suite");

const benchmarkCategory = (raw, source) => {
  if (raw === "lists" || raw === "integers" || raw === "trees" || raw === "classes") {
    return raw;
  }
  return source === "dllist" || source === "points" ? "classes" : "lists";
};

const fileBaseName = (path) => {
  const normalized = path.replaceAll("\\", "/");
  const name = normalized.slice(normalized.lastIndexOf("/") + 1);
  return name.endsWith(".json") ? name.slice(0, -5) : name;
};

const loadEntries = () => {
  const entries = [];
  const pushFrom = (source, modules) => {
    for (const [path, moduleRaw] of Object.entries(modules)) {
      const mod = moduleRaw;
      const rawSpec = mod.default ?? moduleRaw;
      const spec = parseJsonSynthesisSpec(JSON.stringify(rawSpec));
      const id = spec.name ?? fileBaseName(path);
      entries.push({
        key: `${source}:${id}`,
        id,
        source,
        category: benchmarkCategory(spec.category, source),
        spec,
      });
    }
  };

  pushFrom("pure", jsonModules.pure);
  pushFrom("dllist", jsonModules.dllist);
  pushFrom("points", jsonModules.points);
  pushFrom("basic", jsonModules.basic);

  return entries.sort((a, b) => `${a.source}:${a.id}`.localeCompare(`${b.source}:${b.id}`));
};

const allEntries = loadEntries();
const entryByKey = new Map(allEntries.map((entry) => [entry.key, entry]));
const entryByName = new Map();
for (const entry of allEntries) {
  if (!entryByName.has(entry.id)) {
    entryByName.set(entry.id, entry);
  }
}

const q = (selector) => {
  const found = document.querySelector(selector);
  if (found === null) {
    throw new Error(`Missing element: ${selector}`);
  }
  return found;
};

const singleEngineEl = q("#single-engine");
const singleBenchmarkEl = q("#single-benchmark");
const runSingleButton = q("#run-single");
const singleOutputEl = q("#single-output");

const suiteEngineEl = q("#suite-engine");
const suiteNameEl = q("#suite-name");
const runSuiteButton = q("#run-suite");
const suiteProgressEl = q("#suite-progress");
const suiteTableEl = q("#suite-table");
const suiteChartEl = q("#suite-chart");

const cfgMaxCostEl = q("#cfg-max-cost");
const cfgTimeoutMsEl = q("#cfg-timeout-ms");
const cfgSearchSizeFactorEl = q("#cfg-search-size-factor");
const cfgMaxRebootsEl = q("#cfg-max-reboots");
const cfgStrategyEl = q("#cfg-strategy");
const cfgUseReductionRulesEl = q("#cfg-use-reduction-rules");
const cfgOnlyForwardSearchEl = q("#cfg-only-forward-search");

const asInt = (value, fallback) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const getConfig = () => ({
  maxCost: asInt(cfgMaxCostEl.value, 24),
  timeoutMs: asInt(cfgTimeoutMsEl.value, 10000),
  searchSizeFactor: asInt(cfgSearchSizeFactorEl.value, 3),
  maxReboots: asInt(cfgMaxRebootsEl.value, 10),
  strategy: cfgStrategyEl.value === "cond-first" ? "cond-first" : "then-first",
  useReductionRules: cfgUseReductionRulesEl.value === "true",
  onlyForwardSearch: cfgOnlyForwardSearchEl.value === "true",
});

const escapeHtml = (text) =>
  text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

const signatureString = (job) => {
  const args = job.inputNames.map((name, idx) => `${name}: ${showType(job.inputTypes[idx])}`).join(", ");
  return `(${args}) => ${showType(job.returnType)}`;
};

const oracleString = (spec) => {
  const oracle = spec.oracle;
  if (oracle === undefined) {
    return null;
  }
  switch (oracle.kind) {
    case "examples":
      return "examples";
    case "componentRef":
      return `componentRef(${oracle.name})`;
    case "table":
      return `table(entries=${oracle.entries.length}${oracle.default !== undefined ? ", default" : ""})`;
    case "js":
      return `js(${oracle.args?.join(", ") ?? "args"})`;
    default:
      return "unknown";
  }
};

const formatComponentSpec = (component) => {
  const parts = [`name=${component.name}`, `kind=${component.kind}`];
  if (component.kind === "libraryRef" && typeof component.ref === "string") {
    parts.push(`ref=${component.ref}`);
  }
  if (typeof component.op === "string") {
    parts.push(`op=${component.op}`);
  }
  if (typeof component.value === "number") {
    parts.push(`value=${component.value}`);
  }
  if (Array.isArray(component.inputTypes) && component.inputTypes.length > 0) {
    parts.push(`inputTypes=[${component.inputTypes.join(", ")}]`);
  }
  if (typeof component.returnType === "string") {
    parts.push(`returnType=${component.returnType}`);
  }
  return parts.join(", ");
};

const oracleBodyString = (spec) => {
  const oracle = spec.oracle;
  if (oracle === undefined) {
    return null;
  }
  if (oracle.kind !== "js") {
    return null;
  }
  return oracle.body ?? null;
};

const declaredComponentsString = (spec) => {
  if (!Array.isArray(spec.components) || spec.components.length === 0) {
    return "(none)";
  }
  return spec.components.map((component) => formatComponentSpec(component)).join("\n");
};

const envComponentsString = (job) => {
  const names = [...job.env.keys()].sort((a, b) => a.localeCompare(b));
  return names.length === 0 ? "(none)" : names.join(", ");
};

const runOne = (entry, engine, config) => {
  const started = performance.now();
  try {
    const job = prepareJsonSynthesisJob(entry.spec);
    const signature = signatureString(job);
    const oracle = oracleString(entry.spec);
    const oracleBody = oracleBodyString(entry.spec);
    const declaredComponents = declaredComponentsString(entry.spec);
    const envComponents = envComponentsString(job);

    if (engine === "typed-escher") {
      const synth = new TypedEscherSynthesizer({
        maxCost: config.maxCost,
        searchSizeFactor: config.searchSizeFactor,
        maxReboots: config.maxReboots,
        goalSearchStrategy: config.strategy,
        deleteAllErr: true,
        timeoutMs: config.timeoutMs,
        enforceDecreasingMeasure: true,
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
      const elapsedMs = Math.round(performance.now() - started);
      return {
        name: entry.id,
        category: entry.category,
        success: result !== null,
        elapsedMs,
        cost: result?.program.cost ?? null,
        depth: result?.program.depth ?? null,
        reboots: result?.data.reboots ?? null,
        signature,
        oracle,
        oracleBody,
        declaredComponents,
        envComponents,
        program: result === null ? null : showTerm(result.program.body),
        errorMessage: null,
      };
    }

    const synth = new AscendRecSynthesizer({
      maxCost: config.maxCost,
      searchSizeFactor: config.searchSizeFactor,
      goalSearchStrategy: config.strategy,
      deleteAllErr: true,
      timeoutMs: config.timeoutMs,
      enforceDecreasingMeasure: true,
      useReductionRules: config.useReductionRules,
      onlyForwardSearch: config.onlyForwardSearch,
    });
    const result = synth.synthesize(
      job.functionName,
      job.inputTypes,
      job.inputNames,
      job.returnType,
      job.env,
      job.examples,
    );
    const elapsedMs = Math.round(performance.now() - started);
    return {
      name: entry.id,
      category: entry.category,
      success: result !== null,
      elapsedMs,
      cost: result?.program.cost ?? null,
      depth: result?.program.depth ?? null,
      reboots: null,
      signature,
      oracle,
      oracleBody,
      declaredComponents,
      envComponents,
      program: result === null ? null : showTerm(result.program.body),
      errorMessage: null,
    };
  } catch (error) {
    const elapsedMs = Math.round(performance.now() - started);
    return {
      name: entry.id,
      category: entry.category,
      success: false,
      elapsedMs,
      cost: null,
      depth: null,
      reboots: null,
      signature: "(failed to parse signature)",
      oracle: null,
      oracleBody: null,
      declaredComponents: "(failed to parse components)",
      envComponents: "(failed to build env)",
      program: null,
      errorMessage: error instanceof Error ? error.message : String(error),
    };
  }
};

const renderSingleResult = (row) => {
  const lines = [];
  lines.push(`name: ${row.name}`);
  lines.push(`status: ${row.success ? "OK" : "FAIL"}`);
  lines.push(`elapsed: ${row.elapsedMs} ms`);
  lines.push(`category: ${row.category}`);
  lines.push(`signature: ${row.signature}`);
  lines.push(`cost: ${row.cost ?? "-"}`);
  lines.push(`depth: ${row.depth ?? "-"}`);
  lines.push(`reboots: ${row.reboots ?? "-"}`);
  if (row.oracle !== null) {
    lines.push(`oracle: ${row.oracle}`);
  }
  lines.push("components(declared):");
  lines.push(row.declaredComponents);
  lines.push("components(env):");
  lines.push(row.envComponents);
  if (row.oracleBody !== null) {
    lines.push("oracle.body:");
    lines.push(row.oracleBody);
  }
  if (row.errorMessage !== null) {
    lines.push(`error: ${row.errorMessage}`);
  }
  lines.push(`program: ${row.program ?? "(failed)"}`);
  singleOutputEl.textContent = lines.join("\n");
};

const renderSuiteTable = (rows) => {
  const body = rows
    .map(
      (row) => `<tr>
  <td>${escapeHtml(row.name)}</td>
  <td>${row.success ? '<span class="ok">OK</span>' : '<span class="fail">FAIL</span>'}</td>
  <td>${row.elapsedMs}</td>
  <td>${row.cost ?? "-"}</td>
  <td>${row.depth ?? "-"}</td>
  <td>${row.reboots ?? "-"}</td>
  <td>${escapeHtml(row.category)}</td>
</tr>`,
    )
    .join("");

  suiteTableEl.innerHTML = `<table>
  <thead>
    <tr><th>name</th><th>status</th><th>ms</th><th>cost</th><th>depth</th><th>reboots</th><th>category</th></tr>
  </thead>
  <tbody>${body}</tbody>
</table>`;
};

const toChartSvg = (engine, rows, durationMs) => {
  const report = {
    engine,
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    durationMs,
    total: rows.length,
    succeeded: rows.filter((r) => r.success).length,
    failed: rows.filter((r) => !r.success).length,
    options: {
      benchmarks: [],
      synthConfig: {
        maxCost: 0,
        searchSizeFactor: 0,
        deleteAllErr: true,
        timeoutMs: null,
      },
    },
    cases: rows.map((row) => ({
      name: row.name,
      category: row.category,
      success: row.success,
      elapsedMs: row.elapsedMs,
      cost: row.cost,
      depth: row.depth,
      reboots: row.reboots,
      oracleProgram: null,
      program: row.program,
      inputSpec: row.signature,
      components: [],
      exampleSpecs: [],
      config: {
        maxCost: 0,
        searchSizeFactor: 0,
        deleteAllErr: true,
        timeoutMs: null,
      },
      ascendRecDiagnostics: null,
    })),
  };

  return benchmarkReportToSvg(report).replace(/^<\?xml[^>]*>\s*/u, "");
};

const suiteEntries = (suite) => {
  const names =
    suite === "pure" ? pureSuite.benchmarks : suite === "points" ? pointsSuite.benchmarks : dllistSuite.benchmarks;
  return names
    .map((name) => entryByName.get(name))
    .filter((entry) => entry !== undefined);
};

const nextFrame = async () =>
  new Promise((resolve) => requestAnimationFrame(() => resolve()));

const setBusy = (busy) => {
  runSingleButton.disabled = busy;
  runSuiteButton.disabled = busy;
};

const initializeSingleSelect = () => {
  singleBenchmarkEl.innerHTML = allEntries
    .map((entry) => `<option value="${escapeHtml(entry.key)}">${escapeHtml(`${entry.id} (${entry.source})`)}</option>`)
    .join("");
};

runSingleButton.addEventListener("click", () => {
  const selected = entryByKey.get(singleBenchmarkEl.value);
  if (selected === undefined) {
    singleOutputEl.textContent = "Benchmark not found.";
    return;
  }
  setBusy(true);
  try {
    const engine = singleEngineEl.value === "ascendrec" ? "ascendrec" : "typed-escher";
    const row = runOne(selected, engine, getConfig());
    renderSingleResult(row);
  } finally {
    setBusy(false);
  }
});

runSuiteButton.addEventListener("click", async () => {
  setBusy(true);
  suiteProgressEl.textContent = "";
  suiteTableEl.innerHTML = "";
  suiteChartEl.innerHTML = "";

  try {
    const config = getConfig();
    const engine = suiteEngineEl.value === "ascendrec" ? "ascendrec" : "typed-escher";
    const suite =
      suiteNameEl.value === "dllist" ? "dllist" : suiteNameEl.value === "points" ? "points" : "pure";
    const targets = suiteEntries(suite);
    const rows = [];
    const started = performance.now();

    if (targets.length === 0) {
      suiteProgressEl.textContent = `No benchmarks found for suite=${suite}`;
      return;
    }

    for (const [index, entry] of targets.entries()) {
      suiteProgressEl.textContent += `[${index + 1}/${targets.length}] START ${entry.id}\n`;
      await nextFrame();
      const row = runOne(entry, engine, config);
      rows.push(row);
      suiteProgressEl.textContent += `[${index + 1}/${targets.length}] DONE  ${entry.id} -> ${row.success ? "OK" : "FAIL"} (${row.elapsedMs} ms)\n`;
      await nextFrame();
    }

    const durationMs = Math.round(performance.now() - started);
    suiteProgressEl.textContent += `\n${engine}: ${rows.filter((r) => r.success).length}/${rows.length} succeeded\n`;
    suiteProgressEl.textContent += `duration: ${durationMs} ms\n`;

    renderSuiteTable(rows);
    suiteChartEl.innerHTML = toChartSvg(engine, rows, durationMs);
  } finally {
    setBusy(false);
  }
});

initializeSingleSelect();
singleOutputEl.textContent = "Select a benchmark and click Run.";
suiteProgressEl.textContent = "Select suite and click Run Suite.";
