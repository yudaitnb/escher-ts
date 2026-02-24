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
- Run full `pure` / `classes` suites
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

# Classes benchmarks
pnpm run benchmark:typed-escher -- --suite classes --maxCost 24 --timeoutMs 10000
pnpm run benchmark:ascendrec -- --suite classes --maxCost 24 --timeoutMs 10000
```

Default outputs:

- `outputs/<suite>-typed-escher-runtime.svg`
- `outputs/<suite>-typed-escher-runtime.csv`
- `outputs/<suite>-typed-escher-programs.md`
- `outputs/<suite>-ascendrec-runtime.svg`
- `outputs/<suite>-ascendrec-runtime.csv`
- `outputs/<suite>-ascendrec-programs.md`

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
- `examples/benchmarks-classes/*.json`
- `examples/basic/*.json` (small examples)

Suite definitions:

- `examples/benchmark-suites/pure.json`
- `examples/benchmark-suites/classes.json`
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

## Adding a New Task

1. Add a JSON file to `examples/benchmarks-pure/` or `examples/benchmarks-classes/`
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
