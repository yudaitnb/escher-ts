import { describe, expect, it } from "vitest";
import { anyArgSmaller, ComponentImpl, type ComponentSignature } from "../../../src/components/component.js";
import { componentTerm, varTerm } from "../../../src/types/term.js";
import { tyBool, tyInt } from "../../../src/types/type.js";
import { valueBool, valueError, valueInt, valueUnknown } from "../../../src/types/value.js";
import { AscendRecGoalSearch } from "../../../src/synthesis/ascendrec/goal-search.js";

describe("ascendrec goal search", () => {
  const signature: ComponentSignature = {
    name: "f",
    argNames: ["x"],
    inputTypes: [tyInt],
    returnType: tyInt,
  };

  it("finds direct known term match", () => {
    const search = new AscendRecGoalSearch(
      3,
      signature,
      new Map(),
      anyArgSmaller,
      true,
      [],
      [[valueInt(1)], [valueInt(2)]],
      [
        [[[valueInt(1), valueInt(2)], varTerm("x")]],
      ],
      [[]],
    );
    const goal = new Map([
      [0, valueInt(1)],
      [1, valueInt(2)],
    ]);
    const r = search.searchMin(3, goal, [[]], (t) => t, true);
    expect(r).not.toBeNull();
    expect(r?.[0]).toBe(1);
    expect(r?.[1]).toEqual(varTerm("x"));
  });

  it("matches recursive partial vectors when first branch is false", () => {
    const search = new AscendRecGoalSearch(
      3,
      signature,
      new Map(),
      anyArgSmaller,
      true,
      [],
      [[valueInt(1)], [valueInt(2)]],
      [[]],
      [[]],
    );
    const goal = new Map([
      [0, valueInt(1)],
      [1, valueInt(2)],
    ]);
    const recTerms = [
      [[varTerm("x"), [valueUnknown, valueUnknown] as const]],
    ] as const;
    const r = search.searchMin(3, goal, recTerms, (t) => t, false);
    expect(r).not.toBeNull();
    expect(r?.[1]).toEqual(varTerm("x"));
  });

  it("builds an if-expression from bool split and known branches", () => {
    const tCond = componentTerm("cond", []);
    const tThen = componentTerm("thenTerm", []);
    const tElse = componentTerm("elseTerm", []);

    const search = new AscendRecGoalSearch(
      2,
      signature,
      new Map(),
      anyArgSmaller,
      true,
      [],
      [[valueInt(1)], [valueInt(2)]],
      [
        [
          [[valueInt(1), valueInt(9)], tThen],
          [[valueInt(8), valueInt(2)], tElse],
        ],
      ],
      [
        [
          [[valueBool(true), valueBool(false)], tCond],
        ],
      ],
    );
    const goal = new Map([
      [0, valueInt(1)],
      [1, valueInt(2)],
    ]);
    const r = search.searchMin(4, goal, [[]], (t) => t, true);
    expect(r).not.toBeNull();
    expect(r?.[0]).toBe(4);
    expect(JSON.stringify(r?.[1])).toContain("\"kind\":\"if\"");
  });

  it("accepts recursive then-branch candidates validated by partial execution", () => {
    const tCond = componentTerm("cond", []);
    const tElse = componentTerm("elseTerm", []);

    const search = new AscendRecGoalSearch(
      2,
      signature,
      new Map(),
      anyArgSmaller,
      true,
      [],
      [[valueInt(1)], [valueInt(2)]],
      [
        [
          [[valueInt(9), valueInt(2)], tElse],
        ],
      ],
      [
        [
          [[valueBool(true), valueBool(false)], tCond],
        ],
      ],
    );
    const goal = new Map([
      [0, valueInt(1)],
      [1, valueInt(2)],
    ]);
    const recTerms = [
      [
        [varTerm("x"), [valueUnknown, valueInt(2)] as const],
      ],
    ] as const;
    const r = search.searchMin(4, goal, recTerms, (t) => t, true);
    expect(r).not.toBeNull();
    expect(JSON.stringify(r?.[1])).toContain("\"kind\":\"if\"");
  });

  it("rejects invalid bool vectors in condition split", () => {
    const search = new AscendRecGoalSearch(
      2,
      signature,
      new Map(),
      anyArgSmaller,
      true,
      [],
      [[valueInt(1)], [valueInt(2)]],
      [[]],
      [
        [
          [[valueInt(1), valueInt(0)], componentTerm("badCond", [])],
        ],
      ],
    );
    const goal = new Map([
      [0, valueInt(1)],
      [1, valueInt(2)],
    ]);
    expect(search.searchMin(3, goal, [[]], (t) => t, true)).toBeNull();
  });

  it("does not reuse cache across different assemble contexts", () => {
    const one = new ComponentImpl("one", [], tyInt, () => valueInt(1));
    const bad = new ComponentImpl("bad", [], tyInt, () => valueError);
    const env = new Map([
      ["one", one],
      ["bad", bad],
    ]);
    const search = new AscendRecGoalSearch(
      1,
      signature,
      env,
      anyArgSmaller,
      true,
      [],
      [[valueInt(0)]],
      [[]],
      [[]],
    );
    const goal = new Map([[0, valueInt(1)]]);
    const recTerms = [
      [[componentTerm("bad", []), [valueUnknown] as const]],
    ] as const;

    const first = search.searchMin(1, goal, recTerms, (t) => t, false, "ctxA");
    expect(first).toBeNull();

    const second = search.searchMin(1, goal, recTerms, () => componentTerm("one", []), false, "ctxB");
    expect(second).not.toBeNull();
  });
});
