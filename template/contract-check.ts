// Compile-time proof that the starter components satisfy the gallery contracts.
import type { Contracts } from "../shared/contracts.ts";
import * as components from "./components/index.ts";

export const templateSatisfiesContracts: Contracts = components;
