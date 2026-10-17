import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { McpError } from "@modelcontextprotocol/sdk/types.js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { extractRepoFacts } from "../src/extract/index.js";
import type { RepoFacts } from "../src/extract/types.js";
import { factsFiles, factsToCodeMap, MAX_MAP_NODES } from "../src/import/code-map.js";
import { ensureCodeMap, handleImportTool, IMPORT_TOOL_NAMES } from "../src/import/tools.js";
import { TOOL_DEFINITIONS } from "../src/tools/definitions.js";

const REPO = path.join(__dirname, "fixtures/repos/next-supabase");
const PROJECT = "11111111-1111-1111-1111-111111111111";
const PROPOSAL = "22222222-2222-2222-2222-222222222222";

const client = {
  importFacts: vi.fn(),
  importSemantic: vi.fn(),
  finalizeImport: vi.fn(),
  resyncImport: vi.fn(),
  getCodeMap: vi.fn(),
  submitCodeMap: vi.fn(),
  reportDriftChanges: vi.fn(),
  resolveDrift: vi.fn(),
  resolveCodeDriftProposal: vi.fn(),
};

const call = (name: string, args: Record<string, unknown> = {}) =>
  handleImportTool(name, args, () => client as never);
const json = (r: Awaited<ReturnType<typeof call>>) => JSON.parse(r?.content[0].text ?? "null");

beforeEach(() => {
  for (const fn of Object.values(client)) {
    fn.mockReset();
    fn.mockResolvedValue({ ok: true });
  }
  client.getCodeMap.mockResolvedValue({ codeMap: null, links: [] });
});

describe("tool definitions", () => {
  it("registers every import tool exactly once", () => {
    const names = TOOL_DEFINITIONS.map((t) => t.name);
    for (const n of IMPORT_TOOL_NAMES) expect(names.filter((x) => x === n)).toHaveLength(1);
  });

  it("says what leaves the machine for every tool that reads the repository", () => {
    for (const n of ["vibemap_extract_repo_facts", "vibemap_import_facts", "vibemap_resync"]) {
      const d = TOOL_DEFINITIONS.find((t) => t.name === n)?.description ?? "";
      expect(d, n).toMatch(/sends nothing|sends only the facts/i);
    }
    const importFacts = TOOL_DEFINITIONS.find((t) => t.name === "vibemap_import_facts");
    expect(importFacts?.description).toMatch(/File contents never leave your machine/);
  });

  it("marks the local extractor read-only and closed-world", () => {
    const d = TOOL_DEFINITIONS.find((t) => t.name === "vibemap_extract_repo_facts");
    expect(d?.annotations).toMatchObject({ readOnlyHint: true, openWorldHint: false });
  });
});

describe("unknown names", () => {
  it("returns null so the main switch can 404 them", async () => {
    expect(await call("vibemap_list_projects")).toBeNull();
  });
});

describe("vibemap_extract_repo_facts", () => {
  it("summarises the fixture's facts and calls nothing", async () => {
    const out = json(await call("vibemap_extract_repo_facts", { localPath: REPO }));
    expect(out.counts).toEqual({ tables: 3, policies: 4, routes: 6, clusters: 3, warnings: 0 });
    expect(out.clusters.map((c: { id: string }) => c.id)).toEqual(["about", "home", "posts"]);
    expect(out.clusters.find((c: { id: string }) => c.id === "posts").files).toHaveLength(8);
    for (const fn of Object.values(client)) expect(fn).not.toHaveBeenCalled();
  });

  it("rejects a path that is not a directory", async () => {
    await expect(
      call("vibemap_extract_repo_facts", { localPath: path.join(REPO, "package.json") })
    ).rejects.toThrow(McpError);
    await expect(
      call("vibemap_extract_repo_facts", { localPath: "/definitely/not/here" })
    ).rejects.toThrow(/does not exist/);
  });
});

