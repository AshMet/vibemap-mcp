#!/usr/bin/env node
/**
 * D-296 guard — proves the security `overrides` in pnpm-workspace.yaml ACTUALLY
 * APPLIED to the installed tree.
 *
 * The bug this exists for: those pins used to live in package.json under
 * `pnpm.overrides`. pnpm 11 stopped reading the `pnpm` field in package.json, so
 * every pin quietly stopped applying — on a PUBLISHED package. Nothing failed;
 * CI just happened to pin pnpm 10. A pin that can silently stop applying needs a
 * check that a pin actually applied, not a check that the file mentions it.
 *
 * So this asserts, against the REAL install:
 *   1. pnpm-workspace.yaml declares a non-empty `overrides` block;
 *   2. package.json carries NO `pnpm.overrides` — the inert location, which
 *      would look like a working pin while doing nothing;
 *   3. pnpm-lock.yaml's own `overrides` block matches (1) exactly — this is what
 *      pnpm recorded when it resolved, so a mismatch means the lockfile was
 *      written by a pnpm that did not see these settings;
 *   4. every version of an overridden package physically present under
 *      node_modules/.pnpm satisfies its pin.
 *
 * (4) is the one that cannot be faked by editing a file, and (3) is the one that
 * catches a lockfile regenerated without the settings. Run it AFTER `pnpm
 * install` — it reads node_modules.
 *
 * Deliberately dependency-free: it is the thing that checks the dependency tree,
 * so it must not need the dependency tree to run. That is why the YAML and
 * semver handling below are hand-rolled and deliberately narrow — they REJECT
 * anything they do not fully understand rather than skipping it, because a check
 * that silently skips is the exact failure mode being fixed.
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// ── Minimal YAML: a flat `overrides:` block of `key: value` pairs ─────────────
//
// Both pnpm-workspace.yaml and pnpm-lock.yaml write this block the same way: a
// top-level `overrides:` key followed by two-space-indented scalar entries.
// Anything more structured than that (nested maps, anchors, multi-line scalars)
// throws rather than being half-parsed.

/** @returns {Record<string,string>|null} null when the block is absent entirely. */
export function parseOverridesBlock(yamlText) {
  const lines = yamlText.split("\n");
  const start = lines.findIndex((l) => /^overrides:\s*(#.*)?$/.test(l));
  if (start === -1) return null;

  /** @type {Record<string,string>} */
  const out = {};
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === "" || /^\s*#/.test(line)) continue;
    if (!/^\s/.test(line)) break; // dedent to column 0 ends the block
    const m = line.match(/^ {2}(?:'([^']+)'|"([^"]+)"|([^:#\s][^:]*?))\s*:\s*(.+?)\s*$/);
    if (!m) {
      throw new Error(
        `assert-overrides: cannot parse overrides entry (only flat "name: range" pairs are supported): ${JSON.stringify(line)}`
      );
    }
    const name = m[1] ?? m[2] ?? m[3];
    const range = m[4].replace(/^['"]|['"]$/g, "");
    out[name] = range;
  }
  return out;
}

// ── Minimal semver: exact and caret ranges only ──────────────────────────────

/** @returns {[number,number,number]} */
function parseVersion(v) {
  const m = String(v).match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!m) throw new Error(`assert-overrides: unparseable version ${JSON.stringify(v)}`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

const gte = (a, b) =>
  a[0] !== b[0] ? a[0] > b[0] : a[1] !== b[1] ? a[1] > b[1] : a[2] >= b[2];

/**
 * True when `version` satisfies `range`. Supports `^x.y.z` (with correct 0.x and
 * 0.0.x narrowing) and a bare exact `x.y.z`. Every other range syntax THROWS —
 * extend this function rather than letting an unrecognised pin go unchecked.
 */
export function satisfies(version, range) {
  const v = parseVersion(version);
  if (/^\d+\.\d+\.\d+/.test(range)) {
    const e = parseVersion(range);
    return v[0] === e[0] && v[1] === e[1] && v[2] === e[2];
  }
  if (range.startsWith("^")) {
    const [maj, min, pat] = parseVersion(range.slice(1));
    if (!gte(v, [maj, min, pat])) return false;
    if (maj > 0) return v[0] === maj;
    if (min > 0) return v[0] === 0 && v[1] === min;
    return v[0] === 0 && v[1] === 0 && v[2] === pat;
  }
  throw new Error(
    `assert-overrides: unsupported range ${JSON.stringify(range)}. Only "^x.y.z" and exact "x.y.z" are understood — teach satisfies() the new syntax instead of loosening this check.`
  );
}

// ── Installed-tree scan ──────────────────────────────────────────────────────

/**
 * Every version of `name` physically materialised under node_modules/.pnpm.
 * Directory names are `<name>@<version>` with `/` written as `+` for scopes, and
 * an optional peer-suffix after `_` or `(`.
 */
export function installedVersionsOf(entries, name) {
  const prefix = `${name.replace("/", "+")}@`;
  const found = new Set();
  for (const entry of entries) {
    if (!entry.startsWith(prefix)) continue;
    const rest = entry.slice(prefix.length);
    const version = rest.split(/[_(]/)[0];
    if (/^\d+\.\d+\.\d+/.test(version)) found.add(version);
  }
  return [...found].sort();
}

// ── The check ────────────────────────────────────────────────────────────────

/**
 * Pure so it is testable without an install.
 * @returns {{failures: string[], checked: string[], absent: string[]}}
 */
export function checkOverrides({ workspaceYaml, lockYaml, packageJson, storeEntries }) {
  const failures = [];
  const checked = [];
  const absent = [];

  const intended = parseOverridesBlock(workspaceYaml);
  if (!intended || Object.keys(intended).length === 0) {
    failures.push(
      "pnpm-workspace.yaml declares no `overrides` block. The security pins must live there — pnpm 11 ignores package.json's `pnpm` field."
    );
    return { failures, checked, absent };
  }

  if (packageJson?.pnpm?.overrides) {
    failures.push(
      `package.json still carries pnpm.overrides (${Object.keys(packageJson.pnpm.overrides).join(", ")}). pnpm 11 IGNORES that field, so those pins do nothing. Move them to pnpm-workspace.yaml.`
    );
  }

  const locked = parseOverridesBlock(lockYaml);
  if (!locked) {
    failures.push(
      "pnpm-lock.yaml records no `overrides` block, so it was resolved without the pins. Re-run `pnpm install`."
    );
  } else {
    for (const [name, range] of Object.entries(intended)) {
      if (locked[name] !== range) {
        failures.push(
          `pnpm-lock.yaml records overrides[${name}] = ${JSON.stringify(locked[name] ?? null)} but pnpm-workspace.yaml intends ${JSON.stringify(range)}. The lockfile was written without these settings.`
        );
      }
    }
    for (const name of Object.keys(locked)) {
      if (!(name in intended)) {
        failures.push(
          `pnpm-lock.yaml records an override for ${name} that pnpm-workspace.yaml no longer declares. Re-run \`pnpm install\`.`
        );
      }
    }
  }

  if (!storeEntries || storeEntries.length === 0) {
    failures.push(
      "node_modules/.pnpm is missing or empty — run `pnpm install` before this guard. Refusing to pass on an unbuilt tree."
    );
    return { failures, checked, absent };
  }

  for (const [name, range] of Object.entries(intended)) {
    const versions = installedVersionsOf(storeEntries, name);
    if (versions.length === 0) {
      absent.push(name);
      continue;
    }
    checked.push(name);
    for (const v of versions) {
      if (!satisfies(v, range)) {
        failures.push(
          `${name}@${v} is installed but the pin requires ${range}. The override did not apply.`
        );
      }
    }
  }

  // A guard that checked nothing is not a guard. At least one pinned package has
  // to be genuinely present, or the pass is vacuous.
  if (checked.length === 0) {
    failures.push(
      `None of the ${Object.keys(intended).length} pinned packages are present in the installed tree, so nothing was actually verified. Either the install is broken or the pins are all dead and should be removed.`
    );
  }

  return { failures, checked, absent };
}

// ── CLI ──────────────────────────────────────────────────────────────────────

function main() {
  let storeEntries = [];
  try {
    storeEntries = readdirSync(join(ROOT, "node_modules", ".pnpm"));
  } catch {
    /* reported by checkOverrides as an empty tree */
  }

  const { failures, checked, absent } = checkOverrides({
    workspaceYaml: readFileSync(join(ROOT, "pnpm-workspace.yaml"), "utf8"),
    lockYaml: readFileSync(join(ROOT, "pnpm-lock.yaml"), "utf8"),
    packageJson: JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")),
    storeEntries,
  });

  if (failures.length > 0) {
    console.error("assert-overrides: FAILED — dependency pins are not being applied.\n");
    for (const f of failures) console.error(`  ✗ ${f}`);
    console.error(
      "\nSee the `overrides` block in pnpm-workspace.yaml. pnpm 11 no longer reads package.json's `pnpm` field."
    );
    process.exit(1);
  }

  console.log(
    `assert-overrides: OK — ${checked.length} pin(s) verified against the installed tree (${checked.join(", ")}).`
  );
  if (absent.length > 0) {
    console.log(
      `assert-overrides: ${absent.length} pin(s) are preventative — not in the tree right now: ${absent.join(", ")}.`
    );
  }
}

// Importable by tests without running the CLI.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
