#!/usr/bin/env node
/**
 * Rewrites every version in server.json from package.json.
 *
 * server.json is the MCP Registry manifest. It is the one place the version has
 * to be duplicated — the registry schema wants a literal, and it is not
 * JavaScript so it cannot import anything. It drifted to 2.8.1 while npm was on
 * 2.9.0, which meant the registry advertised a release that was never published
 * with those contents.
 *
 * Wired to npm's `version` lifecycle hook, so `npm version <patch|minor|major>`
 * updates server.json inside the same version commit. Also runnable directly
 * (`npm run sync-version`) and safe to re-run — it is a no-op when already in
 * sync, and exits non-zero only if it cannot parse the files.
 *
 * Prints nothing on a no-op so it stays quiet in the common case.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkgPath = join(root, "package.json");
const manifestPath = join(root, "server.json");

const { version } = JSON.parse(readFileSync(pkgPath, "utf8"));
if (!/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(version ?? "")) {
  console.error(`sync-version: package.json version is not semver: ${JSON.stringify(version)}`);
  process.exit(1);
}

const raw = readFileSync(manifestPath, "utf8");
const manifest = JSON.parse(raw);

const before = [manifest.version, ...(manifest.packages ?? []).map((p) => p.version)];
manifest.version = version;
for (const pkg of manifest.packages ?? []) pkg.version = version;

// Preserve the file's trailing newline convention.
const next = `${JSON.stringify(manifest, null, 2)}${raw.endsWith("\n") ? "\n" : ""}`;
if (next !== raw) {
  writeFileSync(manifestPath, next);
  console.log(`sync-version: server.json ${before.join("/")} -> ${version}`);
}
