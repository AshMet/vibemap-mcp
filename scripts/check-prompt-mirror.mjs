#!/usr/bin/env node
/**
 * mcp-gen-prompt-list-unenforced-mirror guard.
 *
 * `src/prompts/definitions.ts` hardcodes a static mirror of the `gen_*`
 * prompt names the main VibeMap app's backend derives dynamically from its
 * own command registry. The two lists agree today; nothing enforces they
 * keep agreeing — a command added or removed on either side silently drifts
 * (a 404 at `prompts/get`, or a gap the IDE never offers).
 *
 * This repo cannot see that other repo's live registry from CI without a
 * network call, and the endpoint that *would* answer it
 * (`GET /api/mcp/prompts`) requires an authenticated, Pro+ PAT before it will
 * even reach the "unknown name" branch that lists `available` prompts — so
 * there is no unauthenticated, stable URL this CI can hit today.
 *
 * KNOWN GAP (flagged for a human, not solved here): true cross-repo drift
 * detection needs a counterpart check in the OTHER repo — e.g. a route or
 * test there that fails if `listCommands()`'s generation-kind names diverge
 * from a copy of this file's expected set, or a scheduled job that diffs the
 * two over the network with real credentials. Until that exists, this script
 * only catches drift INSIDE this repo: a `gen_*` entry added, renamed, or
 * edited in a way that breaks the conventions this file's own comments
 * document. It cannot catch the other repo changing without this one
 * noticing.
 *
 * Checks (all against this repo's own `PROMPT_DEFINITIONS`):
 *   1. No duplicate prompt names.
 *   2. Every `gen_*` name is lower_snake_case and does not carry the
 *      `gen_gen_` double-prefix bug the file's comments call out by name.
 *   3. The set of `gen_*` names matches the 7 names documented in this
 *      script (kept in sync with the comment block in definitions.ts) —
 *      catches an accidental add/remove/rename slipping through review.
 *   4. Every `gen_*` entry's description carries the shared METERED_NOTE
 *      marker, so a newly added metered prompt can't forget to disclose
 *      metering.
 *   5. Every `gen_*` entry's `arguments` is exactly `[projectId]` (required) —
 *      catches a gen_* prompt accidentally gaining/losing an arg.
 *
 * Run after `pnpm build` (reads the compiled output, like the rest of this
 * repo's checks run post-build) — see package.json's `check:prompt-mirror`
 * and .github/workflows/test.yml.
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// The 7 `gen_*` names documented in src/prompts/definitions.ts as of this
// writing. Update this list in the SAME PR that adds/removes/renames a
// `gen_*` prompt — that is the point of the check: a silent, unreviewed
// change to the mirror should fail CI.
export const EXPECTED_GEN_NAMES = [
  "gen_personas",
  "gen_features",
  "gen_stories",
  "gen_criteria",
  "gen_pages",
  "gen_schema",
  "gen_sync_criteria_from_pages",
];

const GEN_NAME_RE = /^gen_[a-z0-9]+(?:_[a-z0-9]+)*$/;

/**
 * Pure so it is testable without importing the built module.
 * @param {Array<{name: string, description: string, arguments?: Array<{name: string, required?: boolean}>}>} definitions
 * @returns {{failures: string[], genNames: string[]}}
 */
export function checkPromptMirror(definitions) {
  const failures = [];

  const names = definitions.map((d) => d.name);
  const seen = new Set();
  for (const name of names) {
    if (seen.has(name)) {
      failures.push(`Duplicate prompt name: ${JSON.stringify(name)}.`);
    }
    seen.add(name);
  }

  const genDefs = definitions.filter((d) => d.name.startsWith("gen_"));
  const genNames = genDefs.map((d) => d.name);

  for (const name of genNames) {
    if (!GEN_NAME_RE.test(name)) {
      failures.push(
        `${JSON.stringify(name)} is not lower_snake_case (expected to match ${GEN_NAME_RE}).`
      );
    }
    if (name.startsWith("gen_gen_")) {
      failures.push(
        `${JSON.stringify(name)} carries the double "gen_gen_" prefix bug — strip the ` +
          `command's own leading "gen-" before re-prefixing with "gen_".`
      );
    }
  }

  const expected = new Set(EXPECTED_GEN_NAMES);
  const actual = new Set(genNames);
  for (const name of expected) {
    if (!actual.has(name)) {
      failures.push(
        `Expected gen_* prompt ${JSON.stringify(name)} is missing from PROMPT_DEFINITIONS. ` +
          `If it was intentionally removed, update EXPECTED_GEN_NAMES in scripts/check-prompt-mirror.mjs ` +
          `in the same PR — and double-check the main app's listCommands() dropped it too.`
      );
    }
  }
  for (const name of actual) {
    if (!expected.has(name)) {
      failures.push(
        `${JSON.stringify(name)} is a gen_* prompt not in EXPECTED_GEN_NAMES. ` +
          `If it was intentionally added, update EXPECTED_GEN_NAMES in scripts/check-prompt-mirror.mjs ` +
          `in the same PR — and confirm the main app's listCommands() actually serves it (otherwise ` +
          `this is a guaranteed 404 at prompts/get).`
      );
    }
  }

  for (const def of genDefs) {
    if (typeof def.description !== "string" || !def.description.includes("METERED")) {
      failures.push(
        `${JSON.stringify(def.name)}'s description does not carry the METERED_NOTE marker — every ` +
          `gen_* prompt must disclose that it runs on VibeMap's metered models, not the caller's.`
      );
    }
    const args = def.arguments ?? [];
    const projectArgOnly =
      args.length === 1 && args[0]?.name === "projectId" && args[0]?.required === true;
    if (!projectArgOnly) {
      failures.push(
        `${JSON.stringify(def.name)}'s arguments are ${JSON.stringify(args)}, expected exactly ` +
          `[{ name: "projectId", required: true }].`
      );
    }
  }

  return { failures, genNames };
}

// ── CLI ──────────────────────────────────────────────────────────────────────

async function main() {
  const buildPath = join(ROOT, "build", "prompts", "definitions.js");
  let PROMPT_DEFINITIONS;
  try {
    ({ PROMPT_DEFINITIONS } = await import(buildPath));
  } catch (err) {
    console.error(
      `check-prompt-mirror: could not import ${buildPath} — run \`pnpm build\` first.\n  ${err instanceof Error ? err.message : String(err)}`
    );
    process.exit(1);
    return;
  }

  const { failures, genNames } = checkPromptMirror(PROMPT_DEFINITIONS);

  if (failures.length > 0) {
    console.error("check-prompt-mirror: FAILED — the gen_* prompt mirror is self-inconsistent.\n");
    for (const f of failures) console.error(`  ✗ ${f}`);
    console.error(
      "\nNote: this check only catches drift WITHIN this repo. It does not (and currently " +
        "cannot, without authenticated network access) verify against the main app's live " +
        "listCommands() registry — see the comment at the top of scripts/check-prompt-mirror.mjs."
    );
    process.exit(1);
  }

  console.log(
    `check-prompt-mirror: OK — ${genNames.length} gen_* prompt(s) are internally consistent (${genNames.join(", ")}).`
  );
  console.log(
    "check-prompt-mirror: reminder — true cross-repo drift detection still needs a counterpart " +
      "check on the backend side (see the top-of-file comment)."
  );
}

// Importable by tests without running the CLI.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
