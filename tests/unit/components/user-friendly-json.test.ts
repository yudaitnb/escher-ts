import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  parseJsonSynthesisSpec,
  parseTypeSpec,
  prepareJsonSynthesisJob,
  prepareJsonSynthesisSpec,
} from "../../../src/components/user-friendly-json.js";
import { tyBool, tyInt, tyList, tyObject, tyPair, tyRef } from "../../../src/types/type.js";
import { valueBool, valueError, valueInt, valueList, valueObject, valueRef } from "../../../src/types/value.js";

describe("user-friendly JSON spec", () => {
  it("parses and prepares calculator-like spec", () => {
    const spec = parseJsonSynthesisSpec(`{
      "name": "calc",
      "components": [
        { "name": "add", "kind": "intBinary", "op": "add" },
        { "name": "mul", "kind": "intBinary", "op": "mul" },
        { "name": "constTwo", "kind": "intConst", "value": 2 }
      ],
      "examples": [
        [[1, 3], 5],
        [[2, 5], 9]
      ]
    }`);

    const prepared = prepareJsonSynthesisSpec(spec);
    expect(prepared.name).toBe("calc");
    expect(prepared.env.get("constTwo")?.executeEfficient([])).toEqual(valueInt(2));
    expect(prepared.env.get("add")?.executeEfficient([valueInt(4), valueInt(5)])).toEqual(valueInt(9));
    expect(prepared.examples).toHaveLength(2);
  });

  it("throws for unknown op", () => {
    const spec = parseJsonSynthesisSpec(`{
      "components": [{ "name": "oops", "kind": "intBinary", "op": "pow" }],
      "examples": []
    }`);
    expect(() => prepareJsonSynthesisSpec(spec)).toThrowError(/must be one of/);
  });

  it("builds a full synthesis job from explicit signature", () => {
    const spec = parseJsonSynthesisSpec(`{
      "name": "calc",
      "signature": {
        "inputNames": ["x", "y"],
        "inputTypes": ["Int", "Int"],
        "returnType": "Int"
      },
      "components": [
        { "name": "add", "kind": "intBinary", "op": "add" },
        { "name": "mul", "kind": "intBinary", "op": "mul" },
        { "name": "constTwo", "kind": "intConst", "value": 2 }
      ],
      "examples": [
        [[1, 3], 5],
        [[2, 5], 9]
      ]
    }`);
    const job = prepareJsonSynthesisJob(spec);
    expect(job.functionName).toBe("calc");
    expect(job.inputNames).toEqual(["x", "y"]);
    expect(job.inputTypes).toEqual([tyInt, tyInt]);
    expect(job.returnType).toEqual(tyInt);
    expect(job.oracle([valueInt(1), valueInt(3)])).toEqual(valueInt(5));
    expect(job.oracle([valueInt(9), valueInt(9)])).toEqual(valueError);
  });

  it("parses nested type expressions", () => {
    expect(parseTypeSpec("Int")).toEqual(tyInt);
    expect(parseTypeSpec("List[Int]")).toEqual(tyList(tyInt));
    expect(parseTypeSpec("Pair[Int, List[Int]]")).toEqual(tyPair(tyInt, tyList(tyInt)));
    expect(parseTypeSpec("Ref[Int]")).toEqual(tyRef(tyInt));
  });

  it("supports explicit oracle table", () => {
    const spec = parseJsonSynthesisSpec(`{
      "name": "id",
      "signature": {
        "inputNames": ["x"],
        "inputTypes": ["Int"],
        "returnType": "Int"
      },
      "oracle": {
        "kind": "table",
        "entries": [
          [[1], 10],
          [[2], 20]
        ],
        "default": "error"
      },
      "components": [{ "name": "zero", "kind": "intConst", "value": 0 }],
      "examples": [[[1], 1]]
    }`);
    const job = prepareJsonSynthesisJob(spec);
    expect(job.oracle([valueInt(1)])).toEqual(valueInt(10));
    expect(job.oracle([valueInt(2)])).toEqual(valueInt(20));
    expect(job.oracle([valueInt(9)])).toEqual(valueError);
  });

  it("supports js oracle", () => {
    const spec = parseJsonSynthesisSpec(`{
      "name": "calc",
      "signature": {
        "inputNames": ["x", "y"],
        "inputTypes": ["Int", "Int"],
        "returnType": "Int"
      },
      "oracle": {
        "kind": "js",
        "args": ["x", "y"],
        "body": "return x * 2 + y;"
      },
      "components": [{ "name": "zero", "kind": "intConst", "value": 0 }],
      "examples": [[[1, 3], 5]]
    }`);
    const job = prepareJsonSynthesisJob(spec);
    expect(job.oracle([valueInt(3), valueInt(4)])).toEqual(valueInt(10));
  });

  it("auto-fills js oracle args from auto-expanded class signature", () => {
    const spec = parseJsonSynthesisSpec(`{
      "name": "classOracleAutoArgs",
      "classes": [
        {
          "name": "Point",
          "fields": {
            "x": "Ref[Int]",
            "y": "Ref[Int]"
          }
        }
      ],
      "signature": {
        "returnType": "Int",
        "autoExpandClassSignature": {
          "className": "Point",
          "includeThisRef": false
        }
      },
      "oracle": {
        "kind": "js",
        "body": "if (!Array.isArray(pointHeap) || pointHeap.length <= 1) return 'error'; const p = pointHeap[1]; if (!p || typeof p !== 'object' || !('object' in p)) return 'error'; const x = p.object.fields.x; if (!x || typeof x !== 'object' || typeof x.ref !== 'number') return 'error'; if (x.ref < 0 || x.ref >= xHeap.length) return 'error'; return xHeap[x.ref];"
      },
      "components": [],
      "examples": [
        [[
          [
            { "object": { "className": "Point", "fields": { "x": { "ref": 0 }, "y": { "ref": 1 } } } },
            { "object": { "className": "Point", "fields": { "x": { "ref": 1 }, "y": { "ref": 0 } } } }
          ],
          [10, 20],
          [30, 40]
        ], 20]
      ]
    }`);
    const job = prepareJsonSynthesisJob(spec);
    const [args, out] = job.examples[0]!;
    expect(job.oracle(args)).toEqual(out);
  });

  it("supports componentsPreset + componentRef oracle + error literal", () => {
    const spec = parseJsonSynthesisSpec(`{
      "name": "lastInList",
      "componentsPreset": "lastInList",
      "signature": {
        "inputNames": ["xs"],
        "inputTypes": ["List[Int]"],
        "returnType": "Int"
      },
      "oracle": { "kind": "componentRef", "name": "lastInList" },
      "components": [],
      "examples": [
        [[[]], {"error": true}],
        [[[1, 2, 3]], 3]
      ]
    }`);

    const prepared = prepareJsonSynthesisSpec(spec);
    expect(prepared.examples[0]?.[1]).toEqual(valueError);

    const job = prepareJsonSynthesisJob(spec);
    expect(job.oracle([valueList([valueInt(1)])])).toEqual(valueInt(1));
  });

  it("supports class definitions with constructor/field/method components", () => {
    const spec = parseJsonSynthesisSpec(`{
      "name": "pointTask",
      "classes": [
        {
          "name": "Point",
          "fields": { "x": "Int", "y": "Int" },
          "methods": [
            {
              "name": "moveX",
              "args": { "dx": "Int" },
              "returnType": "Point",
              "bodyJs": "return { object: { className: 'Point', fields: { x: this.x + dx, y: this.y } } };"
            },
            {
              "name": "moveXViaThisCall",
              "args": { "dx": "Int" },
              "returnType": "Point",
              "bodyJs": "return this.moveX(dx);"
            }
          ]
        }
      ],
      "signature": {
        "inputNames": ["x"],
        "inputTypes": ["Int"],
        "returnType": "Point"
      },
      "components": [],
      "examples": [
        [[1], { "object": { "className": "Point", "fields": { "x": 1, "y": 0 } } }]
      ]
    }`);
    const prepared = prepareJsonSynthesisSpec(spec);
    expect(prepared.env.get("new_Point")).toBeDefined();
    expect(prepared.env.get("Point_x")).toBeDefined();
    expect(prepared.env.get("Point_moveX")).toBeDefined();
    expect(prepared.env.get("Point_moveXViaThisCall")).toBeDefined();

    const ctor = prepared.env.get("new_Point")!;
    const p = ctor.executeEfficient([valueInt(3), valueInt(4)]);
    expect(p).toEqual(valueObject("Point", { x: valueInt(3), y: valueInt(4) }));
    const moveX = prepared.env.get("Point_moveX")!;
    const moveXViaThisCall = prepared.env.get("Point_moveXViaThisCall")!;
    expect(moveX.executeEfficient([p, valueInt(5)])).toEqual(
      valueObject("Point", { x: valueInt(8), y: valueInt(4) }),
    );
    expect(moveXViaThisCall.executeEfficient([p, valueInt(5)])).toEqual(
      valueObject("Point", { x: valueInt(8), y: valueInt(4) }),
    );

    const job = prepareJsonSynthesisJob(spec);
    expect(job.returnType).toEqual(tyObject("Point"));
  });

  it("can keep class types without exposing auto-generated class components", () => {
    const spec = parseJsonSynthesisSpec(`{
      "name": "typedOnly",
      "classes": [{ "name": "Node", "fields": { "next": "Int" } }],
      "exposeClassComponents": false,
      "signature": {
        "inputNames": ["x"],
        "inputTypes": ["Node"],
        "returnType": "Node"
      },
      "components": [],
      "examples": [
        [[{ "object": { "className": "Node", "fields": { "next": 0 } }}], { "object": { "className": "Node", "fields": { "next": 0 } }}]
      ]
    }`);
    const prepared = prepareJsonSynthesisSpec(spec);
    expect(prepared.env.get("new_Node")).toBeUndefined();
    const job = prepareJsonSynthesisJob(spec);
    expect(job.inputTypes).toEqual([tyObject("Node")]);
  });

  it("prepares the basic DLList next task with Ref-typed links", () => {
    const jsonPath = resolve(process.cwd(), "examples/benchmarks-dllist/nextRef.json");
    const spec = parseJsonSynthesisSpec(readFileSync(jsonPath, "utf8"));
    const job = prepareJsonSynthesisJob(spec);
    expect(job.inputTypes).toEqual([
      tyRef(tyObject("DLNode")),
      tyList(tyObject("DLNode")),
      tyList(tyInt),
      tyList(tyObject("DLNode")),
      tyList(tyObject("DLNode")),
    ]);
    expect(job.returnType).toEqual(tyRef(tyObject("DLNode")));
    const [firstInput, firstOutput] = job.examples[0]!;
    expect(job.oracle(firstInput)).toEqual(firstOutput);
  });

  it("auto-generates class field access components from class + signature", () => {
    const spec = parseJsonSynthesisSpec(`{
      "name": "dummy",
      "classes": [
        {
          "name": "DLNode",
          "fields": {
            "value": "Ref[Int]",
            "next": "Ref[DLNode]",
            "prev": "Ref[DLNode]"
          }
        }
      ],
      "exposeClassComponents": false,
      "autoClassFieldComponents": true,
      "signature": {
        "inputNames": ["thisRef", "nodeHeap", "valueHeap", "nextHeap", "prevHeap"],
        "inputTypes": ["Ref[DLNode]", "List[DLNode]", "List[Int]", "List[DLNode]", "List[DLNode]"],
        "returnType": "Ref[DLNode]"
      },
      "components": [],
      "examples": [[
        [
          { "ref": 0 },
          [
            { "object": { "className": "DLNode", "fields": { "value": { "ref": 0 }, "next": { "ref": 1 }, "prev": { "ref": -1 } } } },
            { "object": { "className": "DLNode", "fields": { "value": { "ref": 1 }, "next": { "ref": -1 }, "prev": { "ref": 0 } } } }
          ],
          [10, 20],
          [
            { "object": { "className": "DLNode", "fields": { "value": { "ref": 0 }, "next": { "ref": 1 }, "prev": { "ref": -1 } } } },
            { "object": { "className": "DLNode", "fields": { "value": { "ref": 1 }, "next": { "ref": -1 }, "prev": { "ref": 0 } } } }
          ],
          [
            { "object": { "className": "DLNode", "fields": { "value": { "ref": 0 }, "next": { "ref": 1 }, "prev": { "ref": -1 } } } },
            { "object": { "className": "DLNode", "fields": { "value": { "ref": 1 }, "next": { "ref": -1 }, "prev": { "ref": 0 } } } }
          ]
        ],
        { "ref": 1 }
      ]]
    }`);

    const job = prepareJsonSynthesisJob(spec);
    expect(job.env.get("nextOf")).toBeDefined();
    expect(job.env.get("prevOf")).toBeDefined();
    expect(job.env.get("valueOf")).toBeDefined();
    expect(job.env.get("valueRefOf")).toBeUndefined();
    expect(job.env.get("hasNext")).toBeDefined();
    expect(job.env.get("hasPrev")).toBeDefined();
    expect(job.env.get("hasValue")).toBeDefined();
    expect(job.env.get("nextOf")?.inputTypes.length).toBe(3);
    expect(job.env.get("prevOf")?.inputTypes.length).toBe(3);
    expect(job.env.get("valueOf")?.inputTypes.length).toBe(3);
    expect(job.env.get("hasNext")?.inputTypes.length).toBe(3);
    expect(job.env.get("hasPrev")?.inputTypes.length).toBe(3);
    expect(job.env.get("hasValue")?.inputTypes.length).toBe(3);

    const [args] = job.examples[0]!;
    expect(job.env.get("nextOf")?.executeEfficient(args)).toEqual(valueRef(1));
    expect(job.env.get("prevOf")?.executeEfficient(args)).toEqual(valueRef(-1));
    expect(job.env.get("valueOf")?.executeEfficient(args)).toEqual(valueRef(0));
    expect(job.env.get("hasNext")?.executeEfficient(args)).toEqual(valueBool(true));
    expect(job.env.get("hasPrev")?.executeEfficient(args)).toEqual(valueBool(false));
    expect(job.env.get("hasValue")?.executeEfficient(args)).toEqual(valueBool(true));

    const nullThisArgs = [valueRef(-1), args[1]!, args[2]!, args[3]!, args[4]!];
    expect(job.env.get("nextOf")?.executeEfficient(nullThisArgs)).toEqual(valueRef(-1));
  });

  it("auto-expands class signatures and default invariant args", () => {
    const spec = parseJsonSynthesisSpec(`{
      "name": "autoSig",
      "classes": [
        {
          "name": "DLNode",
          "fields": {
            "value": "Ref[Int]",
            "next": "Ref[DLNode]",
            "prev": "Ref[DLNode]"
          }
        }
      ],
      "exposeClassComponents": false,
      "signature": {
        "returnType": "Bool",
        "args": [
          { "name": "target", "type": "Int", "immutable": true }
        ],
        "autoExpandClassSignature": {
          "className": "DLNode",
          "thisRefName": "thisRef",
          "classHeapName": "nodeHeap",
          "fieldHeapNames": {
            "value": "valueHeap",
            "next": "nextHeap",
            "prev": "prevHeap"
          }
        }
      },
      "components": [],
      "examples": [
        [[{"ref": -1}, [], [], [], [], 0], false]
      ]
    }`);

    const job = prepareJsonSynthesisJob(spec);
    expect(job.inputNames).toEqual(["thisRef", "nodeHeap", "valueHeap", "nextHeap", "prevHeap", "target"]);
    expect(job.inputTypes).toEqual([
      tyRef(tyObject("DLNode")),
      tyList(tyObject("DLNode")),
      tyList(tyInt),
      tyList(tyObject("DLNode")),
      tyList(tyObject("DLNode")),
      tyInt,
    ]);
    expect(job.returnType).toEqual(tyBool);
    expect(job.recursiveInvariantArgIndices).toEqual([1, 2, 3, 4, 5]);
  });

  it("implicitly auto-expands class signature when only returnType is provided", () => {
    const spec = parseJsonSynthesisSpec(`{
      "name": "autoSigDefaults",
      "classes": [
        {
          "name": "DLNode",
          "fields": {
            "value": "Ref[Int]",
            "next": "Ref[DLNode]",
            "prev": "Ref[DLNode]"
          }
        }
      ],
      "exposeClassComponents": false,
      "signature": {
        "returnType": "Bool"
      },
      "components": [],
      "examples": [
        [[{"ref": -1}, [], [], [], []], false]
      ]
    }`);

    const job = prepareJsonSynthesisJob(spec);
    expect(job.inputNames).toEqual(["thisRef", "nodeHeap", "valueHeap", "nextHeap", "prevHeap"]);
    expect(job.inputTypes).toEqual([
      tyRef(tyObject("DLNode")),
      tyList(tyObject("DLNode")),
      tyList(tyInt),
      tyList(tyObject("DLNode")),
      tyList(tyObject("DLNode")),
    ]);
    expect(job.returnType).toEqual(tyBool);
    expect(job.recursiveInvariantArgIndices).toEqual([1, 2, 3, 4]);
  });

  it("emits nextOf with minimal arity when no nextHeap is in signature", () => {
    const spec = parseJsonSynthesisSpec(`{
      "name": "findFirstLike",
      "classes": [
        {
          "name": "DLNode",
          "fields": {
            "value": "Ref[Int]",
            "next": "Ref[DLNode]",
            "prev": "Ref[DLNode]"
          }
        }
      ],
      "exposeClassComponents": false,
      "autoClassFieldComponents": true,
      "signature": {
        "returnType": "Ref[DLNode]",
        "args": [{ "name": "target", "type": "Int" }],
        "autoExpandClassSignature": {
          "className": "DLNode",
          "thisRefName": "thisRef",
          "classHeapName": "nodeHeap",
          "fieldHeapFields": ["value"],
          "fieldHeapNames": { "value": "valueHeap" }
        }
      },
      "components": [],
      "examples": [
        [[{"ref": -1}, [], [], 0], {"ref": -1}]
      ]
    }`);

    const job = prepareJsonSynthesisJob(spec);
    expect(job.inputNames).toEqual(["thisRef", "nodeHeap", "valueHeap", "target"]);
    expect(job.env.get("nextOf")?.inputTypes.length).toBe(2);
    expect(job.env.get("prevOf")?.inputTypes.length).toBe(2);
    expect(job.env.get("valueOf")?.inputTypes.length).toBe(3);
  });

  it("rejects removed additionalArgs under autoExpandClassSignature", () => {
    const spec = parseJsonSynthesisSpec(`{
      "name": "legacyAdditionalArgs",
      "classes": [
        {
          "name": "DLNode",
          "fields": {
            "value": "Ref[Int]",
            "next": "Ref[DLNode]",
            "prev": "Ref[DLNode]"
          }
        }
      ],
      "signature": {
        "returnType": "Ref[DLNode]",
        "autoExpandClassSignature": {
          "additionalArgs": [{ "name": "target", "type": "Int", "invariant": true }]
        }
      },
      "components": [],
      "examples": [
        [[{"ref": -1}, [], [], [], [], 0], {"ref": -1}]
      ]
    }`);
    expect(() => prepareJsonSynthesisJob(spec)).toThrowError(
      /autoExpandClassSignature\.additionalArgs is removed; use signature\.args instead/,
    );
  });

  it("rejects removed signature.args[].invariant", () => {
    const spec = parseJsonSynthesisSpec(`{
      "name": "legacyInvariant",
      "classes": [
        {
          "name": "DLNode",
          "fields": {
            "value": "Ref[Int]",
            "next": "Ref[DLNode]",
            "prev": "Ref[DLNode]"
          }
        }
      ],
      "signature": {
        "returnType": "Ref[DLNode]",
        "args": [{ "name": "target", "type": "Int", "invariant": true }]
      },
      "components": [],
      "examples": [
        [[{"ref": -1}, [], [], [], [], 0], {"ref": -1}]
      ]
    }`);

    expect(() => prepareJsonSynthesisJob(spec)).toThrowError(
      /signature\.args\[\]\.invariant is removed; use signature\.args\[\]\.immutable instead/,
    );
  });

  it("infers class heap invariants without recursiveInvariantArgNames", () => {
    const spec = parseJsonSynthesisSpec(`{
      "name": "inferInvariant",
      "classes": [
        {
          "name": "DLNode",
          "fields": {
            "value": "Ref[Int]",
            "next": "Ref[DLNode]",
            "prev": "Ref[DLNode]"
          }
        }
      ],
      "exposeClassComponents": false,
      "signature": {
        "inputNames": ["thisRef", "nodeHeap", "valueHeap", "nextHeap", "prevHeap", "target"],
        "inputTypes": ["Ref[DLNode]", "List[DLNode]", "List[Int]", "List[DLNode]", "List[DLNode]", "Int"],
        "returnType": "Ref[DLNode]"
      },
      "components": [],
      "examples": [
        [[{"ref": -1}, [], [], [], [], 0], {"ref": -1}]
      ]
    }`);

    const job = prepareJsonSynthesisJob(spec);
    expect(job.recursiveInvariantArgIndices).toEqual([1, 2, 3, 4]);
  });

  it("injects implicit helper components for JSON synthesis", () => {
    const spec = parseJsonSynthesisSpec(`{
      "name": "implicitHelpers",
      "signature": {
        "inputNames": ["xs", "r"],
        "inputTypes": ["List[Int]", "Ref[Int]"],
        "returnType": "Int"
      },
      "components": [],
      "examples": [
        [[[10, 20], {"ref": 1}], 20]
      ]
    }`);

    const job = prepareJsonSynthesisJob(spec);
    expect(job.env.get("falseConst")?.executeEfficient([])).toEqual(valueBool(false));
    expect(job.env.get("trueConst")?.executeEfficient([])).toEqual(valueBool(true));
    expect(job.env.get("leInt")?.executeEfficient([valueInt(1), valueInt(2)])).toEqual(valueBool(true));
    expect(job.env.get("loadInt")?.executeEfficient([valueList([valueInt(10), valueInt(20)]), valueRef(1)])).toEqual(
      valueInt(20),
    );
  });
});
