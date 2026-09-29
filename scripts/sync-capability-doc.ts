/** Rewrites the matrix in docs/BROWSER-CAPABILITIES.md from packages/browser-adapter. Run: node scripts/sync-capability-doc.ts */
import { readFile, writeFile } from "node:fs/promises";
import { renderMatrixMarkdown } from "../packages/browser-adapter/src/capabilities.ts";

const file = new URL("../docs/BROWSER-CAPABILITIES.md", import.meta.url);
const doc = await readFile(file, "utf8");
const [head, rest] = doc.split("<!-- matrix:start -->");
const tail = rest?.split("<!-- matrix:end -->")[1];
if (head === undefined || tail === undefined)
  throw new Error("Markers <!-- matrix:start --> / <!-- matrix:end --> not found");
await writeFile(file, `${head}<!-- matrix:start -->\n${renderMatrixMarkdown()}\n<!-- matrix:end -->${tail}`);
console.log("docs/BROWSER-CAPABILITIES.md updated");
