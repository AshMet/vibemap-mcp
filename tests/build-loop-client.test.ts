import { HttpResponse, http } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { VibeMapClient } from "../src/vibe-client";

const baseUrl = "http://test-api.vibemap.com";
const client = new VibeMapClient({ baseUrl, apiKey: "test-api-key" });

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

/** Records the last request to a route and answers with `{ ok: true }`. */
function capture(method: "get" | "post", path: string) {
  const seen: { url: string; body: unknown; method: string } = { url: "", body: null, method: "" };
  server.use(
    http[method](`${baseUrl}${path}`, async ({ request }) => {
      seen.url = request.url;
      seen.method = request.method;
      seen.body = request.method === "POST" ? await request.json() : null;
      return HttpResponse.json({ ok: true });
    })
  );
  return seen;
}

describe("submitForReview sends the evidence the backend requires", () => {
  it("posts snake_case changed_files and tests with ac_codes", async () => {
    const seen = capture("post", "/api/mcp/kanban/criterion/c1/submit-for-review");
    await client.submitForReview("c1", {
      gitSha: "abc1234",
      baseSha: "def5678",
      specSeq: 7,
      changedFiles: [
        { path: "src/a.ts", status: "added", additions: 10, deletions: 0 },
        { path: "src/b.ts", status: "deleted" },
      ],
      tests: [{ file: "tests/a.test.ts", name: "[AC-042] rejects empty", acCodes: ["AC-042"] }],
      notes: "n",
    });
    expect(seen.body).toEqual({
      git_sha: "abc1234",
      base_sha: "def5678",
      spec_seq: 7,
      changed_files: [
        { path: "src/a.ts", status: "added", additions: 10, deletions: 0 },
        { path: "src/b.ts", status: "deleted" },
      ],
      tests: [{ file: "tests/a.test.ts", name: "[AC-042] rejects empty", ac_codes: ["AC-042"] }],
      notes: "n",
    });
  });

  it("does not send the old camelCase or diff-only shape", async () => {
    const seen = capture("post", "/api/mcp/kanban/criterion/c1/submit-for-review");
    await client.submitForReview("c1", {
      gitSha: "abc1234",
      changedFiles: [{ path: "x", status: "modified" }],
      tests: [{ file: "t", name: "[AC-001] x", acCodes: ["AC-001"] }],
    });
    const body = seen.body as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(["changed_files", "git_sha", "tests"]);
  });
});

describe("reportProgress", () => {
  it("sends the phase and the optional detail", async () => {
    const seen = capture("post", "/api/mcp/kanban/criterion/c1/progress");
    await client.reportProgress("c1", {
      phase: "running_tests",
      summary: "s",
      plan: [{ step: "a", done: true }],
      files: ["x.ts"],
      tests: { passed: 1, failed: 0, total: 2 },
    });
    expect(seen.body).toEqual({
      phase: "running_tests",
      summary: "s",
      plan: [{ step: "a", done: true }],
      files: ["x.ts"],
      tests: { passed: 1, failed: 0, total: 2 },
    });
  });

  it("omits what was not given", async () => {
    const seen = capture("post", "/api/mcp/kanban/criterion/c1/progress");
    await client.reportProgress("c1", { phase: "planning" });
    expect(seen.body).toEqual({ phase: "planning" });
  });
});

describe("routes", () => {
  it("getCriterionContext, with and without source", async () => {
    const a = capture("get", "/api/mcp/kanban/criterion/c1/context");
    await client.getCriterionContext("c1");
    expect(new URL(a.url).search).toBe("");
    await client.getCriterionContext("c1", true);
    expect(new URL(a.url).searchParams.get("include")).toBe("source");
  });

  it("claimStory posts to the story claim route", async () => {
    const seen = capture("post", "/api/mcp/kanban/story/s1/claim");
    await client.claimStory("s1");
    expect(seen.method).toBe("POST");
    expect(new URL(seen.url).search).toBe("");
  });

  it("getExecutionPlan passes the release scope", async () => {
    const seen = capture("get", "/api/mcp/kanban/projects/p1/execution-plan");
    await client.getExecutionPlan("p1", "r1");
    expect(new URL(seen.url).searchParams.get("release_id")).toBe("r1");
    await client.getExecutionPlan("p1");
    expect(new URL(seen.url).search).toBe("");
  });

  it("getNextReadyCriterion passes the release scope", async () => {
    const seen = capture("get", "/api/mcp/kanban/projects/p1/next-ready");
    await client.getNextReadyCriterion("p1", "r1");
    expect(new URL(seen.url).searchParams.get("release_id")).toBe("r1");
  });

  it("reworkCriterion posts an empty body or the plan", async () => {
    const seen = capture("post", "/api/mcp/kanban/criterion/c1/rework");
    await client.reworkCriterion("c1");
    expect(seen.body).toEqual({});
    await client.reworkCriterion("c1", "fix the null case");
    expect(seen.body).toEqual({ plan: "fix the null case" });
  });

  it("getCriterionEvidence passes the limit", async () => {
    const seen = capture("get", "/api/mcp/kanban/criterion/c1/evidence");
    await client.getCriterionEvidence("c1", 5);
    expect(new URL(seen.url).searchParams.get("limit")).toBe("5");
  });

  it("getSpecDelta sends since_seq (including 0)", async () => {
    const seen = capture("get", "/api/mcp/spec-delta");
    await client.getSpecDelta("p1", 0, 10);
    const q = new URL(seen.url).searchParams;
    expect(q.get("projectId")).toBe("p1");
    expect(q.get("since_seq")).toBe("0");
    expect(q.get("limit")).toBe("10");
  });

  it("release work list and diff routes", async () => {
    const a = capture("get", "/api/mcp/releases/r1/work-list");
    const b = capture("get", "/api/mcp/releases/r1/diff");
    await client.getReleaseWorkList("r1");
    await client.getReleaseDiff("r1");
    expect(a.url).toContain("/releases/r1/work-list");
    expect(b.url).toContain("/releases/r1/diff");
  });

  it("listChangesets passes the cursor", async () => {
    const seen = capture("get", "/api/mcp/changesets");
    await client.listChangesets("p1", { sinceSeq: 0 });
    expect(new URL(seen.url).searchParams.get("since_seq")).toBe("0");
  });
});

