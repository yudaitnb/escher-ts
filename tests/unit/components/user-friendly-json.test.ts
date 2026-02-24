import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  parseJsonSynthesisSpec,
  parseTypeSpec,
  prepareJsonSynthesisJob,
  prepareJsonSynthesisSpec,
} from "../../../src/components/user-friendly-json.js";
import { tyInt, tyList, tyObject, tyPair, tyRef } from "../../../src/types/type.js";
import { valueError, valueInt, valueList, valueObject } from "../../../src/types/value.js";

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
});
