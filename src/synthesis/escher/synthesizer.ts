import {
  ArgList,
  ComponentImpl,
  recursiveImpl,
} from "../../components/component.js";
import { componentTerm, varTerm } from "../../types/term.js";
import { fixVars, instanceOfType, type Type } from "../../types/type.js";
import { equalTermValue, type TermValue, valueError } from "../../types/value.js";
import {
  allErr,
  bucketSignaturesByGoalOrBool,
  cartesianProduct,
  divideNumberAsSum,
  isInterestingSignature,
  valueVectorEquals,
  type IndexValueMap,
  typesForCosts,
} from "../common/core.js";
import { createDeadline, isTimedOut } from "../common/config.js";
import { BatchGoalSearch } from "./goal-search.js";
import { SynthesisState, type ValueVector } from "./state.js";
import { BufferedOracle } from "./buffered-oracle.js";
import { sortExamples } from "./example-order.js";
import { RebootStrategies } from "./reboot-strategies.js";
import {
  defaultTypedEscherConfig,
  type SynthesisData,
  type SynthesisResult,
  type SynthesizedProgram,
  type TypedEscherConfig,
} from "./types.js";

export class TypedEscherSynthesizer {
  constructor(private readonly config: Partial<TypedEscherConfig> = {}) {}

  private mergedConfig(): TypedEscherConfig {
    return { ...defaultTypedEscherConfig, ...this.config };
  }

  synthesize(
    name: string,
    inputTypesFree: readonly Type[],
    inputNames: readonly string[],
    returnTypeFree: Type,
    envComps: ReadonlyMap<string, ComponentImpl>,
    examples0: readonly (readonly [ArgList, TermValue])[],
    oracle: (args: ArgList) => TermValue,
    data: SynthesisData = { oracleBuffer: [], reboots: 0 },
  ): SynthesisResult | null {
    const config = this.mergedConfig();
    const deadlineMs = createDeadline(config.timeoutMs);
    return this.synthesizeInternal(
      name,
      inputTypesFree,
      inputNames,
      returnTypeFree,
      envComps,
      examples0,
      oracle,
      data,
      deadlineMs,
    );
  }