describe("vibemap_import_facts", () => {
  it("sends exactly the extracted facts, never file contents", async () => {
    await call("vibemap_import_facts", { projectId: PROJECT, localPath: REPO });
    const [projectId, facts] = client.importFacts.mock.calls[0];
    expect(projectId).toBe(PROJECT);
    expect(facts).toEqual(extractRepoFacts(REPO));
    // A route file's source text is nowhere in the payload.
    const source = fs.readFileSync(path.join(REPO, "app/api/posts/route.ts"), "utf8");
    expect(JSON.stringify(facts)).not.toContain(source.trim().slice(0, 60));
  });

  it("records a facts-derived map when the project has none", async () => {
    const out = json(await call("vibemap_import_facts", { projectId: PROJECT, localPath: REPO }));
    expect(out.codeMap).toEqual({ status: "created" });
    const [, map, anchor] = client.submitCodeMap.mock.calls[0];
    expect(map).toEqual(factsToCodeMap(extractRepoFacts(REPO)));
    expect(anchor.scannedAt).toEqual(expect.any(String));
  });

  it("keeps an existing map untouched", async () => {
    client.getCodeMap.mockResolvedValue({ codeMap: { id: "m" } });
    const out = json(await call("vibemap_import_facts", { projectId: PROJECT, localPath: REPO }));
    expect(out.codeMap).toEqual({ status: "exists" });
    expect(client.submitCodeMap).not.toHaveBeenCalled();
  });

  it("does not fail the import when the map cannot be recorded", async () => {
    client.submitCodeMap.mockRejectedValue(new Error("boom"));
    const out = json(await call("vibemap_import_facts", { projectId: PROJECT, localPath: REPO }));
    expect(out.ok).toBe(true);
    expect(out.codeMap).toEqual({ status: "failed", error: "boom" });
  });

  it("surfaces a failed import as an error and records no map", async () => {
    client.importFacts.mockRejectedValue(new Error("Pro plan required"));
    await expect(
      call("vibemap_import_facts", { projectId: PROJECT, localPath: REPO })
    ).rejects.toThrow("Pro plan required");
    expect(client.submitCodeMap).not.toHaveBeenCalled();
  });
});

describe("vibemap_import_semantic and vibemap_finalize_import", () => {
  it("passes the features through unchanged", async () => {
    const features = [{ clusterId: "posts", name: "Posts", sourceFiles: ["app/posts/page.tsx"] }];
    await call("vibemap_import_semantic", { projectId: PROJECT, features });
    expect(client.importSemantic).toHaveBeenCalledWith(PROJECT, features);
  });

  it("refuses an empty feature list before any request", async () => {
    await expect(call("vibemap_import_semantic", { projectId: PROJECT, features: [] })).rejects.toThrow();
    expect(client.importSemantic).not.toHaveBeenCalled();
  });

  it("finalizes by project id", async () => {
    await call("vibemap_finalize_import", { projectId: PROJECT });
    expect(client.finalizeImport).toHaveBeenCalledWith(PROJECT);
  });
});

describe("vibemap_resync", () => {
  it("reports the delta's files plus the agent's extra files as drift, at the facts' commit", async () => {
    client.getCodeMap.mockResolvedValue({ codeMap: { id: "m" } });
    client.resyncImport.mockResolvedValue({ changed_files: ["app/api/posts/route.ts"] });
    client.reportDriftChanges.mockResolvedValue({ proposals: { staged: 1, skipped: 0 } });
    const out = json(
      await call("vibemap_resync", {
        projectId: PROJECT,
        localPath: REPO,
        changedFiles: ["components/post-card.tsx", "app/api/posts/route.ts"],
        diffExcerpt: "+ x",
      })
    );
    expect(client.resyncImport.mock.calls[0][1]).toEqual(extractRepoFacts(REPO));
    expect(client.reportDriftChanges).toHaveBeenCalledWith(
      PROJECT,
      ["app/api/posts/route.ts", "components/post-card.tsx"],
      undefined,
      "+ x"
    );
    expect(out.reportedFiles).toBe(2);
    expect(out.drift).toEqual({ proposals: { staged: 1, skipped: 0 } });
  });

  it("records a map before reporting drift when the project has none", async () => {
    client.resyncImport.mockResolvedValue({ changed_files: ["app/api/posts/route.ts"] });
    const order: string[] = [];
    client.submitCodeMap.mockImplementation(async () => order.push("map"));
    client.reportDriftChanges.mockImplementation(async () => order.push("drift"));
    await call("vibemap_resync", { projectId: PROJECT, localPath: REPO });
    expect(order).toEqual(["map", "drift"]);
  });

  it("reports nothing when nothing changed", async () => {
    client.resyncImport.mockResolvedValue({ changed_files: [] });
    const out = json(await call("vibemap_resync", { projectId: PROJECT, localPath: REPO }));
    expect(client.reportDriftChanges).not.toHaveBeenCalled();
    expect(out.drift).toBeNull();
  });
});

