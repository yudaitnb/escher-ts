import {
  type ArgList,
  type ArgListCompare,
  ComponentImpl,
  type ComponentSignature,
  recursiveImpl,
} from "../../components/component.js";
import { componentTerm, executeTerm, ifTerm, type Term } from "../../types/term.js";
import { type ExtendedValue, equalTermValue, type TermValue, valueError } from "../../types/value.js";
import {
  matchVector,
  matchWithIndexValueMap,
  splitGoal,
  type IndexValueMap,
  type ValueVector,
} from "../common/core.js";
import type { AscendRecGoalSearchDiagnostics } from "./types.js";

type ExtendedValueVec = readonly ExtendedValue[];
const HOLE_EVAL = Symbol("hole-eval");
type ThenUnknownEval = TermValue | typeof HOLE_EVAL | null;

class ExecuteHoleError extends Error {
  constructor() {
    super("ExecuteHole");
    this.name = "ExecuteHoleError";
  }
}

const indexValueMapKey = (vm: IndexValueMap): string => {
  const parts = [...vm.entries()]
    .sort(([a], [b]) => a - b)
    .map(([k, v]) => `${k}:${JSON.stringify(v)}`);
  return parts.join("|");
};

export class AscendRecGoalSearch {
  private readonly envCompMap: ReadonlyMap<string, ComponentImpl>;
  private readonly compMapWithHole: ReadonlyMap<string, ComponentImpl>;
  private readonly varMaps: readonly ReadonlyMap<string, TermValue>[];
  // Scala AscendRecGoalSearch uses no effective memo buffer.
  // Keep this switch explicit for parity-sensitive debugging.
  private readonly useBuffer = false;
  private readonly buffer = new Map<string, readonly [number, Term] | null>();
  private readonly recursiveImplCache = new Map<string, ComponentImpl>();
  private readonly partialRecursiveImplCache = new Map<string, ComponentImpl>();
  private readonly partialEnvCache = new Map<string, ReadonlyMap<string, ComponentImpl>>();
  private readonly recursiveEvalCellCache = new Map<string, TermValue>();
  private readonly thenUnknownEvalCache = new Map<string, ThenUnknownEval>();
  private readonly termSignatureCache = new WeakMap<object, string>();
  private readonly holeName = "__ascendrec_hole__";
  private readonly strategy: "then-first" | "cond-first";

  constructor(
    private readonly maxCompCost: number,
    private readonly signature: ComponentSignature,
    envComps: ReadonlyMap<string, ComponentImpl>,
    private readonly argListCompare: ArgListCompare,
    private readonly enforceDecreasingMeasure: boolean,
    private readonly recursiveInvariantArgIndices: readonly number[],
    private readonly inputVector: readonly ArgList[],
    private readonly termsWithKnownVV: readonly (readonly (readonly [ValueVector, Term])[])[],
    private readonly nonRecBoolTerms: readonly (readonly (readonly [ValueVector, Term])[])[],
    private readonly shouldStop: () => boolean = () => false,
    private readonly diagnostics: AscendRecGoalSearchDiagnostics | null = null,
    strategy: "then-first" | "cond-first" = "then-first",
  ) {
    this.strategy = strategy;
    this.envCompMap = envComps;
    const holeComp = new ComponentImpl(this.holeName, [], this.signature.returnType, () => {
      throw new ExecuteHoleError();
    });
    const withHole = new Map(this.envCompMap);
    withHole.set(this.holeName, holeComp);
    this.compMapWithHole = withHole;
    this.varMaps = inputVector.map((input) => {
      const pairs = signature.argNames.map((name, idx) => [name, input[idx]!] as const);
      return new Map<string, TermValue>(pairs);
    });
  }

