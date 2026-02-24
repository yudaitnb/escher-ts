import { type ArgList, type ComponentImpl, type ComponentSignature, recursiveImpl } from "../../components/component.js";
import { componentTerm, showTerm, type Term, varTerm } from "../../types/term.js";
import { fixVars, type Type } from "../../types/type.js";
import { equalTermValue, type ExtendedValue, type TermValue, valueError } from "../../types/value.js";
import {
  divideNumberAsSum,
  forEachCartesianProduct,
  isGoalOrBoolType,
  isInterestingSignature,
  notAllErr,
  type IndexValueMap,
  typesForCosts,
} from "../common/core.js";
import { createDeadline, isTimedOut } from "../common/config.js";
import { sortExamples } from "../escher/example-order.js";
import { AscendRecGoalSearch } from "./goal-search.js";
import { fromImplOnTermValue } from "./extended-component.js";
import { createKnownMapRecursiveComponent } from "./known-map-recursive.js";
import { AscendRecState } from "./state.js";
import { type AscendRecConfig, defaultAscendRecConfig, type AscendRecExample, type AscendRecSynthesisResult } from "./types.js";
import type {
  AscendRecDiagnostics,
  AscendRecGoalSearchDiagnostics,
  AscendRecLevelDiagnostics,
  AscendRecPhaseStats,
} from "./types.js";

interface CandidateEntry {
  readonly term: import("../../types/term.js").Term;
  readonly valueVector: readonly ExtendedValue[];
}

export class AscendRecSynthesizer {
  constructor(private readonly config: Partial<AscendRecConfig> = {}) {}

  private mergedConfig(): AscendRecConfig {
    return { ...defaultAscendRecConfig, ...this.config };
  }

