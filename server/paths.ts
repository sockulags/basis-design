import path from "node:path";
import { SOURCE_FOLDERS } from "../shared/frame.ts";

/** Where Basis itself is installed: templates, contracts and node_modules live here. */
export const repoRoot = path.resolve(import.meta.dirname, "..");

export const DESIGN_FILE = "design-system.json";
export const COMPONENTS_DIR = "components";
export const PATTERNS_DIR = "patterns";

/** Folders of agent-owned source, one per gallery page: base components, patterns composed from them. */
export const SOURCE_DIRS: string[] = SOURCE_FOLDERS;

/** True for a workspace-relative, forward-slash path inside one of the source folders. */
export const isSourcePath = (relative: string) => SOURCE_DIRS.some((dir) => relative.startsWith(`${dir}/`));