  searchMin(
    cost: number,
    currentGoal: IndexValueMap,
    recTermsOfReturnType: readonly (readonly (readonly [Term, ExtendedValueVec])[])[],
    assembleTerm: (term: Term) => Term,
    isFirstBranch: boolean,
    contextKey = "",
  ): readonly [number, Term] | null {
    if (this.diagnostics !== null) {
      this.diagnostics.searchCalls += 1;
    }
    if (this.shouldStop()) {
      return null;
    }
    if (cost <= 0) {
      return null;
    }

    const key = `${indexValueMapKey(currentGoal)}|${cost}|${isFirstBranch ? "first" : "non-first"}|${contextKey}`;
    if (this.useBuffer && this.buffer.has(key)) {
      return this.buffer.get(key)!;
    }

    const buffered = (r: readonly [number, Term] | null): readonly [number, Term] | null => {
      if (this.useBuffer) {
        this.buffer.set(key, r);
      }
      return r;
    };
    const termSignature = (term: Term): string => {
      const keyObj = term as unknown as object;
      const cached = this.termSignatureCache.get(keyObj);
      if (cached !== undefined) {
        return cached;
      }
      const sig = JSON.stringify(term);
      this.termSignatureCache.set(keyObj, sig);
      return sig;
    };
    const recursiveImplFor = (assembledBody: Term): ComponentImpl => {
      const k = termSignature(assembledBody);
      const cached = this.recursiveImplCache.get(k);
      if (cached !== undefined) {
        return cached;
      }
      const impl = recursiveImpl(this.signature, this.envCompMap, this.argListCompare, assembledBody, {
        enforceDecreasingMeasure: this.enforceDecreasingMeasure,
        invariantArgIndices: this.recursiveInvariantArgIndices,
      });
      this.recursiveImplCache.set(k, impl);
      return impl;
    };
    const recursiveEvalAt = (assembledBody: Term, exampleIdx: number): TermValue | null => {
      const bodyKey = termSignature(assembledBody);
      const cacheKey = `${bodyKey}|${exampleIdx}`;
      const cached = this.recursiveEvalCellCache.get(cacheKey);
      if (cached !== undefined) {
        return cached;
      }
      const input = this.inputVector[exampleIdx];
      if (input === undefined) {
        return null;
      }
      if (this.shouldStop()) {
        return null;
      }
      const impl = recursiveImplFor(assembledBody);
      const evaluated = impl.executeEfficient(input);
      this.recursiveEvalCellCache.set(cacheKey, evaluated);
      return evaluated;
    };

    const maxCost = Math.min(this.maxCompCost, cost);
    for (let c = 1; c <= maxCost; c += 1) {
      if (this.shouldStop()) {
        return buffered(null);
      }
      const known = this.termsWithKnownVV[c - 1] ?? [];
      for (const [vv, term] of known) {
        if (this.shouldStop()) {
          return buffered(null);
        }
        if (matchVector(currentGoal, vv)) {
          if (this.diagnostics !== null) {
            this.diagnostics.knownHits += 1;
          }
          return buffered([c, term]);
        }
      }

      if (!isFirstBranch) {
        const recs = recTermsOfReturnType[c - 1] ?? [];
        for (const [term, evec] of recs) {
          if (this.shouldStop()) {
            return buffered(null);
          }
          const match = matchWithIndexValueMap(evec, currentGoal);
          if (match.kind === "exactMatch") {
            if (this.diagnostics !== null) {
              this.diagnostics.recExactHits += 1;
            }
            return buffered([c, term]);
          }
          if (match.kind === "possibleMatch") {
            if (this.diagnostics !== null) {
              this.diagnostics.recPossibleChecks += 1;
            }
            const assembled = assembleTerm(term);
            let ok = true;
            for (const [idx, desired] of match.leftToCheck.entries()) {
              if (this.shouldStop()) {
                return buffered(null);
              }
              const actual = recursiveEvalAt(assembled, idx);
              if (actual === null || !equalTermValue(actual, desired)) {
                ok = false;
                break;
              }
            }
            if (ok) {
              if (this.diagnostics !== null) {
                this.diagnostics.recPossibleHits += 1;
              }
              return buffered([c, term]);
            }
          }
        }
      }
    }

    const ifCost = 1;
    let minCostCandidate: readonly [number, Term] | null = null;

    const maxCondCost = Math.min(this.maxCompCost, cost - ifCost - 2);
    for (let cCond = 1; cCond <= maxCondCost; cCond += 1) {
      const currentBest = minCostCandidate?.[0] ?? Number.POSITIVE_INFINITY;
      // Lower bound: cThen>=1, cElse>=1 => total >= cCond + ifCost + 2
      if (cCond + ifCost + 2 >= currentBest) {
        continue;
      }
      if (this.shouldStop()) {
        return buffered(minCostCandidate);
      }
      const boolTerms = this.nonRecBoolTerms[cCond - 1] ?? [];
      const splitCandidates: Array<{
        tCond: Term;
        thenGoal: IndexValueMap;
        elseGoal: IndexValueMap;
      }> = [];
      for (const [condVec, tCond] of boolTerms) {
        if (this.shouldStop()) {
          return buffered(minCostCandidate);
        }
        const split = splitGoal(condVec as TermValue[], currentGoal);
        if (this.diagnostics !== null) {
          this.diagnostics.splitAttempts += 1;
        }
        if (split === null) {
          continue;
        }
        if (this.diagnostics !== null) {
          this.diagnostics.splitSuccesses += 1;
        }
        const [thenGoal, elseGoal] = split;
        splitCandidates.push({ tCond, thenGoal, elseGoal });
      }
      if (this.strategy === "cond-first") {
        splitCandidates.sort((a, b) => a.elseGoal.size - b.elseGoal.size);
      }
      for (const { tCond, thenGoal, elseGoal } of splitCandidates) {
        if (this.shouldStop()) {
          return buffered(minCostCandidate);
        }

        let thenCandidate: readonly [number, Term] | null = null;
        const branchBest = minCostCandidate?.[0] ?? Number.POSITIVE_INFINITY;
        const maxThenCost = Math.min(
          this.maxCompCost,
          cost - ifCost - cCond - 1,
          branchBest - ifCost - cCond - 2,
        );
        if (maxThenCost < 1) {
          continue;
        }
        for (let cThen = 1; cThen <= maxThenCost; cThen += 1) {
          if (this.shouldStop()) {
            return buffered(minCostCandidate);
          }
          const known = this.termsWithKnownVV[cThen - 1] ?? [];
          for (const [vv, tThen] of known) {
            if (this.shouldStop()) {
              return buffered(minCostCandidate);
            }
            if (matchVector(thenGoal, vv)) {
              thenCandidate = [cThen, tThen];
              break;
            }
          }
          if (thenCandidate !== null) {
            break;
          }

          const recs = recTermsOfReturnType[cThen - 1] ?? [];
          for (const [tThen, thenEVec] of recs) {
            if (this.diagnostics !== null) {
              this.diagnostics.thenRecCandidatesChecked += 1;
            }
            if (this.shouldStop()) {
              return buffered(minCostCandidate);
            }
            const partialBody = assembleTerm(ifTerm(tCond, tThen, componentTerm(this.holeName, [])));
            const partialKey = termSignature(partialBody);
            let partialImpl = this.partialRecursiveImplCache.get(partialKey);
            if (partialImpl === undefined) {
              partialImpl = recursiveImpl(this.signature, this.compMapWithHole, this.argListCompare, partialBody, {
                enforceDecreasingMeasure: this.enforceDecreasingMeasure,
                invariantArgIndices: this.recursiveInvariantArgIndices,
              });
              this.partialRecursiveImplCache.set(partialKey, partialImpl);
            }
            let envWithPartialImpl = this.partialEnvCache.get(partialKey);
            if (envWithPartialImpl === undefined) {
              const env = new Map(this.envCompMap);
              env.set(this.signature.name, partialImpl);
              envWithPartialImpl = env;
              this.partialEnvCache.set(partialKey, envWithPartialImpl);
            }
            const tThenKey = termSignature(tThen);

            let isCandidate = true;
            for (const [idx, desired] of thenGoal.entries()) {
              if (this.shouldStop()) {
                return buffered(minCostCandidate);
              }
              const current = thenEVec[idx];
              if (current === undefined) {
                isCandidate = false;
                break;
              }
              if (current.tag === "unknown") {
                const varMap = this.varMaps[idx];
                if (varMap === undefined) {
                  isCandidate = false;
                  break;
                }
                const evalKey = `${partialKey}|${tThenKey}|${idx}`;
                let evald = this.thenUnknownEvalCache.get(evalKey);
                if (evald === undefined) {
                  try {
                    evald = executeTerm((name) => varMap.get(name) ?? valueError, envWithPartialImpl, tThen);
                  } catch (error) {
                    if (error instanceof ExecuteHoleError) {
                      evald = HOLE_EVAL;
                    } else {
                      throw error;
                    }
                  }
                  this.thenUnknownEvalCache.set(evalKey, evald ?? null);
                }
                if (evald === HOLE_EVAL || evald === null || evald.tag === "error" || !equalTermValue(evald, desired)) {
                  isCandidate = false;
                  break;
                }
              } else if (!equalTermValue(current, desired)) {
                isCandidate = false;
                break;
              }
            }

            if (isCandidate) {
              if (this.diagnostics !== null) {
                this.diagnostics.thenRecCandidatesAccepted += 1;
              }
              thenCandidate = [cThen, tThen];
              break;
            }
          }
          if (thenCandidate !== null) {
            break;
          }
        }
        if (thenCandidate === null) {
          continue;
        }

        const [cThen, tThen] = thenCandidate;
        const fill = (tElse: Term): Term => assembleTerm(ifTerm(tCond, tThen, tElse));
        const costSoFar = cThen + cCond + ifCost;
        const bestNow = minCostCandidate?.[0] ?? Number.POSITIVE_INFINITY;
        const maxCostForElse = Math.min(cost, bestNow - 1) - costSoFar;
        if (maxCostForElse < 1) {
          continue;
        }
        const nextContextKey = `${contextKey}|if:${termSignature(tCond)}:${termSignature(tThen)}`;
        const elseCandidate = this.searchMin(
          maxCostForElse,
          elseGoal,
          recTermsOfReturnType,
          fill,
          false,
          nextContextKey,
        );
        if (elseCandidate === null) {
          continue;
        }
        const [cElse, tElse] = elseCandidate;
        const total = cElse + costSoFar;
        minCostCandidate = [total, ifTerm(tCond, tThen, tElse)];
      }
    }

    return buffered(minCostCandidate);
  }

}
