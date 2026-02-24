import { executeTerm, type ExecutableComponent } from "../types/term.js";
import { type Type, shiftId } from "../types/type.js";
import { equalTermValue, greaterThan, type TermValue, valueError } from "../types/value.js";

export type ArgList = readonly TermValue[];
export type ArgListCompare = (a: ArgList, b: ArgList) => boolean;

export const alphabeticSmaller: ArgListCompare = (args1, args2) => {
  if (args1.length !== args2.length) {
    throw new Error("Arg list lengths differ");
  }

  for (let i = 0; i < args1.length; i += 1) {
    if (greaterThan(args1[i]!, args2[i]!)) {
      return false;
    }
    if (greaterThan(args2[i]!, args1[i]!)) {
      return true;
    }
  }
  return false;
};

export const anyArgSmaller: ArgListCompare = (args1, args2) => {
  if (args1.length !== args2.length) {
    throw new Error("Arg list lengths differ");
  }

  let hasStrictSmaller = false;
  for (let i = 0; i < args1.length; i += 1) {
    if (greaterThan(args1[i]!, args2[i]!)) {
      return false;
    }
    if (greaterThan(args2[i]!, args1[i]!)) {
      hasStrictSmaller = true;
    }
  }
  return hasStrictSmaller;
};

export class ExecutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExecutionError";
  }
}

export type ComponentImplFn = (args: readonly TermValue[]) => TermValue;
export type ReducibilityCheck = (args: readonly import("../types/term.js").Term[]) => boolean;
export interface ComponentDefinition {
  readonly name: string;
  readonly inputTypes: readonly Type[];
  readonly returnType: Type;
  readonly impl: ComponentImplFn;
  readonly callByValue?: boolean;
  readonly isReducible?: ReducibilityCheck | null;
}

const hasErr = (args: readonly TermValue[]): boolean => args.some((arg) => arg.tag === "error");

const makeScopedResolver = (argNames: readonly string[], args: readonly TermValue[]) => {
  const varMap = new Map<string, TermValue>();
  argNames.forEach((argName, index) => {
    varMap.set(argName, args[index]!);
  });

  return (varName: string): TermValue => {
    const value = varMap.get(varName);
    if (value === undefined) {
      throw new ExecutionError(`variable '${varName}' not in scope`);
    }
    return value;
  };
};

export class ComponentImpl implements ExecutableComponent {
  readonly name: string;
  readonly inputTypes: readonly Type[];
  readonly returnType: Type;
  readonly impl: ComponentImplFn;
  readonly callByValue: boolean;
  readonly isReducible: ReducibilityCheck | null;

  constructor(
    name: string,
    inputTypes: readonly Type[],
    returnType: Type,
    impl: ComponentImplFn,
    callByValue = true,
    isReducible: ReducibilityCheck | null = null,
  ) {
    this.name = name;
    this.inputTypes = inputTypes;
    this.returnType = returnType;
    this.impl = impl;
    this.callByValue = callByValue;
    this.isReducible = isReducible;
  }

  shiftTypeId(amount: number): ComponentImpl {
    return new ComponentImpl(
      this.name,
      this.inputTypes.map((t) => shiftId(t, amount)),
      shiftId(this.returnType, amount),
      this.impl,
      this.callByValue,
      this.isReducible,
    );
  }

  execute(args: readonly TermValue[]): TermValue {
    if (this.callByValue && hasErr(args)) {
      return valueError;
    }

    try {
      return this.impl(args);
    } catch (error) {
      if (error instanceof ExecutionError) {
        throw error;
      }
      return valueError;
    }
  }

  executeEfficient(args: readonly TermValue[]): TermValue {
    if (this.callByValue && hasErr(args)) {
      return valueError;
    }
    return this.impl(args);
  }
}

export const defineComponent = (definition: ComponentDefinition): ComponentImpl =>
  new ComponentImpl(
    definition.name,
    definition.inputTypes,
    definition.returnType,
    definition.impl,
    definition.callByValue ?? true,
    definition.isReducible ?? null,
  );

