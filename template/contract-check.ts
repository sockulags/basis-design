// Compile-time proof that the starter components satisfy the gallery contracts, and that each has one.
import type { Contracts } from "../shared/contracts.ts";
import type { AddedContracts } from "./components/contracts.ts";
import * as components from "./components/index.ts";
import type { PatternContracts } from "../shared/pattern-contracts.ts";
import type { AddedPatternContracts } from "./patterns/contracts.ts";
import type { IconName } from "./patterns/icons.tsx";
import * as patterns from "./patterns/index.ts";

export const templateSatisfiesContracts: Contracts & AddedContracts = components;

type Uncovered = Exclude<keyof typeof components, keyof Contracts | keyof AddedContracts>;
export const templateExportsHaveContracts: [Uncovered] extends [never] ? true : { missingContractFor: Uncovered } =
  true;

// The same for the starter patterns and their baseline contracts.
export const templateSatisfiesPatternContracts: PatternContracts<IconName> & AddedPatternContracts = patterns;

type UncoveredPattern = Exclude<keyof typeof patterns, keyof PatternContracts<IconName> | keyof AddedPatternContracts>;
export const templatePatternsHaveContracts: [UncoveredPattern] extends [never]
  ? true
  : { missingContractFor: UncoveredPattern } = true;
