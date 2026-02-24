# Component 定義ガイド

このプロジェクトでは、合成タスクを JSON から定義できるようにするため、
コンポーネント API を `src/components/` と `src/library/` に分離しています。

## 1. TypeScript で直接コンポーネントを作る

```ts
import { createComponentEnv, defineComponent, tyInt, valueError, valueInt } from "escher-ts";

const inc = defineComponent({
  name: "inc",
  inputTypes: [tyInt],
  returnType: tyInt,
  impl: (args) => {
    const x = args[0];
    return x?.tag === "int" ? valueInt(x.value + 1) : valueError;
  },
});

const env = createComponentEnv([inc]);
```

## 2. 既存ライブラリを使う

```ts
import { createBenchmarkPresetEnv, createCommonComponentEnv, createCommonComponentEnvByDomain } from "escher-ts";

const fullEnv = createCommonComponentEnv("typed-escher-standard");
const listOnlyEnv = createCommonComponentEnvByDomain("lists");
const reversePreset = createBenchmarkPresetEnv("reverse");
```

## 3. 複数の環境を合成する

```ts
import { mergeComponentEnvs } from "escher-ts";

const merged = mergeComponentEnvs(fullEnv, reversePreset);
```

`mergeComponentEnvs` は重複名があると例外を投げます。

## 4. JSON からコンポーネントを定義する

`src/components/user-friendly-json.ts` は以下の `kind` をサポートします。

- `intConst`
- `intUnary` (`inc|dec|neg|abs|double|square`)
- `intBinary` (`add|sub|mul|max|min`)
- `boolUnary` (`not`)
- `libraryRef`
- `js`

例:

```json
{
  "name": "nextOf",
  "kind": "js",
  "inputTypes": ["List[Object[DLNode]]", "List[Int]", "List[Object[DLNode]]", "List[Object[DLNode]]", "Ref[Object[DLNode]]"],
  "returnType": "Ref[Object[DLNode]]",
  "args": ["nodeHeap", "valueHeap", "nextHeap", "prevHeap", "thisRef"],
  "bodyJs": "/* UserLiteral を返す */"
}
```

## 5. クラス定義との連携

`classes` セクションを JSON に書くと次を自動生成できます。

- `new_<ClassName>`
- `<ClassName>_<fieldName>`
- `<ClassName>_<methodName>`

`exposeClassComponents: false` を指定すると自動生成を止め、型情報だけを使えます。

### `autoClassFieldComponents`（ヒープ参照スタイル向け）

`autoClassFieldComponents: true` を指定すると、以下の形のシグネチャに対して
クラスの `Ref[...]` フィールドアクセス用コンポーネントを自動生成します。

- 先頭引数: `Ref[Class]`（例: `thisRef`）
- どこかの引数: `List[Class]`（例: `nodeHeap`）
- フィールド別ヒープ: `nextHeap`, `prevHeap`, `valueHeap` など（任意、あれば検証に使用）

`DLNode { value: Ref[Int], next: Ref[DLNode], prev: Ref[DLNode] }` の場合、例えば以下が生成されます。

- `nextOf`, `prevOf`, `valueOf`
- `hasNext`, `hasPrev`, `hasValue`（`has<Field>` は全フィールド対象。関数名と同名の場合は衝突回避で生成スキップ）

これにより `benchmarks-dllist` のような JSON で、`nextOf/prevOf/valueOf` の
重複した手書き JS コンポーネント定義を省略できます。

## 6. 再帰呼び出しで「不変引数」を固定する

クラス/ヒープエンコードでは、`*Heap` 引数（クラス本体ヒープ + フィールドヒープ）は
クラス定義から自動的に不変引数として推論されます。
通常、`recursiveInvariantArgNames` を手で書く必要はありません。

必要な場合のみ、`signature` の中で `recursiveInvariantArgNames` を明示指定できます。

```json
{
  "signature": {
    "inputNames": ["thisRef", "nodeHeap", "valueHeap", "target"],
    "inputTypes": ["Ref[DLNode]", "List[DLNode]", "List[Int]", "Int"],
    "returnType": "Ref[DLNode]",
    "recursiveInvariantArgNames": ["nodeHeap", "valueHeap"]
  }
}
```

この指定があると、再帰呼び出しでは上記引数が常に同値であることを強制します。

また、`signature.fixedClassRecursivePattern: true` を使うと、
`thisRef` より後ろの引数を一括で不変引数として扱います。

### `signature.autoExpandClassSignature`（シグネチャ自動展開）

クラス/ヒープ系ベンチマークで `inputNames` / `inputTypes` の重複定義を減らしたい場合は、
`signature.autoExpandClassSignature` を使ってシグネチャを生成できます。

```json
{
  "signature": {
    "returnType": "Ref[DLNode]",
    "autoExpandClassSignature": {
      "className": "DLNode",
      "thisRefName": "thisRef",
      "classHeapName": "nodeHeap",
      "fieldHeapNames": {
        "value": "valueHeap",
        "next": "nextHeap",
        "prev": "prevHeap"
      },
      "additionalArgs": [{ "name": "n", "type": "Int" }]
    }
  }
}
```

この設定で以下が自動生成されます。

- `thisRef: Ref[DLNode]`（`includeThisRef: false` で省略可）
- `nodeHeap: List[DLNode]`
- `valueHeap/nextHeap/prevHeap`（`Ref[...]` フィールドから自動）
- `additionalArgs`

また、`recursiveInvariantArgNames` を省略した場合は、
`classHeap` とフィールドヒープ（および `invariant: true` の追加引数）が既定で不変引数になります。

## 7. 実装ファイルの責務

- `src/components/component.ts`
  - `ComponentImpl` / `defineComponent` / `createComponentEnv`
- `src/components/user-friendly.ts`
  - UserLiteral と TypeScript API の橋渡し
- `src/components/user-friendly-json.ts`
  - JSON spec の parse/prepare
- `src/library/common-comps-*.ts`
  - 共通コンポーネント本体
- `src/library/common-comps-sets.ts`
  - ドメイン別・プリセット別の公開セット
