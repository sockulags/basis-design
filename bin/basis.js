#!/usr/bin/env node
// Starts Basis. The server is TypeScript run as it is (Vite compiles workspace code live anyway), so tsx loads it.
import { register } from "tsx/esm/api";

register();
await import("../server/index.ts");