  synthesize(
    name: string,
    inputTypesFree: readonly Type[],
    inputNames: readonly string[],
    returnTypeFree: Type,
    envComps: ReadonlyMap<string, ComponentImpl>,
    examples0: readonly AscendRecExample[],
    compReductionRules: ReadonlyMap<string, (args: readonly Term[]) => boolean> = new Map(),
  ): AscendRecSynthesisResult | null {
    const config = this.mergedConfig();
    const deadlineMs = createDeadline(config.timeoutMs);
    const timedOut = (): boolean => isTimedOut(deadlineMs);

    const emptyPhase = (): AscendRecPhaseStats => ({
      implVisited: 0,
      resolvedSignatures: 0,
      productsEvaluated: 0,
      registeredNonRec: 0,
      registeredRec: 0,
      prunedAllErr: 0,
    });
    const levels: AscendRecLevelDiagnostics[] = [];
    const goalSearchDiag: AscendRecGoalSearchDiagnostics = {
      searchCalls: 0,
      knownHits: 0,
      recExactHits: 0,
      recPossibleChecks: 0,
      recPossibleHits: 0,
      splitAttempts: 0,
      splitSuccesses: 0,
      thenRecCandidatesChecked: 0,
      thenRecCandidatesAccepted: 0,
    };
    const buildDiagnostics = (status: AscendRecDiagnostics["status"]): AscendRecDiagnostics => ({
      status,
      levels,
      goalSearch: goalSearchDiag,
    });
    const reportDiagnostics = (status: AscendRecDiagnostics["status"]): void => {
      config.onDiagnostics?.(buildDiagnostics(status));
    };

    if (timedOut()) {
      reportDiagnostics("timeout");
      return null;
    }

    const examples = sortExamples(examples0);
    const inputs = examples.map(([args]) => args);
    const outputs = examples.map(([, out]) => out);

    const inputTypes = inputTypesFree.map((type) => fixVars(type));
    const goalReturnType = fixVars(returnTypeFree);

    const signature: ComponentSignature = {
      name,
      argNames: inputNames,
      inputTypes,
      returnType: goalReturnType,
    };

    const activeReductionRules = (() => {
      if (!config.useReductionRules) {
        return new Map<string, (args: readonly Term[]) => boolean>();
      }
      const merged = new Map<string, (args: readonly Term[]) => boolean>();
      for (const impl of envComps.values()) {
        if (impl.isReducible !== null) {
          merged.set(impl.name, impl.isReducible);
        }
      }
      for (const [name, rule] of compReductionRules.entries()) {
        merged.set(name, rule);
      }
      return merged;
    })();
    const state = new AscendRecState(outputs.length, goalReturnType, activeReductionRules);
    const interestingSignature = isInterestingSignature(goalReturnType, inputTypes);

    const recursiveComp = createKnownMapRecursiveComponent(name, inputTypes, goalReturnType, examples);
    const envExtended = [...envComps.values()].map((impl) =>
      fromImplOnTermValue(
        impl.name,
        impl.inputTypes,
        impl.returnType,
        (args) => impl.executeEfficient(args),
        !config.useReductionRules
          ? null
          : (compReductionRules.get(impl.name) ?? impl.isReducible),
      ),
    );
    const compSet = [...envExtended, recursiveComp];

    const argDecrease = (arg: ArgList, exampleId: number): boolean => config.argListCompare(arg, inputs[exampleId]!);
    const recursiveInvariantOk = (arg: ArgList, exampleId: number): boolean => {
      for (const idx of config.recursiveInvariantArgIndices) {
        if (idx < 0 || idx >= arg.length || idx >= inputs[exampleId]!.length) {
          return false;
        }
        if (!equalTermValue(arg[idx]!, inputs[exampleId]![idx]!)) {
          return false;
        }
      }
      return true;
    };

    state.openNextLevel(1);
    inputTypes.forEach((type, argIndex) => {
      const valueVector = inputs.map((args) => args[argIndex]!);
      state.registerNonRecAtLevel(1, type, varTerm(inputNames[argIndex]!), valueVector);
    });

    const synthesizeAtCost = (cost: number, synBoolAndReturnType: boolean): boolean => {
      if (timedOut()) {
        return false;
      }
      const levelDiag = levels[cost - 1] ?? {
        level: cost,
        related: emptyPhase(),
        unrelated: emptyPhase(),
        returnTermsCount: 0,
        boolTermsCount: 0,
        recReturnTermsCount: 0,
        returnTermSamples: [],
        boolTermSamples: [],
        recReturnTermSamples: [],
      };
      levels[cost - 1] = levelDiag;
      const phase = synBoolAndReturnType ? levelDiag.related : levelDiag.unrelated;

      state.openNextLevel(cost);
      const partitionCache = new Map<string, readonly number[][]>();
      for (const impl of compSet) {
        phase.implVisited += 1;
        if (timedOut()) {
          return false;
        }
        const compCost = 1;
        if (compCost > cost) {
          continue;
        }
        const arity = impl.inputTypes.length;
        const costLeft = cost - compCost;
        const isRecCall = impl.name === name;

        if (arity === 0) {
          if (cost !== compCost) {
            continue;
          }
          const result = impl.execute([]);
          if (result.tag === "unknown") {
            continue;
          }
          const valueVector = outputs.map(() => result);
          if (!config.deleteAllErr || notAllErr(valueVector)) {
            state.registerNonRecAtLevel(cost, impl.returnType, componentTerm(impl.name, []), valueVector);
          }
          continue;
        }

        const partitionKey = `${arity}:${costLeft}`;
        const partitions = partitionCache.get(partitionKey) ?? divideNumberAsSum(costLeft, arity, 1);
        partitionCache.set(partitionKey, partitions);
        for (const costs of partitions) {
          if (timedOut()) {
            return false;
          }
          const resolvedSignatures = typesForCosts(
            (c) => [...state.nonRecTypeSetOfCost(c), ...state.recTypeSetOfCost(c)],
            costs,
            impl.inputTypes,
            impl.returnType,
          ).filter((sig) => synBoolAndReturnType === isGoalOrBoolType(goalReturnType, sig[1]));
          phase.resolvedSignatures += resolvedSignatures.length;

          for (const [argTypes, resolvedReturnType] of resolvedSignatures) {
            if (!interestingSignature(argTypes, resolvedReturnType)) {
              continue;
            }

            const nonRecCandidates = argTypes.map((argType, idx) => state.nonRecEntriesOfCostAndType(costs[idx]!, argType));
            if (isRecCall) {
              if (nonRecCandidates.some((c) => c.length === 0)) {
                continue;
              }

              const completed = forEachCartesianProduct(nonRecCandidates, (product) => {
                phase.productsEvaluated += 1;
                if (timedOut()) {
                  return false;
                }
                const termArgs = product.map((entry) => entry.term);
                const term = componentTerm(impl.name, termArgs);
                const valueVector = outputs.map((_, exId) => {
                  const args = product.map((entry) => entry.valueVector[exId]!);
                  if (config.enforceDecreasingMeasure && !argDecrease(args, exId)) {
                    return valueError;
                  }
                  if (!recursiveInvariantOk(args, exId)) {
                    return valueError;
                  }
                  return impl.execute(args);
                });

                if (config.deleteAllErr && !notAllErr(valueVector)) {
                  phase.prunedAllErr += 1;
                  return true;
                }
                const added = state.registerTermAtLevel(cost, resolvedReturnType, term, valueVector);
                if (added) {
                  const hasUnknown = valueVector.some((v) => v.tag === "unknown");
                  if (hasUnknown) {
                    phase.registeredRec += 1;
                  } else {
                    phase.registeredNonRec += 1;
                  }
                }
                return true;
              });
              if (!completed) {
                return false;
              }
              continue;
            }

            const recCandidates = argTypes.map((argType, idx) => state.recEntriesOfCostAndType(costs[idx]!, argType));
            const allCandidates: readonly (readonly CandidateEntry[])[] = nonRecCandidates.map((nonRec, idx) => {
              const rec = recCandidates[idx] ?? [];
              return [...nonRec, ...rec];
            });
            if (allCandidates.some((c) => c.length === 0)) {
              continue;
            }

            const completed = forEachCartesianProduct(allCandidates, (product) => {
              phase.productsEvaluated += 1;
              if (timedOut()) {
                return false;
              }
              const termArgs = product.map((entry) => entry.term);
              const term = componentTerm(impl.name, termArgs);
              const valueVector = outputs.map((_, exId) => {
                const args = product.map((entry) => entry.valueVector[exId]!);
                return impl.execute(args);
              });

              if (config.deleteAllErr && !notAllErr(valueVector)) {
                phase.prunedAllErr += 1;
                return true;
              }
              const added = state.registerTermAtLevel(cost, resolvedReturnType, term, valueVector);
              if (added) {
                const hasUnknown = valueVector.some((v) => v.tag === "unknown");
                if (hasUnknown) {
                  phase.registeredRec += 1;
                } else {
                  phase.registeredNonRec += 1;
                }
              }
              return true;
            });
            if (!completed) {
              return false;
            }
          }
        }
      }
      return true;
    };

    const goalVM: IndexValueMap = new Map(outputs.map((value, index) => [index, value]));
    const validateBody = (body: Term): boolean => {
      const impl = recursiveImpl(signature, envComps, config.argListCompare, body, {
        enforceDecreasingMeasure: config.enforceDecreasingMeasure,
        invariantArgIndices: config.recursiveInvariantArgIndices,
      });
      return examples.every(([args, expected]) => equalTermValue(impl.executeEfficient(args), expected));
    };

    for (let level = 1; level <= config.maxCost; level += 1) {
      if (!synthesizeAtCost(level, true)) {
        reportDiagnostics(timedOut() ? "timeout" : "exhausted");
        return null;
      }
      if (timedOut()) {
        reportDiagnostics("timeout");
        return null;
      }

      state.createLibrariesForThisLevel(level);
      const levelDiag = levels[level - 1];
      if (levelDiag !== undefined) {
        const returnTerms = state.termsOfCost(level);
        const boolTerms = state.nonRecBoolTerms(level);
        const recTerms = state.recTermsOfReturnType(level);
        levelDiag.returnTermsCount = returnTerms.length;
        levelDiag.boolTermsCount = boolTerms.length;
        levelDiag.recReturnTermsCount = recTerms.length;
        levelDiag.returnTermSamples = returnTerms.slice(0, 8).map(([, term]) => showTerm(term));
        levelDiag.boolTermSamples = boolTerms.slice(0, 8).map(([, term]) => showTerm(term));
        levelDiag.recReturnTermSamples = recTerms.slice(0, 8).map(([term]) => showTerm(term));
      }
      const directHit = state.exactKnownGoalHit(level, outputs);
      if (directHit !== null && validateBody(directHit)) {
        const diagnostics = buildDiagnostics("success");
        config.onDiagnostics?.(diagnostics);
        return {
          program: {
            signature,
            body: directHit,
            cost: level,
            depth: level,
          },
          state,
          diagnostics,
        };
      }

      if (!config.onlyForwardSearch) {
        const termsWithKnownVV = Array.from({ length: level }, (_, idx) => state.termsOfCost(idx + 1));
        const nonRecBoolTerms = Array.from({ length: level }, (_, idx) => state.nonRecBoolTerms(idx + 1));
        const recTerms = Array.from({ length: level }, (_, idx) => state.recTermsOfReturnType(idx + 1));

        const search = new AscendRecGoalSearch(
          level,
          signature,
          envComps,
          config.argListCompare,
          config.enforceDecreasingMeasure,
          config.recursiveInvariantArgIndices,
          inputs,
          termsWithKnownVV,
          nonRecBoolTerms,
          timedOut,
          goalSearchDiag,
          config.goalSearchStrategy,
        );
        const searchResult = search.searchMin(
          config.searchSizeFactor * level,
          goalVM,
          recTerms,
          (t) => t,
          true,
        );
        if (searchResult !== null && validateBody(searchResult[1])) {
          const [cost, body] = searchResult;
          const diagnostics = buildDiagnostics("success");
          config.onDiagnostics?.(diagnostics);
          return {
            program: {
              signature,
              body,
              cost,
              depth: level,
            },
            state,
            diagnostics,
          };
        }
      }

      if (!synthesizeAtCost(level, false)) {
        reportDiagnostics(timedOut() ? "timeout" : "exhausted");
        return null;
      }
      if (timedOut()) {
        reportDiagnostics("timeout");
        return null;
      }
    }

    reportDiagnostics(timedOut() ? "timeout" : "exhausted");
    return null;
  }
}