const ensureUniqueComponentNames = (components: readonly ComponentImpl[]): void => {
  const seen = new Set<string>();
  for (const component of components) {
    if (seen.has(component.name)) {
      throw new Error(`Duplicate component name: ${component.name}`);
    }
    seen.add(component.name);
  }
};

export const defineComponents = (definitions: readonly ComponentDefinition[]): readonly ComponentImpl[] => {
  const components = definitions.map((definition) => defineComponent(definition));
  ensureUniqueComponentNames(components);
  return components;
};

export const createComponentEnv = (components: readonly ComponentImpl[]): ReadonlyMap<string, ComponentImpl> => {
  ensureUniqueComponentNames(components);
  return new Map(components.map((component) => [component.name, component] as const));
};

export const mergeComponentEnvs = (
  ...envs: readonly ReadonlyMap<string, ComponentImpl>[]
): ReadonlyMap<string, ComponentImpl> => {
  const merged = new Map<string, ComponentImpl>();
  for (const env of envs) {
    for (const [name, component] of env.entries()) {
      if (merged.has(name)) {
        throw new Error(`Duplicate component name while merging environments: ${name}`);
      }
      merged.set(name, component);
    }
  }
  return merged;
};

export interface ComponentSignature {
  readonly name: string;
  readonly argNames: readonly string[];
  readonly inputTypes: readonly Type[];
  readonly returnType: Type;
}

export interface RecursiveExecutionOptions {
  readonly enforceDecreasingMeasure?: boolean;
  readonly invariantArgIndices?: readonly number[];
}

export const recursiveImpl = (
  signature: ComponentSignature,
  compMap: ReadonlyMap<string, ComponentImpl>,
  argListCompare: ArgListCompare,
  body: import("../types/term.js").Term,
  options: RecursiveExecutionOptions = {},
): ComponentImpl => {
  const { name, argNames, inputTypes, returnType } = signature;
  const buffer = new Map<string, TermValue>();
  const enforceDecreasingMeasure = options.enforceDecreasingMeasure ?? true;
  const invariantArgIndices = options.invariantArgIndices ?? [];

  const keyOf = (args: readonly TermValue[]): string => JSON.stringify(args);

  const evaluate = (
    args: readonly TermValue[],
    lastArg: readonly TermValue[] | null,
    inProgress: Set<string>,
  ): TermValue => {
    if (enforceDecreasingMeasure && lastArg !== null && !argListCompare(args, lastArg)) {
      return valueError;
    }
    if (lastArg !== null && invariantArgIndices.length > 0) {
      for (const idx of invariantArgIndices) {
        if (idx < 0 || idx >= args.length || idx >= lastArg.length) {
          return valueError;
        }
        if (!equalTermValue(args[idx]!, lastArg[idx]!)) {
          return valueError;
        }
      }
    }

    const key = keyOf(args);
    const known = buffer.get(key);
    if (known !== undefined) {
      return known;
    }
    if (inProgress.has(key)) {
      return valueError;
    }

    const recursiveComp = new ComponentImpl(name, inputTypes, returnType, (recursiveArgs) =>
      evaluate(recursiveArgs, args, inProgress),
    );

    const newMap = new Map(compMap);
    newMap.set(name, recursiveComp);

    inProgress.add(key);
    try {
      const out = executeTerm(makeScopedResolver(argNames, args), newMap, body);
      buffer.set(key, out);
      return out;
    } finally {
      inProgress.delete(key);
    }
  };

  return new ComponentImpl(name, inputTypes, returnType, (args) => evaluate(args, null, new Set<string>()));
};

export const nonRecursiveImpl = (
  signature: ComponentSignature,
  compMap: ReadonlyMap<string, ComponentImpl>,
  body: import("../types/term.js").Term,
): ComponentImpl => {
  const { name, argNames, inputTypes, returnType } = signature;
  return new ComponentImpl(name, inputTypes, returnType, (args) => {
    return executeTerm(makeScopedResolver(argNames, args), compMap, body);
  });
};
