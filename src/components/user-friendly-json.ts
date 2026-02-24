import { createComponentEnv, type ComponentDefinition, type ComponentImpl, defineComponents } from "./component.js";
import {
  boolUnary,
  defineUserComponents,
  inferLiteralType,
  intBinary,
  intConst,
  intUnary,
  literalExamples,
  literalToValue,
  valueToLiteral,
  type UserLiteral,
} from "./user-friendly.js";
import { type ArgList } from "./component.js";
import { equalTermValue, type TermValue, valueBool, valueError, valueInt, valueObject, valueRef } from "../types/value.js";
import { equalsType, type Type, tyBool, tyInt, tyList, tyObject, tyPair, tyRef, tyTree } from "../types/type.js";
import {
  getBenchmarkPresetComponents,
  listBenchmarkComponentPresets,
  listCommonComponentDomains,
  getCommonComponentsByDomain,
} from "../library/common-comps-sets.js";

export interface JsonComponentSpec {
  readonly name: string;
  readonly kind: "intConst" | "intUnary" | "intBinary" | "boolUnary" | "libraryRef" | "js";
  readonly value?: number;
  readonly op?: string;
  readonly ref?: string;
  readonly inputTypes?: readonly string[];
  readonly returnType?: string;
  readonly args?: readonly string[];
  readonly bodyJs?: string;
}

export interface JsonClassMethodSpec {
  readonly name: string;
  readonly args?: Readonly<Record<string, string>>;
  readonly returnType: string;
  readonly bodyJs: string;
}

export interface JsonClassSpec {
  readonly name: string;
  readonly fields: Readonly<Record<string, string>>;
  readonly methods?: readonly JsonClassMethodSpec[];
}

export interface JsonSignatureArgSpec {
  readonly name: string;
  readonly type: string;
  readonly immutable?: boolean;
}

export interface JsonAutoExpandClassSignatureSpec {
  readonly className?: string;
  readonly includeThisRef?: boolean;
  readonly thisRefName?: string;
  readonly classHeapName?: string;
  readonly includeRefFieldHeaps?: boolean;
  readonly fieldHeapFields?: readonly string[];
  readonly fieldHeapNames?: Readonly<Record<string, string>>;
  readonly recursiveInvariantArgNames?: readonly string[];
}

export interface JsonSynthesisSpec {
  readonly name?: string;
  readonly category?: string;
  readonly classes?: readonly JsonClassSpec[];
  readonly exposeClassComponents?: boolean;
  readonly autoClassFieldComponents?: boolean;
  // Backward compatibility: prefer signature.fixedClassRecursivePattern.
  readonly fixedClassRecursivePattern?: boolean;
  // Backward compatibility: prefer signature.recursiveInvariantArgNames.
  readonly recursiveInvariantArgNames?: readonly string[];
  readonly componentsPreset?: string;
  readonly signature?: {
    readonly inputNames?: readonly string[];
    readonly inputTypes?: readonly string[];
    readonly returnType: string;
    readonly args?: readonly JsonSignatureArgSpec[];
    readonly fixedClassRecursivePattern?: boolean;
    readonly recursiveInvariantArgNames?: readonly string[];
    readonly autoExpandClassSignature?: JsonAutoExpandClassSignatureSpec;
  };
  readonly oracle?:
    | {
        readonly kind: "examples";
      }
    | {
        readonly kind: "table";
        readonly entries: readonly (readonly [readonly UserLiteral[], UserLiteral])[];
        readonly default?: UserLiteral | "error";
      }
    | {
        readonly kind: "js";
        readonly args?: readonly string[];
        readonly body: string;
      }
    | {
        readonly kind: "componentRef";
        readonly name: string;
      };
  readonly components: readonly JsonComponentSpec[];
  readonly examples: readonly (readonly [readonly UserLiteral[], UserLiteral])[];
}

const intUnaryOps: Readonly<Record<string, (x: number) => number>> = {
  inc: (x) => x + 1,
  dec: (x) => x - 1,
  neg: (x) => -x,
  abs: (x) => Math.abs(x),
  double: (x) => x * 2,
  square: (x) => x * x,
};

const intBinaryOps: Readonly<Record<string, (x: number, y: number) => number>> = {
  add: (x, y) => x + y,
  sub: (x, y) => x - y,
  mul: (x, y) => x * y,
  max: (x, y) => Math.max(x, y),
  min: (x, y) => Math.min(x, y),
};

const boolUnaryOps: Readonly<Record<string, (x: boolean) => boolean>> = {
  not: (x) => !x,
};

