# Directory Guide

このドキュメントは、現在の `escher-ts` のディレクトリ責務を整理したものです。

## Top-Level

- `src/`
  - 合成器本体と CLI
- `examples/`
  - JSON タスク定義と benchmark suite 定義
- `tests/`
  - unit / integration テスト
- `docs/`
  - 運用ドキュメント
- `web/`
  - GitHub Pages 向けのブラウザ UI（Vite）
- `outputs/`
  - ベンチマーク生成物（SVG/CSV/MD）
- `scripts/`
  - 補助スクリプト（必要時のみ）

## src/

- `src/synthesis/`
  - `escher/`: TypedEscher 実装
  - `ascendrec/`: AscendRec 実装
  - `common/`: 共通探索ユーティリティ
- `src/components/`
  - 低レベル component API と user-friendly API
- `src/library/`
  - 再利用可能コンポーネント群と preset/ドメインセット
- `src/benchmarks/`
  - JSON から benchmark ケースを構築し、harness/report を生成
- `src/cli/`
  - `benchmark:typed-escher` / `benchmark:ascendrec`
- `src/types/`
  - `Type`, `Term`, `Value` の中核表現
- `src/utils/`
  - DSL 等の軽量ユーティリティ

## examples/

- `examples/benchmarks-pure/`
  - リスト・整数・木の pure ベンチマーク JSON
- `examples/benchmarks-dllist/`
  - 参照/ヒープを含む DLList ベンチマーク JSON
- `examples/benchmarks-points/`
  - Point クラス専用の分割ベンチマーク JSON
- `examples/basic/`
  - 小さな入門サンプル JSON
- `examples/benchmark-suites/`
  - 実行対象セット定義
  - `pure.json`
  - `dllist.json`
  - `points.json`
  - `standard.json`（互換用）

## tests/

- `tests/unit/`
  - モジュール単位
- `tests/integration/`
  - エンジン実行・JSON 入力・benchmark 実行
- `tests/helpers/`
  - 共有フィクスチャ

## outputs/

CLI 実行時に以下を生成します。

- `*-runtime.svg`
- `*-runtime.csv`
- `*-programs.md`

## 保守ルール

- ベンチマーク仕様は `examples/` の JSON を唯一の正とする
- 新規タスク追加時は suite JSON も同時更新する
- TS 側に新コンポーネントを追加した場合は `src/library/common-comps-sets.ts` 登録まで行う
