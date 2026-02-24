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
const singleEngineSettingsEl = q("#single-engine-settings");
const singleTaskSettingsEl = q("#single-task-settings");
const singleResultEl = q("#single-result");

const suiteEngineEl = q("#suite-engine");
const suiteNameEl = q("#suite-name");
const runSuiteButton = q("#run-suite");
const suiteProgressEl = q("#suite-progress");
const suiteTableEl = q("#suite-table");
const suiteComponentsTableEl = q("#suite-components-table");
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

const engineConfigString = (config) =>
  [
    `maxCost: ${config.maxCost}`,
    `timeoutMs: ${config.timeoutMs}`,
    `searchSizeFactor: ${config.searchSizeFactor}`,
    `maxReboots: ${config.maxReboots}`,
    `strategy: ${config.strategy}`,
    `useReductionRules: ${config.useReductionRules}`,
    `onlyForwardSearch: ${config.onlyForwardSearch}`,
  ].join("\n");

const escapeHtml = (text) =>
  text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

const signatureString = (job) => {
  if (job.inputNames.length === 0) {
    return `() => ${showType(job.returnType)}`;
  }
  const args = job.inputNames.map((name, idx) => `  ${name}: ${showType(job.inputTypes[idx])}`).join(",\n");
  return `(\n${args}\n) => ${showType(job.returnType)}`;
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

const prettyPrintJs = (source) => {
  const text = source.trim();
  if (text.length === 0) {
    return text;
  }
  const rough = text
    .replaceAll(";", ";\n")
    .replaceAll("{", "{\n")
    .replaceAll("}", "\n}\n")
    .replaceAll("\n\n", "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  let indent = 0;
  const out = [];
  for (const line of rough) {
    if (line.startsWith("}")) {
      indent = Math.max(0, indent - 1);
    }
    out.push(`${"  ".repeat(indent)}${line}`);
    if (line.endsWith("{")) {
      indent += 1;
    }
  }
  return out.join("\n");
};

const declaredComponentsString = (spec) => {
  if (!Array.isArray(spec.components) || spec.components.length === 0) {
    return "(none)";
  }
  const seen = new Set();
  const lines = [];
  for (const component of spec.components) {
    if (seen.has(component.name)) {
      continue;
    }
    seen.add(component.name);
    lines.push(formatComponentSpec(component));
  }
  return lines.join("\n");
};

const envComponentNames = (job) => {
  const names = [...job.env.keys()].sort((a, b) => a.localeCompare(b));
  return names;
};

const envComponentsString = (job) => {
  const names = envComponentNames(job);
  return names.length === 0 ? "(none)" : names.join(", ");
};

const autoGeneratedComponentsString = (spec, job) => {
  const declared = new Set((Array.isArray(spec.components) ? spec.components : []).map((component) => component.name));
  const auto = envComponentNames(job).filter((name) => !declared.has(name));
  return auto.length === 0 ? "(none)" : auto.join(", ");
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
    const autoComponents = autoGeneratedComponentsString(entry.spec, job);
    const configText = engineConfigString(config);

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
        autoComponents,
        envComponents,
        source: entry.source,
        engine,
        configText,
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
      autoComponents,
      envComponents,
      source: entry.source,
      engine,
      configText,
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
      autoComponents: "(failed to derive components)",
      envComponents: "(failed to build env)",
      source: entry.source,
      engine,
      configText: engineConfigString(config),
      program: null,
      errorMessage: error instanceof Error ? error.message : String(error),
    };
  }
};