describe("questions", () => {
  it("blockCriterion carries the question and options", async () => {
    const seen = capture("post", "/api/mcp/kanban/criterion/c1/block");
    await client.blockCriterion("c1", "spec_unclear", "why", {
      question: "Which currency?",
      options: ["USD", "EUR"],
    });
    expect(seen.body).toEqual({
      category: "spec_unclear",
      reason: "why",
      question: "Which currency?",
      options: ["USD", "EUR"],
    });
  });

  it("blockCriterion without a question sends no question keys", async () => {
    const seen = capture("post", "/api/mcp/kanban/criterion/c1/block");
    await client.blockCriterion("c1", "other", "why");
    expect(seen.body).toEqual({ category: "other", reason: "why" });
  });

  it("getAnswers keeps only this criterion's answered events and reports waiting", async () => {
    server.use(
      http.get(`${baseUrl}/api/mcp/kanban/projects/p1/events`, ({ request }) => {
        expect(new URL(request.url).searchParams.get("limit")).toBe("1000");
        return HttpResponse.json({
          events: [
            // newest first
            {
              entity_type: "criterion",
              entity_id: "c1",
              to_status: "ready",
              created_at: "2026-10-12T10:05:00Z",
              payload: {
                resolution: "Answered: EUR",
                question_id: "q1",
                question: "Which currency?",
                answer: "EUR",
                decision_id: "d1",
              },
            },
            {
              entity_type: "criterion",
              entity_id: "other",
              to_status: "ready",
              created_at: "2026-10-12T10:04:00Z",
              payload: { question_id: "q9", question: "x", answer: "not mine" },
            },
            {
              entity_type: "criterion",
              entity_id: "c1",
              to_status: "blocked",
              created_at: "2026-10-12T10:00:00Z",
              payload: { question: "Which currency?" },
            },
          ],
        });
      })
    );
    const r = await client.getAnswers("p1", "c1");
    expect(r.answers).toEqual([
      {
        question_id: "q1",
        question: "Which currency?",
        answer: "EUR",
        decision_id: "d1",
        answered_at: "2026-10-12T10:05:00Z",
      },
    ]);
    expect(r.latestStatus).toBe("ready");
    expect(r.waiting).toBe(false);
  });

  it("getAnswers reports waiting while the newest event is the block", async () => {
    server.use(
      http.get(`${baseUrl}/api/mcp/kanban/projects/p1/events`, () =>
        HttpResponse.json({
          events: [
            {
              entity_type: "criterion",
              entity_id: "c1",
              to_status: "blocked",
              created_at: "2026-10-12T10:00:00Z",
              payload: { question: "Which currency?" },
            },
          ],
        })
      )
    );
    const r = await client.getAnswers("p1", "c1");
    expect(r.answers).toEqual([]);
    expect(r.waiting).toBe(true);
  });

  it("getAnswers handles an empty feed", async () => {
    server.use(
      http.get(`${baseUrl}/api/mcp/kanban/projects/p1/events`, () =>
        HttpResponse.json({ events: [] })
      )
    );
    expect(await client.getAnswers("p1", "c1")).toEqual({
      answers: [],
      latestStatus: null,
      waiting: false,
    });
  });
});

describe("proposeSpecChange", () => {
  it("posts to the staging route and never to the crud routes", async () => {
    const seen = capture("post", "/api/mcp/spec-proposals");
    await client.proposeSpecChange({
      projectId: "p1",
      entity: "acceptance_criterion",
      entityId: "e1",
      fields: { then_outcome: "x" },
      rationale: "why",
    });
    expect(seen.method).toBe("POST");
    expect(seen.body).toEqual({
      projectId: "p1",
      entity: "acceptance_criterion",
      entityId: "e1",
      fields: { then_outcome: "x" },
      rationale: "why",
    });
  });
});
