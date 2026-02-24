# escher-ts

A TypeScript implementation of Escher, a Programming-by-Example synthesizer.
You can run JSON-defined synthesis tasks with both `TypedEscher` and `AscendRec`.

- [Recursive Program Synthesis (CAV'13)](https://link.springer.com/chapter/10.1007/978-3-642-39799-8_67)
- [Oracle-free Synthesis of Recursive Programs (BThesis'17)](https://github.com/MrVPlusOne/Escher-Scala/blob/master/documentation/AscendRec-en.pdf)
  - [Escher-Scala (Scala implementation)](https://github.com/MrVPlusOne/Escher-Scala)

## Quick Start

```bash
pnpm install
pnpm run typecheck
pnpm test:run
```

## Web App (GitHub Pages-ready)

`web/` contains a browser UI for running synthesis tasks.

```bash
# Dev server
pnpm run web:dev

# Static build (web/dist)
pnpm run web:build

# Preview build
pnpm run web:preview
```

Features:

- Run an individual benchmark interactively
- Run full `pure` / `dllist` / `points` suites
- Show result tables and runtime SVG charts

`web/vite.config.ts` uses `base: "./"`, so `web/dist` can be published directly to GitHub Pages.

### Manual GitHub Pages Deployment (No Auto Deploy)

1. Configure GitHub
   - Repository Settings → Pages → Source: `Deploy from a branch`
   - Branch: `gh-pages` / `/ (root)`

2. Deploy (single command)

```bash
pnpm run deploy:pages
```

What it runs:

```bash
pnpm run build:pages
pnpm dlx gh-pages -d web/dist
```

The published URL is usually `https://<your-github-user>.github.io/<repo-name>/`.

## Benchmark Commands

```bash
# Pure benchmarks
pnpm run benchmark:typed-escher -- --suite pure --maxCost 24 --timeoutMs 10000
pnpm run benchmark:ascendrec -- --suite pure --maxCost 24 --timeoutMs 10000

# DLList benchmarks
pnpm run benchmark:typed-escher -- --suite dllist --maxCost 24 --timeoutMs 10000
pnpm run benchmark:ascendrec -- --suite dllist --maxCost 24 --timeoutMs 10000

# Point-only benchmarks
pnpm run benchmark:typed-escher -- --suite points --maxCost 24 --timeoutMs 10000
pnpm run benchmark:ascendrec -- --suite points --maxCost 24 --timeoutMs 10000
```

Default outputs:

- `outputs/<suite>-typed-escher-runtime.svg`
- `outputs/<suite>-typed-escher-runtime.csv`
- `outputs/<suite>-typed-escher-programs.md`
- `outputs/<suite>-ascendrec-runtime.svg`
- `outputs/<suite>-ascendrec-runtime.csv`
- `outputs/<suite>-ascendrec-programs.md`

## Engine Configuration Reference

Both CLI and Web UI expose the same core search parameters.

- `maxCost`
  - Global level bound for synthesis loops (`for level = 1..maxCost`) in both TypedEscher and AscendRec.
  - It limits how deep/costly candidate programs can be enumerated and searched.
  - Too small: search stops before a valid program can appear. Too large: runtime grows quickly.
- `timeoutMs`
  - Single per-task wall-clock deadline (`createDeadline(timeoutMs)`), checked throughout synthesis.
  - For TypedEscher, the same deadline is shared across reboot rounds; reboot does not reset timeout.
  - `null` means no timeout in core config (CLI/Web usually pass a finite value).
- `searchSizeFactor`
  - Budget multiplier for conditional goal search: budget = `searchSizeFactor * level`.
  - Used by TypedEscher batch goal search and AscendRec goal search.
  - In AscendRec with `onlyForwardSearch=true`, goal search is skipped, so this has little/no effect.
- `maxReboots` (TypedEscher)
  - TypedEscher-only reboot cap for counterexample-driven retries.
  - Checked as `reboots > maxReboots`; with `maxReboots=0`, only the initial attempt runs (no retry round).
  - Not used by AscendRec.
- `strategy` (`then-first` / `cond-first`)
  - Conditional decomposition order inside goal search.
  - TypedEscher: selects `searchThenFirst` vs `searchCondFirst` in batch goal search.
  - AscendRec: passed into `AscendRecGoalSearch` and affects split/if-search order.
  - Same solution space in principle, different runtime profile in practice.
  - Practical note: on `examples/benchmarks-dllist/findByValue.json`,
    TypedEscher may fail quickly with `then-first` under the default budget, while
    `cond-first` succeeds; AscendRec succeeds with either strategy in current implementation.
    If this case fails in TypedEscher, try `--strategy cond-first` first.
- `useReductionRules` (AscendRec)
  - `true`: uses component reduction rules (`isReducible` + optional custom rules) to prune equivalent/useless terms.
  - `false`: disables these reductions, usually expanding the search space significantly.
- `onlyForwardSearch` (AscendRec)
  - `true`: skips backward/goal-search phase and relies on forward exact hits from enumerated terms.
  - `false`: enables full forward + goal-search behavior (normally recommended).

## Directory Layout

- `src/`: synthesizer implementation
- `examples/`: JSON task definitions and suites
- `tests/`: unit/integration tests
- `docs/`: supplemental documentation
- `outputs/`: benchmark results (generated files)

See `docs/directories.md` for details.

## JSON Task Definitions

Primary locations:

- `examples/benchmarks-pure/*.json`
- `examples/benchmarks-dllist/*.json`
- `examples/benchmarks-points/*.json`
- `examples/basic/*.json` (small examples)

Suite definitions:

- `examples/benchmark-suites/pure.json`
- `examples/benchmark-suites/dllist.json`
- `examples/benchmark-suites/points.json`
- `examples/benchmark-suites/standard.json` (small compatibility suite)

Minimal example:

```json
{
  "name": "calc",
  "category": "integers",
  "signature": {
    "inputNames": ["x", "y"],
    "inputTypes": ["Int", "Int"],
    "returnType": "Int"
  },
  "components": [
    { "name": "add", "kind": "intBinary", "op": "add" }
  ],
  "examples": [
    [[1, 2], 3],
    [[4, 5], 9]
  ]
}
```

More details:

- Component definitions: `docs/components.md`
- Test strategy: `tests/README.md`

## Recursive Task Assumption (Decreasing Measure)

For recursive synthesis, this project enforces a decreasing-measure check by default
(`enforceDecreasingMeasure=true`).

The default comparator is `anyArgSmaller`, which means a recursive call is accepted only if:

- every argument is non-increasing compared to the caller, and
- at least one argument is strictly smaller.

So for tasks that should synthesize recursion, examples and encodings must make this decrease visible.
For `Ref` values, the order uses absolute value; e.g. `2 -> 1 -> 0 -> -1` is decreasing, while
`0 -> 1 -> 2` is not.

## Adding a New Task

1. Add a JSON file to `examples/benchmarks-pure/`, `examples/benchmarks-dllist/`, or `examples/benchmarks-points/`
2. Define `signature`, `components`, and `examples`
3. Optionally define `oracle` using `examples` / `table` / `js` / `componentRef`
4. If needed, update `examples/benchmark-suites/*.json`
5. Validate with `pnpm test:run` and benchmark commands

## Adding a New Component

1. First check whether JSON `intConst/intUnary/intBinary/boolUnary/libraryRef/js` is enough
2. If TS implementation is needed, add it under `src/library/common-comps-*.ts`
3. Register it in `src/library/common-comps-sets.ts`
4. Reference it from JSON via `libraryRef`
5. Add tests in `tests/unit/library/common-comps.test.ts`
