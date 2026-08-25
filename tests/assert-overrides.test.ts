/**
 * D-296 — the guard that proves the security pins actually applied.
 *
 * The pins used to sit in package.json under `pnpm.overrides`. pnpm 11 stopped
 * reading that field, so they silently stopped applying on a published package
 * and nothing failed. These tests are the mutation proof for the replacement
 * guard: each one BREAKS the install in a way the old setup tolerated and
 * asserts `checkOverrides` refuses it. If any of them passes with an empty
 * `failures`, the guard is decorative.
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
// @ts-expect-error — dependency-free .mjs guard, deliberately not part of tsconfig's src build
import { checkOverrides, installedVersionsOf, satisfies } from "../scripts/assert-overrides.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

const WORKSPACE = `packages:
  - '.'

overrides:
  hono: ^4.12.25
  '@hono/node-server': ^1.19.13
  esbuild: ^0.28.1
`;

const LOCK = `lockfileVersion: '9.0'

overrides:
  hono: ^4.12.25
  '@hono/node-server': ^1.19.13
  esbuild: ^0.28.1

importers:
`;

const STORE = ["hono@4.12.25", "@hono+node-server@1.19.13_hono@4.12.25", "esbuild@0.28.4"];

const base = () => ({
  workspaceYaml: WORKSPACE,
  lockYaml: LOCK,
  packageJson: { name: "x" },
  storeEntries: [...STORE],
});

describe("assert-overrides guard", () => {
  it("passes on a tree where every pin resolved", () => {
    const { failures, checked } = checkOverrides(base());
    expect(failures).toEqual([]);
    expect(checked.sort()).toEqual(["@hono/node-server", "esbuild", "hono"]);
  });

  // ── MUTATION: a pin stops applying ─────────────────────────────────────────

  it("FAILS when an installed version is below its pin", () => {
    const input = base();
    input.storeEntries = ["hono@4.9.0", "@hono+node-server@1.19.13", "esbuild@0.28.4"];
    const { failures } = checkOverrides(input);
    expect(failures.join("\n")).toMatch(/hono@4\.9\.0 is installed but the pin requires \^4\.12\.25/);
  });

  it("FAILS when a scoped pin resolves below its range", () => {
    const input = base();
    input.storeEntries = ["hono@4.12.25", "@hono+node-server@1.19.0", "esbuild@0.28.4"];
    const { failures } = checkOverrides(input);
    expect(failures.join("\n")).toMatch(/@hono\/node-server@1\.19\.0/);
  });

  it("FAILS when a caret pin on a 0.x package crosses the minor boundary", () => {
    const input = base();
    input.storeEntries = ["hono@4.12.25", "@hono+node-server@1.19.13", "esbuild@0.27.9"];
    const { failures } = checkOverrides(input);
    expect(failures.join("\n")).toMatch(/esbuild@0\.27\.9/);
  });

  // ── MUTATION: the pins move back to the inert location ─────────────────────

  it("FAILS when the overrides block is missing from pnpm-workspace.yaml", () => {
    const input = base();
    input.workspaceYaml = "packages:\n  - '.'\n";
    const { failures } = checkOverrides(input);
    expect(failures.join("\n")).toMatch(/declares no `overrides` block/);
  });

  it("FAILS when package.json carries pnpm.overrides — the field pnpm 11 ignores", () => {
    const input = base();
    input.packageJson = { name: "x", pnpm: { overrides: { hono: "^4.12.25" } } } as never;
    const { failures } = checkOverrides(input);
    expect(failures.join("\n")).toMatch(/pnpm 11 IGNORES that field/);
  });

  // ── MUTATION: the lockfile was regenerated without the settings ────────────

  it("FAILS when the lockfile records no overrides at all", () => {
    const input = base();
    input.lockYaml = "lockfileVersion: '9.0'\n\nimporters:\n";
    const { failures } = checkOverrides(input);
    expect(failures.join("\n")).toMatch(/records no `overrides` block/);
  });

  it("FAILS when the lockfile's recorded range drifts from the intended one", () => {
    const input = base();
    input.lockYaml = LOCK.replace("hono: ^4.12.25", "hono: ^4.9.0");
    const { failures } = checkOverrides(input);
    expect(failures.join("\n")).toMatch(/but pnpm-workspace\.yaml intends/);
  });

  // ── MUTATION: the guard is asked to pass vacuously ─────────────────────────

  it("FAILS on an empty install rather than passing vacuously", () => {
    const input = base();
    input.storeEntries = [];
    const { failures } = checkOverrides(input);
    expect(failures.join("\n")).toMatch(/node_modules\/\.pnpm is missing or empty/);
  });

  it("FAILS when no pinned package is present in the tree at all", () => {
    const input = base();
    input.storeEntries = ["typescript@7.0.2", "vitest@4.1.11"];
    const { failures } = checkOverrides(input);
    expect(failures.join("\n")).toMatch(/nothing was actually verified/);
  });

  // ── The primitives ─────────────────────────────────────────────────────────

  it("refuses a range syntax it does not fully understand", () => {
    expect(() => satisfies("1.2.3", ">=1.0.0 <2")).toThrow(/unsupported range/);
  });

  it("reads scoped and peer-suffixed store directory names", () => {
    expect(
      installedVersionsOf(
        ["@hono+node-server@1.19.13_hono@4.12.25", "@hono+node-server@1.20.0", "hono@4.12.25"],
        "@hono/node-server"
      )
    ).toEqual(["1.19.13", "1.20.0"]);
    // `ajv@` must not swallow `ajv-formats@`.
    expect(installedVersionsOf(["ajv-formats@3.0.1_ajv@8.20.0", "ajv@8.20.0"], "ajv")).toEqual([
      "8.20.0",
    ]);
  });

  // ── And the real repository, as installed right now ────────────────────────

  it("passes against this repository's actual installed tree", () => {
    let storeEntries: string[] = [];
    try {
      storeEntries = readdirSync(join(ROOT, "node_modules", ".pnpm"));
    } catch {
      /* leave empty — the assertion below reports it */
    }
    const { failures, checked } = checkOverrides({
      workspaceYaml: read("pnpm-workspace.yaml"),
      lockYaml: read("pnpm-lock.yaml"),
      packageJson: JSON.parse(read("package.json")),
      storeEntries,
    });
    expect(failures).toEqual([]);
    expect(checked.length).toBeGreaterThan(0);
  });
});
