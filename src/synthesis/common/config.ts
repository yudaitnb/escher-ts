import { anyArgSmaller, type ArgListCompare } from "../../components/component.js";

export type GoalSearchStrategy = "then-first" | "cond-first";

export interface BaseSynthesisConfig {
  maxCost: number;
  deleteAllErr: boolean;
  timeoutMs: number | null;
  argListCompare: ArgListCompare;
  enforceDecreasingMeasure: boolean;
  recursiveInvariantArgIndices: readonly number[];
  searchSizeFactor: number;
  goalSearchStrategy: GoalSearchStrategy;
}

export const defaultBaseSynthesisConfig: BaseSynthesisConfig = {
  maxCost: Number.MAX_SAFE_INTEGER,
  deleteAllErr: true,
  timeoutMs: 1000,
  argListCompare: anyArgSmaller,
  enforceDecreasingMeasure: true,
  recursiveInvariantArgIndices: [],
  searchSizeFactor: 3,
  goalSearchStrategy: "then-first",
};

export const createDeadline = (timeoutMs: number | null): number | null =>
  timeoutMs === null ? null : Date.now() + timeoutMs;

export const isTimedOut = (deadlineMs: number | null): boolean =>
  deadlineMs !== null && Date.now() >= deadlineMs;
