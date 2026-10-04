/**
 * mcp-gen-prompt-list-unenforced-mirror — the gen_* prompt mirror
 * self-consistency guard.
 *
 * src/prompts/definitions.ts hardcodes a static copy of the gen_* names the
 * main VibeMap app derives dynamically from listCommands(). This repo cannot
 * see that app's live registry from CI, so checkPromptMirror only catches
 * drift WITHIN this repo's own PROMPT_DEFINITIONS — these tests are the
 * mutation proof for that: each one breaks a convention the file's own
 * comments document and asserts the guard actually refuses it.
 */
import { describe, expect, it } from "vitest";
// @ts-expect-error — dependency-free .mjs guard, deliberately not part of tsconfig's src build
import { checkPromptMirror, EXPECTED_GEN_NAMES } from "../scripts/check-prompt-mirror.mjs";
import { PROMPT_DEFINITIONS } from "../src/prompts/definitions";

const PROJECT_ARG = { name: "projectId", description: "x", required: true };
const METERED = "METERED: it uses VibeMap's models.";

const baseGenDef = (name: string) => ({
  name,
  description: `Do the thing. ${METERED}`,
  arguments: [PROJECT_ARG],
});

describe("checkPromptMirror", () => {
  it("passes against this repo's real PROMPT_DEFINITIONS", () => {
    const { failures, genNames } = checkPromptMirror(PROMPT_DEFINITIONS);
    expect(failures).toEqual([]);
    expect(genNames.sort()).toEqual([...EXPECTED_GEN_NAMES].sort());
  });

  // ── MUTATION: duplicate names ────────────────────────────────────────────

  it("FAILS on a duplicate prompt name", () => {
    const defs = [
      { name: "new_project", description: "x", arguments: [] },
      { name: "new_project", description: "y", arguments: [] },
    ];
    const { failures } = checkPromptMirror(defs);
    expect(failures.join("\n")).toMatch(/Duplicate prompt name/);
  });

  // ── MUTATION: the gen_gen_ double-prefix bug ─────────────────────────────

  it("FAILS when a gen_* name carries the gen_gen_ double prefix", () => {
    const defs = EXPECTED_GEN_NAMES.map((n: string) =>
      n === "gen_features" ? baseGenDef("gen_gen_features") : baseGenDef(n)
    );
    const { failures } = checkPromptMirror(defs);
    expect(failures.join("\n")).toMatch(/double "gen_gen_" prefix bug/);
  });

  // ── MUTATION: a name that isn't lower_snake_case ─────────────────────────

  it("FAILS when a gen_* name is not lower_snake_case", () => {
    const defs = EXPECTED_GEN_NAMES.map((n: string) =>
      n === "gen_features" ? baseGenDef("gen_Features") : baseGenDef(n)
    );
    const { failures } = checkPromptMirror(defs);
    expect(failures.join("\n")).toMatch(/not lower_snake_case/);
  });

  // ── MUTATION: an expected name goes missing ──────────────────────────────

  it("FAILS when an expected gen_* prompt is missing", () => {
    const defs = EXPECTED_GEN_NAMES.filter((n: string) => n !== "gen_schema").map(baseGenDef);
    const { failures } = checkPromptMirror(defs);
    expect(failures.join("\n")).toMatch(/gen_schema" is missing/);
  });

  // ── MUTATION: an unexpected gen_* prompt appears ─────────────────────────

  it("FAILS when an unexpected gen_* prompt is added", () => {
    const defs = [...EXPECTED_GEN_NAMES.map(baseGenDef), baseGenDef("gen_business_case")];
    const { failures } = checkPromptMirror(defs);
    expect(failures.join("\n")).toMatch(/gen_business_case" is a gen_\* prompt not in EXPECTED_GEN_NAMES/);
  });

  // ── MUTATION: a gen_* prompt forgets the metered disclosure ──────────────

  it("FAILS when a gen_* description drops the METERED marker", () => {
    const defs = EXPECTED_GEN_NAMES.map((n: string) =>
      n === "gen_pages" ? { ...baseGenDef(n), description: "Generate pages." } : baseGenDef(n)
    );
    const { failures } = checkPromptMirror(defs);
    expect(failures.join("\n")).toMatch(/gen_pages"'s description does not carry the METERED_NOTE marker/);
  });

  // ── MUTATION: a gen_* prompt's arguments drift from [projectId] ─────────

  it("FAILS when a gen_* prompt gains an unexpected argument", () => {
    const defs = EXPECTED_GEN_NAMES.map((n: string) =>
      n === "gen_criteria"
        ? { ...baseGenDef(n), arguments: [PROJECT_ARG, { name: "localPath", required: false }] }
        : baseGenDef(n)
    );
    const { failures } = checkPromptMirror(defs);
    expect(failures.join("\n")).toMatch(/gen_criteria"'s arguments are/);
  });

  it("FAILS when a gen_* prompt's projectId argument is not required", () => {
    const defs = EXPECTED_GEN_NAMES.map((n: string) =>
      n === "gen_personas"
        ? { ...baseGenDef(n), arguments: [{ name: "projectId", required: false }] }
        : baseGenDef(n)
    );
    const { failures } = checkPromptMirror(defs);
    expect(failures.join("\n")).toMatch(/gen_personas"'s arguments are/);
  });
});