const asString = (value: unknown, path: string): string => {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${path} must be a non-empty string`);
  }
  return value;
};

const asNumber = (value: unknown, path: string): number => {
  if (typeof value !== "number" || Number.isNaN(value)) {
    throw new Error(`${path} must be a number`);
  }
  return value;
};

const parseComponent = (spec: JsonComponentSpec, index: number): ComponentDefinition => {
  const path = `components[${index}]`;
  const name = asString(spec.name, `${path}.name`);
  const kind = asString(spec.kind, `${path}.kind`);

  switch (kind) {
    case "intConst":
      return intConst(name, asNumber(spec.value, `${path}.value`));
    case "intUnary": {
      const opName = asString(spec.op, `${path}.op`);
      const op = intUnaryOps[opName];
      if (op === undefined) {
        throw new Error(`${path}.op must be one of: ${Object.keys(intUnaryOps).join(", ")}`);
      }
      return intUnary(name, op);
    }
    case "intBinary": {
      const opName = asString(spec.op, `${path}.op`);
      const op = intBinaryOps[opName];
      if (op === undefined) {
        throw new Error(`${path}.op must be one of: ${Object.keys(intBinaryOps).join(", ")}`);
      }
      return intBinary(name, op);
    }
    case "boolUnary": {
      const opName = asString(spec.op, `${path}.op`);
      const op = boolUnaryOps[opName];
      if (op === undefined) {
        throw new Error(`${path}.op must be one of: ${Object.keys(boolUnaryOps).join(", ")}`);
      }
      return boolUnary(name, op);
    }
    case "libraryRef": {
      const refName = asString(spec.ref, `${path}.ref`);
      const resolved = libraryComponentByName.get(refName);
      if (resolved === undefined) {
        throw new Error(`${path}.ref references unknown library component: ${refName}`);
      }
      return {
        name,
        inputTypes: resolved.inputTypes,
        returnType: resolved.returnType,
        impl: (args) => resolved.executeEfficient(args),
        callByValue: resolved.callByValue,
        isReducible: resolved.isReducible,
      };
    }
    case "js":
      throw new Error(`${path}.kind=js requires class-aware type resolver; parse via parseComponentWithResolver`);
    default:
      throw new Error(`${path}.kind must be one of: intConst, intUnary, intBinary, boolUnary, libraryRef, js`);
  }
};

const buildLibraryComponentByName = (): ReadonlyMap<string, ComponentImpl> => {
  const all = new Map<string, ComponentImpl>();
  for (const domain of listCommonComponentDomains()) {
    for (const comp of getCommonComponentsByDomain(domain)) {
      all.set(comp.name, comp);
    }
  }
  for (const preset of listBenchmarkComponentPresets()) {
    for (const comp of getBenchmarkPresetComponents(preset)) {
      all.set(comp.name, comp);
    }
  }
  return all;
};

const libraryComponentByName = buildLibraryComponentByName();

const implicitJsonComponentDefs: readonly ComponentDefinition[] = [
  {
    name: "falseConst",
    inputTypes: [],
    returnType: tyBool,
    impl: () => valueBool(false),
  },
  {
    name: "trueConst",
    inputTypes: [],
    returnType: tyBool,
    impl: () => valueBool(true),
  },
  {
    name: "leInt",
    inputTypes: [tyInt, tyInt],
    returnType: tyBool,
    impl: ([x, y]) =>
      x !== undefined && y !== undefined && x.tag === "int" && y.tag === "int"
        ? valueBool(x.value <= y.value)
        : valueError,
  },
  {
    name: "loadInt",
    inputTypes: [tyList(tyInt), tyRef(tyInt)],
    returnType: tyInt,
    impl: ([heap, ref]) => {
      if (heap === undefined || ref === undefined || heap.tag !== "list" || ref.tag !== "ref") {
        return valueError;
      }
      const i = ref.value;
      if (i < 0 || i >= heap.elems.length) {
        return valueError;
      }
      const v = heap.elems[i];
      return v !== undefined && v.tag === "int" ? valueInt(v.value) : valueError;
    },
  },
];

const implicitJsonComponents = defineComponents(implicitJsonComponentDefs);

const mergeWithImplicitJsonComponents = (components: readonly ComponentImpl[]): readonly ComponentImpl[] => {
  const out: ComponentImpl[] = [...components];
  const existing = new Set(components.map((component) => component.name));
  for (const implicit of implicitJsonComponents) {
    if (!existing.has(implicit.name)) {
      out.push(implicit);
      existing.add(implicit.name);
    }
  }
  return out;
};

const ensureSpecShape = (value: unknown): JsonSynthesisSpec => {
  if (typeof value !== "object" || value === null) {
    throw new Error("JSON root must be an object");
  }
  const record = value as Record<string, unknown>;
  if (!Array.isArray(record.components)) {
    throw new Error("components must be an array");
  }
  if (!Array.isArray(record.examples)) {
    throw new Error("examples must be an array");
  }
  const name = typeof record.name === "string" ? record.name : undefined;
  const category = typeof record.category === "string" ? record.category : undefined;
  const classes = Array.isArray(record.classes) ? (record.classes as JsonClassSpec[]) : undefined;
  const exposeClassComponents =
    typeof record.exposeClassComponents === "boolean" ? record.exposeClassComponents : undefined;
  const autoClassFieldComponents =
    typeof record.autoClassFieldComponents === "boolean" ? record.autoClassFieldComponents : undefined;
  const componentsPreset = typeof record.componentsPreset === "string" ? record.componentsPreset : undefined;
  const fixedClassRecursivePattern =
    typeof record.fixedClassRecursivePattern === "boolean" ? record.fixedClassRecursivePattern : undefined;
  const recursiveInvariantArgNames = Array.isArray(record.recursiveInvariantArgNames)
    ? (record.recursiveInvariantArgNames as string[])
    : undefined;
  const signatureRaw =
    typeof record.signature === "object" && record.signature !== null
      ? (record.signature as Record<string, unknown>)
      : undefined;
  const signature =
    signatureRaw === undefined
      ? undefined
      : {
          ...(Array.isArray(signatureRaw.inputNames) ? { inputNames: signatureRaw.inputNames as readonly string[] } : {}),
          ...(Array.isArray(signatureRaw.inputTypes) ? { inputTypes: signatureRaw.inputTypes as readonly string[] } : {}),
          returnType: signatureRaw.returnType as string,
          ...(Array.isArray(signatureRaw.args) ? { args: signatureRaw.args as readonly JsonSignatureArgSpec[] } : {}),
          ...(typeof signatureRaw.fixedClassRecursivePattern === "boolean"
            ? { fixedClassRecursivePattern: signatureRaw.fixedClassRecursivePattern as boolean }
            : {}),
          ...(Array.isArray(signatureRaw.recursiveInvariantArgNames)
            ? { recursiveInvariantArgNames: signatureRaw.recursiveInvariantArgNames as string[] }
            : {}),
          ...(typeof signatureRaw.autoExpandClassSignature === "object" &&
          signatureRaw.autoExpandClassSignature !== null
            ? { autoExpandClassSignature: signatureRaw.autoExpandClassSignature as JsonAutoExpandClassSignatureSpec }
            : {}),
        };
  const oracleRaw =
    typeof record.oracle === "object" && record.oracle !== null ? (record.oracle as Record<string, unknown>) : undefined;
  const oracle =
    oracleRaw === undefined
      ? undefined
      : (oracleRaw.kind === "table"
          ? {
              kind: "table" as const,
              entries: oracleRaw.entries as (readonly [readonly UserLiteral[], UserLiteral])[],
              ...(oracleRaw.default !== undefined ? { default: oracleRaw.default as UserLiteral | "error" } : {}),
            }
          : oracleRaw.kind === "js"
            ? {
                kind: "js" as const,
                body: oracleRaw.body as string,
                ...(Array.isArray(oracleRaw.args) ? { args: oracleRaw.args as string[] } : {}),
              }
            : oracleRaw.kind === "componentRef"
              ? {
                  kind: "componentRef" as const,
                  name: oracleRaw.name as string,
                }
          : {
              kind: "examples" as const,
            });
  return {
    ...(name !== undefined ? { name } : {}),
    ...(category !== undefined ? { category } : {}),
    ...(classes !== undefined ? { classes } : {}),
    ...(exposeClassComponents !== undefined ? { exposeClassComponents } : {}),
    ...(autoClassFieldComponents !== undefined ? { autoClassFieldComponents } : {}),
    ...(fixedClassRecursivePattern !== undefined ? { fixedClassRecursivePattern } : {}),
    ...(recursiveInvariantArgNames !== undefined ? { recursiveInvariantArgNames } : {}),
    ...(componentsPreset !== undefined ? { componentsPreset } : {}),
    ...(signature !== undefined ? { signature } : {}),
    ...(oracle !== undefined ? { oracle } : {}),
    components: record.components as JsonComponentSpec[],
    examples: record.examples as (readonly [readonly UserLiteral[], UserLiteral])[],
  };
};

export const parseJsonSynthesisSpec = (jsonText: string): JsonSynthesisSpec =>
  ensureSpecShape(JSON.parse(jsonText) as unknown);

export interface PreparedJsonSpec {
  readonly name: string | undefined;
  readonly components: readonly ComponentImpl[];
  readonly env: ReadonlyMap<string, ComponentImpl>;
  readonly examples: readonly (readonly [ArgList, TermValue])[];
}

export const prepareJsonSynthesisSpec = (spec: JsonSynthesisSpec): PreparedJsonSpec => {
  const resolveClassType = buildClassTypeResolver(spec.classes);
  const presetComponents =
    spec.componentsPreset === undefined
      ? []
      : (() => {
          const known = new Set(listBenchmarkComponentPresets());
          if (!known.has(spec.componentsPreset as (typeof listBenchmarkComponentPresets extends () => readonly (infer T)[] ? T : never))) {
            throw new Error(`Unknown componentsPreset: ${spec.componentsPreset}`);
          }
          return [...getBenchmarkPresetComponents(spec.componentsPreset as never)];
        })();

  const userDefined = defineUserComponents(
    spec.components.map((component, index) => parseComponentWithResolver(component, index, resolveClassType)),
  );
  const classGenerated = spec.exposeClassComponents === false ? [] : lowerClassSpecsToComponents(spec.classes);
  const components = [...presetComponents, ...classGenerated, ...userDefined];
  return {
    name: spec.name,
    components,
    env: createComponentEnv(components),
    examples: literalExamples(spec.examples),
  };
};

const stripSpaces = (text: string): string => text.replace(/\s+/g, "");

const parseTypeAt = (text: string, start: number): { readonly type: Type; readonly end: number } => {
  const src = stripSpaces(text);
  const consume = (keyword: string, at: number): number => {
    if (!src.startsWith(keyword, at)) {
      throw new Error(`Invalid type expression near '${src.slice(at)}'`);
    }
    return at + keyword.length;
  };
  const parseInner = (pos: number): { readonly type: Type; readonly end: number } => {
    if (src.startsWith("Int", pos)) {
      return { type: tyInt, end: pos + 3 };
    }
    if (src.startsWith("Bool", pos)) {
      return { type: tyBool, end: pos + 4 };
    }
    if (src.startsWith("List[", pos)) {
      const inside = parseInner(pos + 5);
      const end = consume("]", inside.end);
      return { type: tyList(inside.type), end };
    }
    if (src.startsWith("Tree[", pos)) {
      const inside = parseInner(pos + 5);
      const end = consume("]", inside.end);
      return { type: tyTree(inside.type), end };
    }
    if (src.startsWith("Pair[", pos)) {
      const left = parseInner(pos + 5);
      const comma = consume(",", left.end);
      const right = parseInner(comma);
      const end = consume("]", right.end);
      return { type: tyPair(left.type, right.type), end };
    }
    if (src.startsWith("Ref[", pos)) {
      const inside = parseInner(pos + 4);
      const end = consume("]", inside.end);
      return { type: tyRef(inside.type), end };
    }
    throw new Error(`Unsupported type expression: '${text}'`);
  };
  return parseInner(start);
};

export const parseTypeSpec = (text: string): Type => {
  const src = stripSpaces(text);
  const parsed = parseTypeAt(src, 0);
  if (parsed.end !== src.length) {
    throw new Error(`Invalid trailing type syntax in '${text}'`);
  }
  return parsed.type;
};

const parseTypeSpecWithResolver = (
  text: string,
  resolveNamedType: ((name: string) => Type | null) | undefined,
): Type => {
  const src = stripSpaces(text);
  let pos = 0;
  const peek = (): string => src[pos] ?? "";
  const consume = (ch: string): void => {
    if (src[pos] !== ch) {
      throw new Error(`Invalid type expression near '${src.slice(pos)}' in '${text}'`);
    }
    pos += 1;
  };
  const readIdent = (): string => {
    const start = pos;
    while (pos < src.length && /[A-Za-z0-9_]/.test(src[pos]!)) {
      pos += 1;
    }
    if (start === pos) {
      throw new Error(`Expected type identifier near '${src.slice(pos)}' in '${text}'`);
    }
    return src.slice(start, pos);
  };
  const parseTy = (): Type => {
    const ident = readIdent();
    if (ident === "Int") {
      return tyInt;
    }
    if (ident === "Bool") {
      return tyBool;
    }
    if (ident === "List") {
      consume("[");
      const inner = parseTy();
      consume("]");
      return tyList(inner);
    }
    if (ident === "Tree") {
      consume("[");
      const inner = parseTy();
      consume("]");
      return tyTree(inner);
    }
    if (ident === "Pair") {
      consume("[");
      const left = parseTy();
      consume(",");
      const right = parseTy();
      consume("]");
      return tyPair(left, right);
    }
    if (ident === "Ref") {
      consume("[");
      const inner = parseTy();
      consume("]");
      return tyRef(inner);
    }
    if (ident === "Object") {
      consume("[");
      const className = readIdent();
      consume("]");
      return tyObject(className);
    }
    const resolved = resolveNamedType?.(ident) ?? null;
    if (resolved !== null) {
      return resolved;
    }
    return tyObject(ident);
  };

  const ty = parseTy();
  if (peek() !== "") {
    throw new Error(`Invalid trailing type syntax in '${text}'`);
  }
  return ty;
};

const parseComponentWithResolver = (
  spec: JsonComponentSpec,
  index: number,
  resolveNamedType: ((name: string) => Type | null) | undefined,
): ComponentDefinition => {
  if (spec.kind !== "js") {
    return parseComponent(spec, index);
  }

  const path = `components[${index}]`;
  const name = asString(spec.name, `${path}.name`);
  if (!Array.isArray(spec.inputTypes)) {
    throw new Error(`${path}.inputTypes must be an array for kind=js`);
  }
  const inputTypes = spec.inputTypes.map((t, i) =>
    parseTypeSpecWithResolver(asString(t, `${path}.inputTypes[${i}]`), resolveNamedType),
  );
  const returnType = parseTypeSpecWithResolver(asString(spec.returnType, `${path}.returnType`), resolveNamedType);
  const args = spec.args?.map((arg, i) => asString(arg, `${path}.args[${i}]`));
  const bodyJs = asString(spec.bodyJs, `${path}.bodyJs`);
  const fn = new Function(...(args ?? ["args"]), bodyJs) as (...fnArgs: unknown[]) => unknown;

  return {
    name,
    inputTypes,
    returnType,
    impl: (termArgs) => {
      const literalArgs = termArgs.map((arg) => valueToLiteral(arg));
      if (literalArgs.some((arg) => arg === null)) {
        return valueError;
      }
      try {
        const callArgs = args === undefined ? [literalArgs as UserLiteral[]] : (literalArgs as UserLiteral[]);
        const out = fn(...callArgs);
        if (out === "error") {
          return valueError;
        }
        return literalToValue(out as UserLiteral);
      } catch {
        return valueError;
      }
    },
  };
};

const buildClassTypeResolver = (classes: readonly JsonClassSpec[] | undefined) => {
  const map = new Map<string, Type>();
  for (const cls of classes ?? []) {
    map.set(cls.name, tyObject(cls.name));
  }
  return (name: string): Type | null => map.get(name) ?? null;
};

const classNameFromObjectType = (type: Type): string | null => {
  if (type.kind !== "apply" || type.params.length !== 0) {
    return null;
  }
  const ctorName = type.constructor.name;
  if (!ctorName.startsWith("Object<") || !ctorName.endsWith(">")) {
    return null;
  }
  return ctorName.slice("Object<".length, -1);
};

const refTargetType = (type: Type): Type | null => {
  if (type.kind !== "apply" || type.constructor.name !== "Ref" || type.params.length !== 1) {
    return null;
  }
  return type.params[0] ?? null;
};

const listElemType = (type: Type): Type | null => {
  if (type.kind !== "apply" || type.constructor.name !== "List" || type.params.length !== 1) {
    return null;
  }
  return type.params[0] ?? null;
};

const capitalize = (text: string): string =>
  text.length === 0 ? text : text[0]!.toUpperCase() + text.slice(1);

const buildAutoClassFieldComponentDefs = (
  spec: JsonSynthesisSpec,
  signature: {
    readonly inputNames: readonly string[];
    readonly inputTypes: readonly Type[];
    readonly returnType: Type;
  },
  functionName: string,
  existingNames: ReadonlySet<string>,
): readonly ComponentDefinition[] => {
  if (spec.autoClassFieldComponents !== true || spec.classes === undefined || spec.classes.length === 0) {
    return [];
  }

  const receiverIndex = signature.inputTypes.findIndex((inputType) => {
    const target = refTargetType(inputType);
    return target !== null && classNameFromObjectType(target) !== null;
  });
  if (receiverIndex < 0) {
    return [];
  }

  const receiverTarget = refTargetType(signature.inputTypes[receiverIndex]!);
  const receiverClassName = receiverTarget === null ? null : classNameFromObjectType(receiverTarget);
  if (receiverClassName === null) {
    return [];
  }

  const classSpec = spec.classes.find((cls) => cls.name === receiverClassName);
  if (classSpec === undefined) {
    return [];
  }

  const objectHeapIndex = signature.inputTypes.findIndex((inputType, index) => {
    if (index === receiverIndex) {
      return false;
    }
    const elem = listElemType(inputType);
    return elem !== null && classNameFromObjectType(elem) === receiverClassName;
  });
  if (objectHeapIndex < 0) {
    return [];
  }

  const resolveClassType = buildClassTypeResolver(spec.classes);
  const inputNameToIndex = new Map(signature.inputNames.map((name, index) => [name, index] as const));
  const receiverType = signature.inputTypes[receiverIndex]!;
  const objectHeapType = signature.inputTypes[objectHeapIndex]!;
  const defs: ComponentDefinition[] = [];
  const emittedNames = new Set<string>();
  const hasName = (name: string): boolean => existingNames.has(name) || emittedNames.has(name);

  const emit = (definition: ComponentDefinition): void => {
    if (hasName(definition.name)) {
      return;
    }
    emittedNames.add(definition.name);
    defs.push(definition);
  };

  for (const [fieldName, rawFieldType] of Object.entries(classSpec.fields ?? {})) {
    const fieldType = parseTypeSpecWithResolver(
      asString(rawFieldType, `classes[${receiverClassName}].fields.${fieldName}`),
      resolveClassType,
    );
    const fieldRefTarget = refTargetType(fieldType);
    const fieldTargetClassName = fieldRefTarget === null ? null : classNameFromObjectType(fieldRefTarget);
    const fieldHeapIndex = inputNameToIndex.get(`${fieldName}Heap`);
    const fieldHeapType = fieldHeapIndex === undefined ? null : signature.inputTypes[fieldHeapIndex]!;
    const componentInputTypes =
      fieldHeapType === null ? [receiverType, objectHeapType] : [receiverType, objectHeapType, fieldHeapType];
    const invalidValue = fieldRefTarget === null ? valueError : valueRef(-1);

    const accessField = (args: readonly TermValue[]): TermValue => {
      const thisArg = args[0];
      const heapArg = args[1];
      if (thisArg === undefined || thisArg.tag !== "ref" || heapArg === undefined || heapArg.tag !== "list") {
        return invalidValue;
      }
      const idx = thisArg.value;
      if (idx < 0 || idx >= heapArg.elems.length) {
        return invalidValue;
      }
      const node = heapArg.elems[idx];
      if (node === undefined || node.tag !== "object" || node.className !== receiverClassName) {
        return invalidValue;
      }
      const fieldValue = node.fields[fieldName];
      if (fieldValue === undefined) {
        return invalidValue;
      }

      if (fieldRefTarget === null) {
        return fieldValue;
      }
      if (fieldValue.tag !== "ref") {
        return invalidValue;
      }

      if (fieldHeapIndex !== undefined) {
        const fieldHeap = args[2];
        if (fieldHeap === undefined || fieldHeap.tag !== "list") {
          return invalidValue;
        }
        if (fieldValue.value === -1) {
          return fieldTargetClassName === null ? invalidValue : fieldValue;
        }
        if (fieldValue.value < 0 || fieldValue.value >= fieldHeap.elems.length) {
          return invalidValue;
        }
      } else if (fieldTargetClassName === null && fieldValue.value < 0) {
        return invalidValue;
      }

      return fieldValue;
    };

    emit({
      name: `${fieldName}Of`,
      inputTypes: componentInputTypes,
      returnType: fieldType,
      impl: accessField,
    });

    const boolAccessorName = `has${capitalize(fieldName)}`;
    if (boolAccessorName !== functionName) {
      emit({
        name: boolAccessorName,
        inputTypes: componentInputTypes,
        returnType: tyBool,
        impl: (args) => {
          const out = accessField(args);
          if (fieldRefTarget !== null) {
            return out.tag === "ref" && out.value !== -1 ? valueBool(true) : valueBool(false);
          }
          return out.tag === "error" ? valueBool(false) : valueBool(true);
        },
      });
    }
  }

  return defs;
};

const lowerClassSpecsToComponents = (classes: readonly JsonClassSpec[] | undefined): readonly ComponentImpl[] => {
  if (classes === undefined || classes.length === 0) {
    return [];
  }
  const resolveClassType = buildClassTypeResolver(classes);
  const defs: ComponentDefinition[] = [];

  for (const cls of classes) {
    const className = asString(cls.name, "classes[].name");
    const fields = cls.fields ?? {};
    const fieldNames = Object.keys(fields);
    const fieldTypes = fieldNames.map((f) => parseTypeSpecWithResolver(asString(fields[f], `classes[${className}].fields.${f}`), resolveClassType));
    const selfType = tyObject(className);

    defs.push({
      name: `new_${className}`,
      inputTypes: fieldTypes,
      returnType: selfType,
      impl: (args) => {
        const objFields = Object.fromEntries(fieldNames.map((f, i) => [f, args[i]!] as const));
        return valueObject(className, objFields);
      },
    });

    for (const [i, fieldName] of fieldNames.entries()) {
      defs.push({
        name: `${className}_${fieldName}`,
        inputTypes: [selfType],
        returnType: fieldTypes[i]!,
        impl: ([thisArg]) => {
          if (thisArg === undefined || thisArg.tag !== "object" || thisArg.className !== className) {
            return valueError;
          }
          return thisArg.fields[fieldName] ?? valueError;
        },
      });
    }

    for (const method of cls.methods ?? []) {
      const methodName = asString(method.name, `classes[${className}].methods[].name`);
      const argNames = Object.keys(method.args ?? {});
      const argTypes = argNames.map((argName) =>
        parseTypeSpecWithResolver(
          asString(method.args?.[argName], `classes[${className}].methods[${methodName}].args.${argName}`),
          resolveClassType,
        ),
      );
      const returnType = parseTypeSpecWithResolver(
        asString(method.returnType, `classes[${className}].methods[${methodName}].returnType`),
        resolveClassType,
      );

      const compiledMethods = (cls.methods ?? []).map((m) => {
        const name = asString(m.name, `classes[${className}].methods[].name`);
        const names = Object.keys(m.args ?? {});
        const body = asString(m.bodyJs, `classes[${className}].methods[${name}].bodyJs`);
        return {
          name,
          argNames: names,
          fn: new Function(...names, body) as (...args: unknown[]) => unknown,
        };
      });
      const methodByName = new Map(compiledMethods.map((m) => [m.name, m] as const));

      const invokeClassMethod = (
        targetMethodName: string,
        self: TermValue,
        argsAsLiteral: readonly UserLiteral[],
      ): TermValue => {
        const target = methodByName.get(targetMethodName);
        if (target === undefined || self.tag !== "object" || self.className !== className) {
          return valueError;
        }
        const thisBinding: Record<string, unknown> = {};
        for (const [fieldName, fieldValue] of Object.entries(self.fields)) {
          const asLit = valueToLiteral(fieldValue);
          if (asLit === null) {
            return valueError;
          }
          thisBinding[fieldName] = asLit;
        }
        for (const helper of compiledMethods) {
          thisBinding[helper.name] = (...helperArgs: unknown[]) => {
            const helperLiterals = helperArgs as UserLiteral[];
            const termOut = invokeClassMethod(helper.name, self, helperLiterals);
            const litOut = valueToLiteral(termOut);
            if (litOut === null) {
              throw new Error(`method '${helper.name}' returned non-literal value`);
            }
            return litOut;
          };
        }
        try {
          const out = target.fn.call(thisBinding, ...argsAsLiteral);
          if (out === "error") {
            return valueError;
          }
          return literalToValue(out as UserLiteral);
        } catch {
          return valueError;
        }
      };

      defs.push({
        name: `${className}_${methodName}`,
        inputTypes: [selfType, ...argTypes],
        returnType,
        impl: ([thisArg, ...rest]) => {
          if (thisArg === undefined || thisArg.tag !== "object" || thisArg.className !== className) {
            return valueError;
          }
          const literalArgs = rest.map((arg) => valueToLiteral(arg));
          if (literalArgs.some((arg) => arg === null)) {
            return valueError;
          }
          return invokeClassMethod(methodName, thisArg, literalArgs as UserLiteral[]);
        },
      });
    }
  }

  return defineComponents(defs);
};

const createOracleFromExamples = (examples: readonly (readonly [ArgList, TermValue])[]) => (args: ArgList): TermValue => {
  const hit = examples.find(
    ([input]) =>
      input.length === args.length && input.every((v, idx) => equalTermValue(v, args[idx]!)),
  );
  return hit === undefined ? valueError : hit[1];
};

const createOracleFromTable = (
  entries: readonly (readonly [ArgList, TermValue])[],
  defaultOut: TermValue,
) => (args: ArgList): TermValue => {
  const hit = entries.find(
    ([input]) =>
      input.length === args.length && input.every((v, idx) => equalTermValue(v, args[idx]!)),
  );
  return hit === undefined ? defaultOut : hit[1];
};

const createOracleFromJs = (args: readonly string[] | undefined, body: string) => {
  const argNames = args ?? ["args"];
  const fn = new Function(...argNames, body) as (...argv: unknown[]) => unknown;
  return (termArgs: ArgList): TermValue => {
    const literalArgs = termArgs.map((arg) => valueToLiteral(arg));
    if (literalArgs.some((arg) => arg === null)) {
      return valueError;
    }

    try {
      const resolved = literalArgs as UserLiteral[];
      const callArgs = args === undefined ? [resolved] : resolved;
      const out = fn(...callArgs);
      if (out === "error") {
        return valueError;
      }
      return literalToValue(out as UserLiteral);
    } catch {
      return valueError;
    }
  };
};

export interface PreparedJsonSynthesisJob extends PreparedJsonSpec {
  readonly functionName: string;
  readonly inputNames: readonly string[];
  readonly inputTypes: readonly Type[];
  readonly returnType: Type;
  readonly oracle: (args: ArgList) => TermValue;
  readonly recursiveInvariantArgIndices: readonly number[];
}

const inferSignatureFromExamples = (
  examples: readonly (readonly [readonly UserLiteral[], UserLiteral])[],
): { readonly inputNames: readonly string[]; readonly inputTypes: readonly Type[]; readonly returnType: Type } => {
  if (examples.length === 0) {
    throw new Error("Cannot infer signature without examples");
  }
  const [firstArgs, firstOut] = examples[0]!;
  const inputTypes = firstArgs.map((arg) => inferLiteralType(arg));
  const returnType = inferLiteralType(firstOut);
  const inputNames = inputTypes.map((_, i) => `x${i}`);

  for (const [args, out] of examples) {
    if (args.length !== inputTypes.length) {
      throw new Error("All examples must have the same number of input arguments");
    }
    args.forEach((arg, i) => {
      const inferred = inferLiteralType(arg);
      if (!equalsType(inferred, inputTypes[i]!)) {
        throw new Error(`Inconsistent input type at position ${i}`);
      }
    });
    const outType = inferLiteralType(out);
    if (!equalsType(outType, returnType)) {
      throw new Error("Inconsistent output type across examples");
    }
  }

  return { inputNames, inputTypes, returnType };
};

interface ResolvedSignature {
  readonly inputNames: readonly string[];
  readonly inputTypes: readonly Type[];
  readonly returnType: Type;
  readonly autoExpandedRecursiveInvariantArgNames?: readonly string[];
}

const lowerCamel = (text: string): string =>
  text.length === 0 ? text : text[0]!.toLowerCase() + text.slice(1);

const inferDefaultClassHeapName = (className: string): string => {
  const words = className.match(/[A-Z]+(?![a-z])|[A-Z]?[a-z]+|[0-9]+/g) ?? [];
  const lastAlphaWord = [...words].reverse().find((word) => /[A-Za-z]/.test(word));
  if (lastAlphaWord !== undefined) {
    return `${lastAlphaWord.toLowerCase()}Heap`;
  }
  return `${lowerCamel(className)}Heap`;
};

const resolveSignatureFromAutoExpansion = (
  spec: JsonSynthesisSpec,
  resolveClassType: ((name: string) => Type | null) | undefined,
): ResolvedSignature => {
  if (spec.signature === undefined || spec.signature.autoExpandClassSignature === undefined) {
    throw new Error("Internal error: auto-expansion requested without signature.autoExpandClassSignature");
  }
  const expansion = spec.signature.autoExpandClassSignature;
  const returnType = parseTypeSpecWithResolver(
    asString(spec.signature.returnType, "signature.returnType"),
    resolveClassType,
  );

  if (spec.classes === undefined || spec.classes.length === 0) {
    throw new Error("signature.autoExpandClassSignature requires at least one class definition");
  }
  const className =
    expansion.className !== undefined
      ? asString(expansion.className, "signature.autoExpandClassSignature.className")
      : spec.classes.length === 1
        ? spec.classes[0]!.name
        : (() => {
            throw new Error(
              "signature.autoExpandClassSignature.className is required when multiple classes are defined",
            );
          })();
  const classSpec = spec.classes.find((cls) => cls.name === className);
  if (classSpec === undefined) {
    throw new Error(`Unknown class for signature.autoExpandClassSignature: ${className}`);
  }

  const includeThisRef = expansion.includeThisRef ?? true;
  const thisRefName = includeThisRef
    ? asString(expansion.thisRefName ?? "thisRef", "signature.autoExpandClassSignature.thisRefName")
    : null;
  const classHeapName = asString(
    expansion.classHeapName ?? inferDefaultClassHeapName(className),
    "signature.autoExpandClassSignature.classHeapName",
  );
  const includeRefFieldHeaps = expansion.includeRefFieldHeaps ?? true;
  const selectedFields =
    expansion.fieldHeapFields === undefined
      ? null
      : new Set(
          expansion.fieldHeapFields.map((fieldName, idx) =>
            asString(fieldName, `signature.autoExpandClassSignature.fieldHeapFields[${idx}]`),
          ),
        );
  if (selectedFields !== null) {
    const knownFields = new Set(Object.keys(classSpec.fields));
    for (const fieldName of selectedFields) {
      if (!knownFields.has(fieldName)) {
        throw new Error(`Unknown field in signature.autoExpandClassSignature.fieldHeapFields: ${fieldName}`);
      }
    }
  }
  const fieldHeapNameByField = new Map<string, string>();
  for (const [fieldName, heapName] of Object.entries(expansion.fieldHeapNames ?? {})) {
    if (!(fieldName in classSpec.fields)) {
      throw new Error(`Unknown field in signature.autoExpandClassSignature.fieldHeapNames: ${fieldName}`);
    }
    fieldHeapNameByField.set(
      asString(fieldName, "signature.autoExpandClassSignature.fieldHeapNames field"),
      asString(heapName, `signature.autoExpandClassSignature.fieldHeapNames.${fieldName}`),
    );
  }

  if ("additionalArgs" in (expansion as Record<string, unknown>)) {
    throw new Error(
      "signature.autoExpandClassSignature.additionalArgs is removed; use signature.args instead",
    );
  }

  const usedArgNames = new Set<string>();
  const inputNames: string[] = [];
  const inputTypes: Type[] = [];
  const defaultInvariantArgNames: string[] = [];
  const pushArg = (argName: string, argType: Type): void => {
    if (usedArgNames.has(argName)) {
      throw new Error(`Duplicate signature argument name after auto expansion: ${argName}`);
    }
    usedArgNames.add(argName);
    inputNames.push(argName);
    inputTypes.push(argType);
  };

  if (thisRefName !== null) {
    pushArg(thisRefName, tyRef(tyObject(className)));
  }
  pushArg(classHeapName, tyList(tyObject(className)));
  defaultInvariantArgNames.push(classHeapName);

  for (const [fieldName, fieldTypeRaw] of Object.entries(classSpec.fields)) {
    if (includeRefFieldHeaps !== true) {
      continue;
    }
    if (selectedFields !== null && !selectedFields.has(fieldName)) {
      continue;
    }
    const fieldType = parseTypeSpecWithResolver(
      asString(fieldTypeRaw, `classes.${className}.fields.${fieldName}`),
      resolveClassType,
    );
    const fieldTargetType = refTargetType(fieldType);
    if (fieldTargetType === null) {
      continue;
    }
    const heapName = fieldHeapNameByField.get(fieldName) ?? `${fieldName}Heap`;
    pushArg(heapName, tyList(fieldTargetType));
    defaultInvariantArgNames.push(heapName);
  }

  for (const [idx, arg] of (spec.signature?.args ?? []).entries()) {
    if ("invariant" in (arg as unknown as Record<string, unknown>)) {
      throw new Error("signature.args[].invariant is removed; use signature.args[].immutable instead");
    }
    const argName = asString(arg.name, `signature.args[${idx}].name`);
    const argTypeText = asString(arg.type, `signature.args[${idx}].type`);
    const argType = parseTypeSpecWithResolver(argTypeText, resolveClassType);
    pushArg(argName, argType);
    if (arg.immutable === true) {
      defaultInvariantArgNames.push(argName);
    }
  }

  const autoExpandedRecursiveInvariantArgNames =
    expansion.recursiveInvariantArgNames === undefined
      ? defaultInvariantArgNames
      : expansion.recursiveInvariantArgNames.map((name, idx) =>
          asString(name, `signature.autoExpandClassSignature.recursiveInvariantArgNames[${idx}]`),
        );

  return {
    inputNames,
    inputTypes,
    returnType,
    autoExpandedRecursiveInvariantArgNames,
  };
};

const resolveSignature = (
  spec: JsonSynthesisSpec,
  resolveClassType: ((name: string) => Type | null) | undefined,
): ResolvedSignature => {
  if (spec.signature === undefined) {
    return inferSignatureFromExamples(spec.examples);
  }

  const hasExplicitInputNames = Array.isArray(spec.signature.inputNames);
  const hasExplicitInputTypes = Array.isArray(spec.signature.inputTypes);
  const hasAutoExpansion = spec.signature.autoExpandClassSignature !== undefined;
  const hasClassSpec = spec.classes !== undefined && spec.classes.length > 0;
  const shouldUseImplicitAutoExpansion = !hasAutoExpansion && !hasExplicitInputNames && !hasExplicitInputTypes && hasClassSpec;

  if (hasAutoExpansion && (hasExplicitInputNames || hasExplicitInputTypes)) {
    throw new Error(
      "signature.autoExpandClassSignature cannot be combined with signature.inputNames/inputTypes",
    );
  }

  if (hasAutoExpansion || shouldUseImplicitAutoExpansion) {
    if (shouldUseImplicitAutoExpansion) {
      const normalized: JsonSynthesisSpec = {
        ...spec,
        signature: {
          ...spec.signature,
          autoExpandClassSignature: {},
        },
      };
      return resolveSignatureFromAutoExpansion(normalized, resolveClassType);
    }
    return resolveSignatureFromAutoExpansion(spec, resolveClassType);
  }

  if (!hasExplicitInputNames || !hasExplicitInputTypes) {
    throw new Error(
      "signature requires either inputNames/inputTypes or autoExpandClassSignature",
    );
  }
  if (spec.signature.inputNames!.length !== spec.signature.inputTypes!.length) {
    throw new Error("signature.inputNames and signature.inputTypes must have the same length");
  }
  const inputNames = spec.signature.inputNames!.map((name, idx) =>
    asString(name, `signature.inputNames[${idx}]`),
  );
  const inputTypes = spec.signature.inputTypes!.map((typeName, idx) =>
    parseTypeSpecWithResolver(asString(typeName, `signature.inputTypes[${idx}]`), resolveClassType),
  );
  const returnType = parseTypeSpecWithResolver(
    asString(spec.signature.returnType, "signature.returnType"),
    resolveClassType,
  );
  return { inputNames, inputTypes, returnType };
};

const inferClassInvariantArgNames = (
  spec: JsonSynthesisSpec,
  signature: {
    readonly inputNames: readonly string[];
    readonly inputTypes: readonly Type[];
  },
  resolveClassType: ((name: string) => Type | null) | undefined,
): readonly string[] => {
  if (spec.classes === undefined || spec.classes.length === 0) {
    return [];
  }

  const classListElemTypes = spec.classes.map((cls) => tyObject(cls.name));
  const fieldHeapElemTypes: Type[] = [];
  for (const cls of spec.classes) {
    for (const [fieldName, fieldTypeRaw] of Object.entries(cls.fields)) {
      const fieldType = parseTypeSpecWithResolver(
        asString(fieldTypeRaw, `classes.${cls.name}.fields.${fieldName}`),
        resolveClassType,
      );
      const target = refTargetType(fieldType);
      if (target !== null) {
        fieldHeapElemTypes.push(target);
      }
    }
  }

  const inferred = signature.inputNames.filter((name, index) => {
    if (!name.endsWith("Heap")) {
      return false;
    }
    const inputType = signature.inputTypes[index];
    if (inputType === undefined) {
      return false;
    }
    const elem = listElemType(inputType);
    if (elem === null) {
      return false;
    }
    if (classListElemTypes.some((ty) => equalsType(elem, ty))) {
      return true;
    }
    if (fieldHeapElemTypes.some((ty) => equalsType(elem, ty))) {
      return true;
    }
    return false;
  });

  return inferred;
};

export const prepareJsonSynthesisJob = (spec: JsonSynthesisSpec): PreparedJsonSynthesisJob => {
  const prepared = prepareJsonSynthesisSpec(spec);
  const functionName = prepared.name ?? "synthesized";
  const resolveClassType = buildClassTypeResolver(spec.classes);
  const signature = resolveSignature(spec, resolveClassType);
  const hasExplicitInputNames = Array.isArray(spec.signature?.inputNames);
  const hasExplicitInputTypes = Array.isArray(spec.signature?.inputTypes);
  const usesAutoExpandedSignature =
    spec.signature?.autoExpandClassSignature !== undefined ||
    (spec.signature !== undefined &&
      !hasExplicitInputNames &&
      !hasExplicitInputTypes &&
      spec.classes !== undefined &&
      spec.classes.length > 0);

  const autoClassFieldDefs = buildAutoClassFieldComponentDefs(
    spec,
    signature,
    functionName,
    new Set(prepared.env.keys()),
  );
  const autoClassFieldComponents = autoClassFieldDefs.length === 0 ? [] : defineComponents(autoClassFieldDefs);
  const explicitAndAutoComponents =
    autoClassFieldComponents.length === 0 ? prepared.components : [...prepared.components, ...autoClassFieldComponents];
  const components = mergeWithImplicitJsonComponents(explicitAndAutoComponents);
  const env = createComponentEnv(components);

  const oracle =
    spec.oracle?.kind === "table"
      ? createOracleFromTable(
          literalExamples(spec.oracle.entries),
          spec.oracle.default === undefined || spec.oracle.default === "error" ? valueError : literalToValue(spec.oracle.default),
        )
      : spec.oracle?.kind === "js"
        ? createOracleFromJs(
            spec.oracle.args ??
              (usesAutoExpandedSignature ? signature.inputNames : undefined),
            asString(spec.oracle.body, "oracle.body"),
          )
        : spec.oracle?.kind === "componentRef"
        ? (() => {
            const refName = asString(spec.oracle.name, "oracle.name");
            const comp = libraryComponentByName.get(refName);
            if (comp === undefined) {
              throw new Error(`Unknown oracle component: ${refName}`);
            }
            return (args: ArgList) => comp.executeEfficient(args);
          })()
      : createOracleFromExamples(prepared.examples);

  const recursiveInvariantArgIndices = (() => {
    const recursiveInvariantArgNames =
      spec.signature?.recursiveInvariantArgNames ??
      signature.autoExpandedRecursiveInvariantArgNames ??
      spec.recursiveInvariantArgNames;
    if (recursiveInvariantArgNames !== undefined) {
      const indexByName = new Map(signature.inputNames.map((name, idx) => [name, idx] as const));
      const requested = new Set<number>();
      for (const [idx, name] of recursiveInvariantArgNames.entries()) {
        const normalized = asString(name, `recursiveInvariantArgNames[${idx}]`);
        const found = indexByName.get(normalized);
        if (found === undefined) {
          throw new Error(`Unknown recursiveInvariantArgNames entry: ${normalized}`);
        }
        requested.add(found);
      }
      return signature.inputNames
        .map((_, idx) => idx)
        .filter((idx) => requested.has(idx));
    }
    const inferred = inferClassInvariantArgNames(spec, signature, resolveClassType);
    if (inferred.length > 0) {
      const requested = new Set(inferred);
      return signature.inputNames
        .map((_, idx) => idx)
        .filter((idx) => requested.has(signature.inputNames[idx]!));
    }
    const fixedClassRecursivePattern = spec.signature?.fixedClassRecursivePattern ?? spec.fixedClassRecursivePattern;
    if (fixedClassRecursivePattern === true) {
      const thisRefIndex = signature.inputNames.indexOf("thisRef");
      if (thisRefIndex < 0) {
        throw new Error("fixedClassRecursivePattern=true requires signature.inputNames to include 'thisRef'");
      }
      return signature.inputNames
        .map((_, idx) => idx)
        .filter((idx) => idx > thisRefIndex);
    }
    return [];
  })();

  return {
    ...prepared,
    components,
    env,
    functionName,
    inputNames: signature.inputNames,
    inputTypes: signature.inputTypes,
    returnType: signature.returnType,
    oracle,
    recursiveInvariantArgIndices,
  };
};