  private synthesizeInternal(
    name: string,
    inputTypesFree: readonly Type[],
    inputNames: readonly string[],
    returnTypeFree: Type,
    envComps: ReadonlyMap<string, ComponentImpl>,
    examples0: readonly (readonly [ArgList, TermValue])[],
    oracle: (args: ArgList) => TermValue,
    data: SynthesisData,
    deadlineMs: number | null,
  ): SynthesisResult | null {
    const config = this.mergedConfig();
    const timedOut = (): boolean => isTimedOut(deadlineMs);

    if (timedOut()) {
      return null;
    }
    if (config.maxReboots !== null && data.reboots > config.maxReboots) {
      return null;
    }

    const examples = sortExamples(examples0);
    const inputs = examples.map(([args]) => args);
    const outputs = examples.map(([, out]) => out);

    const inputTypes = inputTypesFree.map((type) => fixVars(type));
    const goalReturnType = fixVars(returnTypeFree);

    const signature = {
      name,
      argNames: inputNames,
      inputTypes,
      returnType: goalReturnType,
    };

    const bufferedOracle = new BufferedOracle(examples, oracle, data.oracleBuffer);
    const recursiveStub = new ComponentImpl(name, inputTypes, goalReturnType, (args) => bufferedOracle.evaluate(args));

    const compMap = new Map(envComps);
    compMap.set(name, recursiveStub);

    const state = new SynthesisState(outputs.length, goalReturnType);

    state.openNextLevel(1);
    inputTypes.forEach((type, argIndex) => {
      const valueVector = inputs.map((args) => args[argIndex]!);
      state.registerTerm(1, type, varTerm(inputNames[argIndex]!), valueVector);
    });

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

    const interestingSignature = isInterestingSignature(goalReturnType, inputTypes);

    const synthesizeAtCost = (cost: number, synBoolAndReturnType: boolean): boolean => {
      if (timedOut()) {
        return false;
      }
      state.openNextLevel(cost);
      const partitionCache = new Map<string, readonly number[][]>();
      const resolvedSignatureCache = new Map<
        ComponentImpl,
        Map<string, ReturnType<typeof bucketSignaturesByGoalOrBool>>
      >();

      for (const [compName, impl] of compMap.entries()) {
        if (timedOut()) {
          return false;
        }
        const compCost = 1;
        if (compCost > cost) {
          continue;
        }

        const arity = impl.inputTypes.length;
        const costLeft = cost - compCost;

        if (arity === 0) {
          if (cost !== compCost) {
            continue;
          }
          const result = impl.executeEfficient([]);
          const vector = outputs.map(() => result);
          if (!config.deleteAllErr || !allErr(vector)) {
            state.registerTerm(cost, impl.returnType, componentTerm(compName, []), vector);
          }
          continue;
        }

        const partitionKey = `${arity}:${costLeft}`;
        const partitions = partitionCache.get(partitionKey) ?? divideNumberAsSum(costLeft, arity, 1);
        partitionCache.set(partitionKey, partitions);
        const cachedByCost =
          resolvedSignatureCache.get(impl) ?? new Map<string, ReturnType<typeof bucketSignaturesByGoalOrBool>>();
        resolvedSignatureCache.set(impl, cachedByCost);

        for (const costs of partitions) {
          if (timedOut()) {
            return false;
          }
          const costsKey = costs.join(",");
          let buckets = cachedByCost.get(costsKey);
          if (buckets === undefined) {
            const resolvedSignatures = typesForCosts(
              (c) => state.typesOfCost(c),
              costs,
              impl.inputTypes,
              impl.returnType,
            );
            buckets = bucketSignaturesByGoalOrBool(goalReturnType, resolvedSignatures);
            cachedByCost.set(costsKey, buckets);
          }
          const signatures = synBoolAndReturnType ? buckets.related : buckets.unrelated;

          for (const [argTypes, resolvedReturnType] of signatures) {
            if (!interestingSignature(argTypes, resolvedReturnType)) {
              continue;
            }

            if (timedOut()) {
              return false;
            }
            const candidatesForArgs = argTypes.map((argType, idx) => state.entriesOfCostAndType(costs[idx]!, argType));
            if (candidatesForArgs.some((c) => c.length === 0)) {
              continue;
            }

            for (const product of cartesianProduct(candidatesForArgs)) {
              if (timedOut()) {
                return false;
              }
              const productTerms = product.map((entry) => entry.term);
              if (impl.isReducible !== null && impl.isReducible(productTerms)) {
                continue;
              }
              const vector = outputs.map((_, exId) => {
                const callArgs = product.map((entry) => entry.valueVector[exId]!);
                if (compName === name && config.enforceDecreasingMeasure && !argDecrease(callArgs, exId)) {
                  return valueError;
                }
                if (compName === name && !recursiveInvariantOk(callArgs, exId)) {
                  return valueError;
                }
                return impl.executeEfficient(callArgs);
              });

              if (config.deleteAllErr && allErr(vector)) {
                continue;
              }

              state.registerTerm(cost, resolvedReturnType, componentTerm(compName, productTerms), vector);
            }
          }
        }
      }
      return true;
    };

    const validateCandidate = (program: SynthesizedProgram): SynthesisResult | null => {
      if (timedOut()) {
        return null;
      }
      const impl = recursiveImpl(signature, envComps, config.argListCompare, program.body, {
        enforceDecreasingMeasure: config.enforceDecreasingMeasure,
        invariantArgIndices: config.recursiveInvariantArgIndices,
      });

      const passed: [ArgList, TermValue][] = [];
      const failed: [ArgList, TermValue][] = [];

      for (const [args, expected] of examples) {
        if (!equalTermValue(impl.executeEfficient(args), expected)) {
          failed.push([args, expected]);
        } else {
          passed.push([args, expected]);
        }
      }

      for (const [args, expected] of bufferedOracle.bufferEntries()) {
        if (equalTermValue(impl.executeEfficient(args), expected)) {
          passed.push([args, expected]);
        } else {
          failed.push([args, expected]);
        }
      }

      if (failed.length === 0) {
        return {
          program,
          state,
          data: {
            oracleBuffer: passed,
            reboots: data.reboots,
          },
        };
      }

      const [newExamples, newBuffer] = config.rebootStrategy.newExamplesAndOracleBuffer(examples, failed, passed);
      return this.synthesizeInternal(name, inputTypes, inputNames, goalReturnType, envComps, newExamples, oracle, {
        oracleBuffer: newBuffer,
        reboots: data.reboots + 1,
      }, deadlineMs);
    };

    const goalVector = outputs;
    const goalVM: IndexValueMap = new Map(outputs.map((value, index) => [index, value]));

    for (let level = 1; level <= config.maxCost; level += 1) {
      if (!synthesizeAtCost(level, true)) {
        return null;
      }
      if (timedOut()) {
        return null;
      }

      const search = new BatchGoalSearch(
        level,
        (cost, vm) => state.returnTypeTermOfCost(cost, vm),
        (cost) => state.returnTypeTermsAsVectors(cost),
        (cost) => state.boolTermsAsVectors(cost),
        (vm) => state.boolTermOfVM(vm, level),
      );

      const compositeHit =
        config.goalSearchStrategy === "cond-first"
          ? search.searchCondFirst(config.searchSizeFactor * level, goalVM)
          : search.searchThenFirst(config.searchSizeFactor * level, goalVM);
      if (compositeHit !== null) {
        if (timedOut()) {
          return null;
        }
        const [cost, term] = compositeHit;
        const compositeResult = validateCandidate({
          signature,
          body: term,
          cost,
          depth: level,
        });
        if (compositeResult !== null) {
          return compositeResult;
        }
      }

      if (timedOut()) {
        return null;
      }
      const hit = state.findGoalHit(goalVector, level);
      if (hit !== null && instanceOfType(goalReturnType, hit.type) && valueVectorEquals(hit.valueVector, goalVector)) {
        const result = validateCandidate({
          signature,
          body: hit.term,
          cost: hit.cost,
          depth: level,
        });

        if (result !== null) {
          return result;
        }
      }

      if (!synthesizeAtCost(level, false)) {
        return null;
      }
    }

    return null;
  }
}

export { RebootStrategies };
export type { RebootStrategy } from "./reboot-strategies.js";
export type {
  SynthesisData,
  SynthesisResult,
  SynthesizedProgram,
  TypedEscherConfig,
} from "./types.js";