const renderSingleResult = (row) => {
  const engineSettingsLines = [];
  engineSettingsLines.push(`engine: ${row.engine}`);
  engineSettingsLines.push("runConfig:");
  engineSettingsLines.push(row.configText);
  singleEngineSettingsEl.textContent = engineSettingsLines.join("\n");

  const taskSettingsLines = [];
  taskSettingsLines.push(`name: ${row.name}`);
  taskSettingsLines.push(`source: ${row.source}`);
  taskSettingsLines.push(`category: ${row.category}`);
  taskSettingsLines.push("");
  taskSettingsLines.push("signature:");
  taskSettingsLines.push(row.signature);
  if (row.oracle !== null) {
    taskSettingsLines.push("");
    taskSettingsLines.push(`oracle: ${row.oracle}`);
  }
  taskSettingsLines.push("");
  taskSettingsLines.push("components(declared):");
  taskSettingsLines.push(row.declaredComponents);
  taskSettingsLines.push("");
  taskSettingsLines.push("components(auto-generated):");
  taskSettingsLines.push(row.autoComponents);
  taskSettingsLines.push("");
  taskSettingsLines.push("components(env):");
  taskSettingsLines.push(row.envComponents);
  if (row.oracleBody !== null) {
    taskSettingsLines.push("");
    taskSettingsLines.push("oracle.body:");
    taskSettingsLines.push(prettyPrintJs(row.oracleBody));
  }
  singleTaskSettingsEl.textContent = taskSettingsLines.join("\n");

  const resultLines = [];
  resultLines.push(`status: ${row.success ? "OK" : "FAIL"}`);
  resultLines.push(`elapsed: ${row.elapsedMs} ms`);
  resultLines.push(`cost: ${row.cost ?? "-"}`);
  resultLines.push(`depth: ${row.depth ?? "-"}`);
  resultLines.push(`reboots: ${row.reboots ?? "-"}`);
  if (row.errorMessage !== null) {
    resultLines.push(`error: ${row.errorMessage}`);
  }
  resultLines.push("");
  resultLines.push("program:");
  resultLines.push(row.program ?? "(failed)");
  singleResultEl.textContent = resultLines.join("\n");
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

const splitLines = (text) =>
  text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

const splitCommaNames = (text) =>
  text
    .split(",")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

const renderComponentLines = (items) => {
  if (items.length === 0) {
    return "(none)";
  }
  return items.map((item) => `<code>${escapeHtml(item)}</code>`).join("<br/>");
};

const renderSuiteComponentsTable = (rows) => {
  const body = rows
    .map((row) => {
      const declared =
        row.declaredComponents === "(none)" ? [] : splitLines(row.declaredComponents);
      const autoGenerated =
        row.autoComponents === "(none)" ? [] : splitCommaNames(row.autoComponents);
      const effectiveEnv =
        row.envComponents === "(none)" ? [] : splitCommaNames(row.envComponents);
      return `<tr>
  <td>${escapeHtml(row.name)}</td>
  <td class="components-cell">${renderComponentLines(declared)}</td>
  <td class="components-cell">${renderComponentLines(autoGenerated)}</td>
  <td class="components-cell">${renderComponentLines(effectiveEnv)}</td>
</tr>`;
    })
    .join("");

  suiteComponentsTableEl.innerHTML = `<h3>Used Components (by benchmark)</h3>
<table>
  <thead>
    <tr><th>benchmark</th><th>declared</th><th>auto-generated</th><th>effective env</th></tr>
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
  const sourceOrder = ["pure", "dllist", "points", "basic"];
  const categoryOrder = ["lists", "integers", "trees", "classes"];
  const sourceRank = new Map(sourceOrder.map((source, index) => [source, index]));
  const categoryRank = new Map(categoryOrder.map((category, index) => [category, index]));

  const groups = new Map();
  for (const entry of allEntries) {
    const label = `${entry.category} / ${entry.source}`;
    const bucket = groups.get(label);
    if (bucket === undefined) {
      groups.set(label, [entry]);
    } else {
      bucket.push(entry);
    }
  }

  const labels = [...groups.keys()].sort((left, right) => {
    const [leftCategory, leftSource] = left.split(" / ");
    const [rightCategory, rightSource] = right.split(" / ");
    const categoryCmp = (categoryRank.get(leftCategory) ?? 999) - (categoryRank.get(rightCategory) ?? 999);
    if (categoryCmp !== 0) {
      return categoryCmp;
    }
    const sourceCmp = (sourceRank.get(leftSource) ?? 999) - (sourceRank.get(rightSource) ?? 999);
    if (sourceCmp !== 0) {
      return sourceCmp;
    }
    return left.localeCompare(right);
  });

  const optgroups = labels
    .map((label) => {
      const entries = groups.get(label) ?? [];
      const options = entries
        .sort((a, b) => a.id.localeCompare(b.id))
        .map((entry) => `<option value="${escapeHtml(entry.key)}">${escapeHtml(entry.id)}</option>`)
        .join("");
      return `<optgroup label="${escapeHtml(label)}">${options}</optgroup>`;
    })
    .join("");

  singleBenchmarkEl.innerHTML = optgroups;
};

runSingleButton.addEventListener("click", () => {
  const selected = entryByKey.get(singleBenchmarkEl.value);
  if (selected === undefined) {
    singleEngineSettingsEl.textContent = "Benchmark not found.";
    singleTaskSettingsEl.textContent = "Benchmark not found.";
    singleResultEl.textContent = "Benchmark not found.";
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
  suiteComponentsTableEl.innerHTML = "";
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
    renderSuiteComponentsTable(rows);
    suiteChartEl.innerHTML = toChartSvg(engine, rows, durationMs);
  } finally {
    setBusy(false);
  }
});

initializeSingleSelect();
singleEngineSettingsEl.textContent = "Select a benchmark and click Run.";
singleTaskSettingsEl.textContent = "Select a benchmark and click Run.";
singleResultEl.textContent = "Select a benchmark and click Run.";
suiteProgressEl.textContent = "Select suite and click Run Suite.";
