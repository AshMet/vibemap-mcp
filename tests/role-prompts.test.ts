/**
 * Crew role prompts: vibemap-architect, vibemap-backend, vibemap-frontend, vibemap-qa.
 *
 * Their bodies ship in this package (LOCAL_PROMPT_BODIES), so these tests pin
 * the contract each one must state, and that this PUBLIC package's copy of
 * them discloses nothing about how the hosted crew is built.
 */
import { describe, expect, it } from "vitest";
import { TOOL_DEFINITIONS } from "../src/tools/definitions";
import {
  LOCAL_PROMPT_BODIES,
  PROMPT_DEFINITIONS,
  PROMPT_NAMES,
  PROJECTLESS_PROMPTS,
  ROLE_PROMPT_NAMES,
  renderLocalPrompt,
} from "../src/prompts/definitions";

const ROLES = ["vibemap-architect", "vibemap-backend", "vibemap-frontend", "vibemap-qa"];
const body = (name: string) => LOCAL_PROMPT_BODIES[name] as string;
const TOOL_NAMES = new Set(TOOL_DEFINITIONS.map((t) => t.name));

describe("crew role prompt registry", () => {
  it("registers exactly the four role prompts, each with a local body", () => {
    expect(ROLE_PROMPT_NAMES).toEqual(ROLES);
    for (const name of ROLES) {
      expect(PROMPT_NAMES.has(name)).toBe(true);
      expect(body(name).length).toBeGreaterThan(500);
    }
  });

  it("every role takes exactly a required projectId", () => {
    for (const name of ROLES) {
      const def = PROMPT_DEFINITIONS.find((p) => p.name === name);
      expect(def?.arguments).toEqual([expect.objectContaining({ name: "projectId", required: true })]);
      expect(def?.arguments).toHaveLength(1);
      expect(PROJECTLESS_PROMPTS.has(name)).toBe(false);
      expect(def?.description).toMatch(/your own model/);
    }
  });

  it("only role prompts are served locally (server-served prompts are untouched)", () => {
    expect(renderLocalPrompt("build_sprint", "p1")).toBeUndefined();
    expect(renderLocalPrompt("gen_features", "p1")).toBeUndefined();
    expect(renderLocalPrompt("vibemap-qa", "proj-123")).toMatch(/^Project: proj-123 /);
  });

  it("every vibemap_* tool a role prompt names exists in this server", () => {
    for (const name of ROLES) {
      const named = body(name).match(/vibemap_[a-z_]+/g) ?? [];
      expect(named.length).toBeGreaterThan(0);
      for (const tool of named) expect(TOOL_NAMES.has(tool), `${name} names ${tool}`).toBe(true);
    }
  });
});

describe("what each role states", () => {
  it("every role states the docs files and the reference-by-ID rule", () => {
    for (const name of ROLES) {
      const b = body(name);
      for (const doc of ["AGENTS.md", "docs/architecture.md", "docs/decisions/", "docs/sprints/sprint-N.md"]) {
        expect(b, `${name} → ${doc}`).toContain(doc);
      }
      expect(b).toMatch(/Reference spec data by ID/);
      expect(b).toContain("`AC-012`");
    }
  });

  it("every role says an agent never passes a criterion, and CI posts ci-result", () => {
    for (const name of ROLES) {
      const b = body(name);
      expect(b).toMatch(/No agent ever passes a criterion/);
      expect(b).toContain("ci-result");
      expect(b).toMatch(/Never call `vibemap_resolve_review`/);
    }
  });

  it("every role carries the crew payload shapes", () => {
    for (const name of ROLES) {
      const b = body(name);
      expect(b).toContain("`architect_plan`");
      expect(b).toContain("`qa_hardened`");
      expect(b).toContain("`red_on_scaffold`");
      expect(b).toContain("`qa_verdict`");
      for (const f of ["mutation_proofs_reproduced", "green_before", "red_after", "restored_green", "structural_violations"]) {
        expect(b).toContain(f);
      }
    }
  });

  it("the developers state claim / progress / submit / questions / block", () => {
    for (const name of ["vibemap-backend", "vibemap-frontend"]) {
      const b = body(name);
      for (const tool of [
        "vibemap_claim_story",
        "vibemap_claim_criterion",
        "vibemap_report_progress",
        "vibemap_submit_for_review",
        "vibemap_ask_user",
        "vibemap_block_criterion",
      ]) {
        expect(b, `${name} → ${tool}`).toContain(tool);
      }
      expect(b).toMatch(/Submit only after an accept/);
    }
  });

  it("the architect claims nothing and plans owner + order per criterion", () => {
    const b = body("vibemap-architect");
    expect(b).toMatch(/claim no criteria/);
    expect(b).toContain("vibemap_get_execution_plan");
    expect(b).toMatch(/`owner` \(`be`, `fe` or `both`\)/);
  });

  it("QA states the four mutation-proof steps, in order, and accepts only on reproduced proofs", () => {
    const b = body("vibemap-qa");
    const steps = [
      /1\. Run the criterion's test and confirm it passes\./,
      /2\. Break the thing it protects/,
      /3\. Run it again and confirm it fails\./,
      /4\. Restore the code and confirm the test is green again\./,
    ];
    let at = 0;
    for (const step of steps) {
      const m = b.slice(at).search(step);
      expect(m, String(step)).toBeGreaterThanOrEqual(0);
      at += m;
    }
    expect(b).toMatch(/Accept only when every proof was reproduced/);
    expect(b).toMatch(/fails on the scaffold/);
    expect(b).toMatch(/\*\*Submit:\*\* never/);
  });

  it("the frontend adds behaviour only to design-locked files", () => {
    const b = body("vibemap-frontend");
    expect(b).toMatch(/## Design-locked files/);
    expect(b).toMatch(/You may add behaviour only/);
    expect(b).toMatch(/never change layout, markup structure, classes or design tokens/);
  });
});
