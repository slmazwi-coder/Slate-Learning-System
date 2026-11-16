/*
 * © 2026 Age thirty4 technologies. All Rights Reserved.
 * Proprietary and Confidential.
 * Unauthorized copying of this file, via any means, is strictly prohibited.
 */

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ignoredDirectories = new Set([
  "node_modules",
  "dist",
  "build",
  ".next",
  ".git",
  "coverage",
  ".vercel",
]);
const extensions = new Set([".ts", ".tsx", ".js", ".jsx"]);
const owner = ["Age thirty4", "technologies"].join(" ");
const ownerBytes = Buffer.from(owner);
const header = Buffer.from(`/*
 * © 2026 ${owner}. All Rights Reserved.
 * Proprietary and Confidential.
 * Unauthorized copying of this file, via any means, is strictly prohibited.
 */

`);
let scanned = 0;
let updated = 0;
let failed = false;

function scan(directory) {
  let entries;
  try {
    entries = readdirSync(directory, { withFileTypes: true });
  } catch (error) {
    console.error(`Could not read directory ${directory}: ${error.message}`);
    failed = true;
    return;
  }

  for (const entry of entries) {
    const filePath = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!ignoredDirectories.has(entry.name)) scan(filePath);
    } else if (entry.isFile() && extensions.has(extname(entry.name))) {
      scanned++;
      try {
        const contents = readFileSync(filePath);
        if (contents.includes(ownerBytes)) continue;
        writeFileSync(filePath, Buffer.concat([header, contents]));
        updated++;
      } catch (error) {
        console.error(`Could not update file ${filePath}: ${error.message}`);
        failed = true;
      }
    }
  }
}

scan(repositoryRoot);
console.log(`Files scanned: ${scanned}`);
console.log(`Files updated: ${updated}`);
if (failed) process.exitCode = 1;
