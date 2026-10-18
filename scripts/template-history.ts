// Writes template/history.json: for every starter file, the hashes of its earlier versions in this repository's
// history. Basis replaces a workspace file that still matches one of them, since nobody changed it. Run it after
// changing anything in template/ (`npm run template:history`); test/template-history.test.ts fails until you do.
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { earlierTemplateHashes, TEMPLATE_HISTORY_FILE } from "../server/template.ts";

const root = path.resolve(import.meta.dirname, "..");
const history = earlierTemplateHashes(root);
await writeFile(path.join(root, TEMPLATE_HISTORY_FILE), `${JSON.stringify(history, null, 2)}\n`);
console.log(`${TEMPLATE_HISTORY_FILE}: ${Object.keys(history).length} files`);
