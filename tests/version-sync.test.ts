/**
 * The version is declared in THREE places and they must agree:
 *   - package.json          — what npm publishes
 *   - src/index.ts          — what the server advertises in the MCP handshake
 *   - server.json           — what the MCP Registry lists (twice)
 *
 * A "keep in sync with package.json" comment guarded this before, and it did
 * not work: server.json sat two releases behind at 2.8.1 while package.json
 * was on 2.9.0, so the registry advertised a version that was never published
 * with those contents. This test is that comment, enforced.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

describe("version sync", () => {
  const pkgVersion = JSON.parse(read("package.json")).version as string;

  it("package.json carries a plain semver version", () => {
    expect(pkgVersion).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("the version advertised in the MCP handshake matches package.json", () => {
    // Matches the `version: "x.y.z"` inside the `new Server({...})` literal.
    const found = read("src/index.ts").match(/^\s*version:\s*"(\d+\.\d+\.\d+)",/m);
    expect(found?.[1], "src/index.ts must declare a version").toBeDefined();
    expect(found?.[1]).toBe(pkgVersion);
  });

  it("every version in the registry manifest matches package.json", () => {
    const serverJson = JSON.parse(read("server.json"));
    const versions = [serverJson.version, ...serverJson.packages.map((p: any) => p.version)];
    expect(versions.length).toBeGreaterThanOrEqual(2);
    for (const v of versions) expect(v).toBe(pkgVersion);
  });
});
