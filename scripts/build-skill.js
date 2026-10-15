#!/usr/bin/env node

/**
 * Packages skill/ into dist/coach-skill.zip.
 *
 * The original project's `build:skill` script shells out to the Unix `zip`
 * CLI, which isn't present by default on Windows (no system `zip` binary in
 * Git Bash/PowerShell). This uses JSZip instead - already a dependency of
 * this project - so the build works the same on Windows, macOS, and Linux
 * with no external tools required.
 */

import { readdirSync, statSync, mkdirSync, writeFileSync, readFileSync } from "fs";
import { join, dirname, relative } from "path";
import { fileURLToPath } from "url";
import JSZip from "jszip";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..");
const skillDir = join(repoRoot, "skill");
const distDir = join(repoRoot, "dist");
const outFile = join(distDir, "coach-skill.zip");

function walk(dir, files = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === ".DS_Store") continue;
    const fullPath = join(dir, entry);
    if (statSync(fullPath).isDirectory()) {
      walk(fullPath, files);
    } else {
      files.push(fullPath);
    }
  }
  return files;
}

async function main() {
  const zip = new JSZip();

  for (const filePath of walk(skillDir)) {
    // Zip entries use forward slashes regardless of host OS.
    const entryName = relative(skillDir, filePath).split("\\").join("/");
    zip.file(entryName, readFileSync(filePath));
  }

  mkdirSync(distDir, { recursive: true });
  const buffer = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  writeFileSync(outFile, buffer);

  console.log(`Skill packaged to ${relative(repoRoot, outFile)}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