describe("drift resolution", () => {
  it("passes files, nodes and criteria through", async () => {
    await call("vibemap_resolve_drift", { projectId: PROJECT, files: ["a.ts"], criterionIds: ["c"] });
    expect(client.resolveDrift).toHaveBeenCalledWith(PROJECT, {
      files: ["a.ts"],
      nodeIds: undefined,
      criterionIds: ["c"],
    });
  });

  it("refuses a resolve that names nothing", async () => {
    await expect(call("vibemap_resolve_drift", { projectId: PROJECT })).rejects.toThrow(
      /at least one/
    );
    expect(client.resolveDrift).not.toHaveBeenCalled();
  });

  it("applies or dismisses one proposal", async () => {
    await call("vibemap_resolve_code_drift_proposal", {
      projectId: PROJECT,
      proposalId: PROPOSAL,
      decision: "dismiss",
    });
    expect(client.resolveCodeDriftProposal).toHaveBeenCalledWith(PROJECT, PROPOSAL, "dismiss");
  });

  it.each([
    ["a non-uuid id", { proposalId: "p1", decision: "apply" }],
    ["an unknown decision", { proposalId: PROPOSAL, decision: "accept" }],
  ])("refuses %s", async (_l, patch) => {
    await expect(
      call("vibemap_resolve_code_drift_proposal", { projectId: PROJECT, ...patch })
    ).rejects.toThrow();
    expect(client.resolveCodeDriftProposal).not.toHaveBeenCalled();
  });
});

describe("factsToCodeMap", () => {
  const facts = extractRepoFacts(REPO);
  const map = factsToCodeMap(facts);

  it("has one node per route file and per table, with unique ids", () => {
    expect(map?.nodes).toHaveLength(facts.routes.length + facts.tables.length);
    expect(new Set(map?.nodes.map((n) => n.id)).size).toBe(map?.nodes.length);
    for (const r of facts.routes) {
      expect(map?.nodes.find((n) => n.id === r.file)?.kind).toBe(r.kind === "api" ? "api" : "page");
    }
  });

  it("links each route to the tables in its cluster, and only those", () => {
    const posts = facts.clusters.find((c) => c.id === "posts");
    const api = facts.routes.find((r) => r.path === "/api/posts");
    const targets = map?.edges.filter((e) => e.source === api?.file).map((e) => e.target) ?? [];
    expect(targets.length).toBe(posts?.tables.length);
    for (const e of map?.edges ?? []) {
      expect(map?.nodes.some((n) => n.id === e.source)).toBe(true);
      expect(map?.nodes.some((n) => n.id === e.target)).toBe(true);
    }
  });

  it("is deterministic and paths only", () => {
    expect(factsToCodeMap(extractRepoFacts(REPO))).toEqual(map);
    for (const n of map?.nodes ?? []) expect(factsFiles(facts).has(n.path)).toBe(true);
  });

  it("caps at the server's node limit", () => {
    const routes = Array.from({ length: MAX_MAP_NODES + 50 }, (_, i) => ({
      path: `/r${i}`,
      kind: "page" as const,
      file: `app/r${i}/page.tsx`,
      dynamic_segments: [],
    }));
    const big = factsToCodeMap({ ...facts, routes, clusters: [] } as RepoFacts);
    expect(big?.nodes).toHaveLength(MAX_MAP_NODES);
  });

  it("is null for a repository with no routes and no tables", () => {
    expect(factsToCodeMap({ ...facts, routes: [], tables: [] })).toBeNull();
  });
});

describe("ensureCodeMap", () => {
  it("skips a repository with nothing to map", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vm-empty-"));
    const res = await ensureCodeMap(client as never, PROJECT, extractRepoFacts(dir));
    expect(res).toEqual({ status: "skipped" });
    expect(client.submitCodeMap).not.toHaveBeenCalled();
  });
});
