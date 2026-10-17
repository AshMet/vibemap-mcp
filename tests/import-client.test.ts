import { HttpResponse, http } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { VibeMapClient } from "../src/vibe-client";

const baseUrl = "http://test-api.vibemap.com";
const client = new VibeMapClient({ baseUrl, apiKey: "test-api-key" });
const PROJECT = "11111111-1111-1111-1111-111111111111";

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function capture(method: "post" | "patch", path: string) {
  const seen: { body: unknown; auth: string | null } = { body: null, auth: null };
  server.use(
    http[method](`${baseUrl}${path}`, async ({ request }) => {
      seen.body = await request.json();
      seen.auth = request.headers.get("authorization");
      return HttpResponse.json({ ok: true });
    })
  );
  return seen;
}

const facts = { version: 1, commit_sha: null, tables: [], policies: [], routes: [], clusters: [] };

describe("import endpoints", () => {
  it.each([
    ["importFacts", "/api/import/facts", () => client.importFacts(PROJECT, facts), { projectId: PROJECT, facts }],
    ["resyncImport", "/api/import/resync", () => client.resyncImport(PROJECT, facts), { projectId: PROJECT, facts }],
    [
      "importSemantic",
      "/api/import/semantic",
      () => client.importSemantic(PROJECT, [{ clusterId: "posts" }]),
      { projectId: PROJECT, features: [{ clusterId: "posts" }] },
    ],
    ["finalizeImport", "/api/import/finalize", () => client.finalizeImport(PROJECT), { projectId: PROJECT }],
  ])("%s posts exactly the body the route's strict schema accepts", async (_n, path, send, body) => {
    const seen = capture("post", path);
    await send();
    expect(seen.body).toEqual(body);
    expect(seen.auth).toBe("Bearer test-api-key");
  });
});

describe("drift actions on the code map", () => {
  it("report_drift carries the diff excerpt", async () => {
    const seen = capture("patch", "/api/mcp/code-map");
    await client.reportDriftChanges(PROJECT, ["a.ts"], "abc", "+ line");
    expect(seen.body).toEqual({
      projectId: PROJECT,
      action: "report_drift",
      changedFiles: ["a.ts"],
      headSha: "abc",
      diffExcerpt: "+ line",
    });
  });

  it("resolve_drift sends all three lists, empty when not given", async () => {
    const seen = capture("patch", "/api/mcp/code-map");
    await client.resolveDrift(PROJECT, { files: ["a.ts"] });
    expect(seen.body).toEqual({
      projectId: PROJECT,
      action: "resolve_drift",
      files: ["a.ts"],
      nodeIds: [],
      criterionIds: [],
    });
  });

  it("resolve_code_drift_proposal sends the id and decision", async () => {
    const seen = capture("patch", "/api/mcp/code-map");
    await client.resolveCodeDriftProposal(PROJECT, "p", "apply");
    expect(seen.body).toEqual({
      projectId: PROJECT,
      action: "resolve_code_drift_proposal",
      proposalId: "p",
      decision: "apply",
    });
  });
});
