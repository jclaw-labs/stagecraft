/**
 * Walk templates/musician-site and write its text files to
 * src/generated/musician-site-template.ts. See src/lib/template-bundle.ts.
 */

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { renderTemplateModule } from "../src/lib/template-bundle";
import { readTemplateFiles } from "../src/lib/template-reader";

const appDir = path.resolve(import.meta.dirname, "..");
const templateDir = path.resolve(appDir, "../../templates/musician-site");
const outFile = path.join(appDir, "src/generated/musician-site-template.ts");

const files = await readTemplateFiles(templateDir);
if (files.length === 0) {
  throw new Error(`No template files found under ${templateDir}`);
}

await mkdir(path.dirname(outFile), { recursive: true });
await writeFile(outFile, renderTemplateModule(files));
console.log(`bundle-template: wrote ${files.length} files to ${path.relative(appDir, outFile)}`);
