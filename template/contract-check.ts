// Compile-time proof that the starter components satisfy the gallery contracts, and that each has one.
import type { Contracts } from "../shared/contracts.ts";
import type { AddedContracts } from "./components/contracts.ts";
import * as components from "./components/index.ts";

export const templateSatisfiesContracts: Contracts & AddedContracts = components;

type Uncovered = Exclude<keyof typeof components, keyof Contracts | keyof AddedContracts>;
export const templateExportsHaveContracts: [Uncovered] extends [never] ? true : { missingContractFor: Uncovered } = true;
