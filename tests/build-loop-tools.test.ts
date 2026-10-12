import { McpError } from "@modelcontextprotocol/sdk/types.js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { handleCallTool, handleListTools, resetVibeClient } from "../src/index";
import { VibeMapClient } from "../src/vibe-client";

process.env.VIBEMAP_API_KEY = "test-key";

vi.mock("../src/vibe-client", () => ({ VibeMapClient: vi.fn() }));

const client = {
  submitForReview: vi.fn(),
  reportProgress: vi.fn(),
  claimStory: vi.fn(),
  getCriterionContext: vi.fn(),
  getExecutionPlan: vi.fn(),
  getNextReadyCriterion: vi.fn(),
  reworkCriterion: vi.fn(),
  getCriterionEvidence: vi.fn(),
  blockCriterion: vi.fn(),
  getAnswers: vi.fn(),
  getSpecDelta: vi.fn(),
  getReleaseWorkList: vi.fn(),
  getReleaseDiff: vi.fn(),
  proposeSpecChange: vi.fn(),
  listChangesets: vi.fn(),
  updateFeature: vi.fn(),
};

vi.mocked(VibeMapClient).mockImplementation(function () {
  return client as never;
});

const call = (name: string, args: Record<string, unknown> = {}) =>
  handleCallTool({ params: { name, arguments: args } } as never);

beforeEach(() => {
  resetVibeClient();
  for (const fn of Object.values(client)) fn.mockReset();
  for (const fn of Object.values(client)) fn.mockResolvedValue({ ok: true });
});

const validSubmit = {
  criterionId: "c1",
  gitSha: "abc1234",
  changedFiles: [{ path: "src/a.ts", status: "modified" }],
  tests: [{ file: "tests/a.test.ts", name: "[AC-042] x", acCodes: ["AC-042"] }],
};

describe("vibemap_submit_for_review", () => {
  it("passes the evidence through to the client", async () => {
    await call("vibemap_submit_for_review", { ...validSubmit, baseSha: "def5678", specSeq: 3 });
    expect(client.submitForReview).toHaveBeenCalledWith("c1", {
      gitSha: "abc1234",
      baseSha: "def5678",
      specSeq: 3,
      changedFiles: validSubmit.changedFiles,
      tests: validSubmit.tests,
    });
  });

  it.each([
    ["no changed files", { changedFiles: [] }],
    ["changedFiles missing", { changedFiles: undefined }],
    ["no tests", { tests: [] }],
    ["tests missing", { tests: undefined }],
    ["a test with no codes", { tests: [{ file: "f", name: "n", acCodes: [] }] }],
    ["a malformed code", { tests: [{ file: "f", name: "n", acCodes: ["ac-42"] }] }],
    ["an unknown file status", { changedFiles: [{ path: "x", status: "touched" }] }],
    ["a short sha", { gitSha: "abc" }],
    ["a bad diff url", { diffUrl: "nope" }],
  ])("rejects %s before any request", async (_label, patch) => {
    await expect(call("vibemap_submit_for_review", { ...validSubmit, ...patch })).rejects.toThrow(
      McpError
    );
    expect(client.submitForReview).not.toHaveBeenCalled();
  });

  it("does not require a diff url", async () => {
    await expect(call("vibemap_submit_for_review", validSubmit)).resolves.toBeDefined();
  });
});

describe("vibemap_report_progress", () => {
  it("requires a phase", async () => {
    await expect(call("vibemap_report_progress", { criterionId: "c1", summary: "x" })).rejects.toThrow(
      McpError
    );
    expect(client.reportProgress).not.toHaveBeenCalled();
  });

  it("rejects an unknown phase and inconsistent test counts", async () => {
    await expect(
      call("vibemap_report_progress", { criterionId: "c1", phase: "done" })
    ).rejects.toThrow(McpError);
    await expect(
      call("vibemap_report_progress", {
        criterionId: "c1",
        phase: "running_tests",
        tests: { passed: 3, failed: 2, total: 4 },
      })
    ).rejects.toThrow(McpError);
  });

  it("forwards phase, plan, files and tests", async () => {
    const detail = {
      phase: "implementing",
      plan: [{ step: "a", done: false }],
      files: ["x.ts"],
      tests: { passed: 1, failed: 0, total: 1 },
    };
    await call("vibemap_report_progress", { criterionId: "c1", ...detail });
    expect(client.reportProgress).toHaveBeenCalledWith("c1", detail);
  });
});

describe("vibemap_ask_user", () => {
  it("blocks with spec_unclear and files the question", async () => {
    await call("vibemap_ask_user", {
      criterionId: "c1",
      question: "Which currency?",
      options: ["USD", "EUR"],
    });
    expect(client.blockCriterion).toHaveBeenCalledWith(
      "c1",
      "spec_unclear",
      "Which currency?",
      { question: "Which currency?", options: ["USD", "EUR"] }
    );
  });

  it("uses an explicit reason when given", async () => {
    await call("vibemap_ask_user", { criterionId: "c1", question: "q?", reason: "ctx" });
    expect(client.blockCriterion).toHaveBeenCalledWith("c1", "spec_unclear", "ctx", {
      question: "q?",
      options: undefined,
    });
  });

  it("rejects an empty question and an empty options list", async () => {
    await expect(call("vibemap_ask_user", { criterionId: "c1", question: "  " })).rejects.toThrow(
      McpError
    );
    await expect(
      call("vibemap_ask_user", { criterionId: "c1", question: "q", options: [] })
    ).rejects.toThrow(McpError);
    expect(client.blockCriterion).not.toHaveBeenCalled();
  });
});

describe("vibemap_propose_spec_change", () => {
  const valid = {
    projectId: "p1",
    entity: "acceptance_criterion",
    entityId: "e1",
    fields: { then_outcome: "shows an error" },
    rationale: "The page already returns an error here",
  };

  it("stages through the proposal client method, never an update", async () => {
    await call("vibemap_propose_spec_change", valid);
    expect(client.proposeSpecChange).toHaveBeenCalledWith(valid);
    expect(client.updateFeature).not.toHaveBeenCalled();
  });

  it.each([
    ["empty fields", { fields: {} }],
    ["no rationale", { rationale: "" }],
    ["unknown entity", { entity: "database_table" }],
    ["too many fields", { fields: Object.fromEntries(Array.from({ length: 21 }, (_, i) => [`f${i}`, 1])) }],
  ])("rejects %s", async (_label, patch) => {
    await expect(call("vibemap_propose_spec_change", { ...valid, ...patch })).rejects.toThrow(
      McpError
    );
    expect(client.proposeSpecChange).not.toHaveBeenCalled();
  });
});

describe("the other new tools dispatch to the client", () => {
  it("claim_story / get_criterion_context / get_execution_plan / rework / evidence", async () => {
    await call("vibemap_claim_story", { storyId: "s1" });
    expect(client.claimStory).toHaveBeenCalledWith("s1", undefined);
    await call("vibemap_get_criterion_context", { criterionId: "c1", includeSource: true });
    expect(client.getCriterionContext).toHaveBeenCalledWith("c1", true);
    await call("vibemap_get_execution_plan", { projectId: "p1", releaseId: "r1" });
    expect(client.getExecutionPlan).toHaveBeenCalledWith("p1", "r1");
    await call("vibemap_rework_criterion", { criterionId: "c1", plan: "p" });
    expect(client.reworkCriterion).toHaveBeenCalledWith("c1", "p");
    await call("vibemap_get_criterion_evidence", { criterionId: "c1", limit: 3 });
    expect(client.getCriterionEvidence).toHaveBeenCalledWith("c1", 3);
  });

  it("get_answers / get_spec_delta / release tools / next ready scope / changeset cursor", async () => {
    await call("vibemap_get_answers", { projectId: "p1", criterionId: "c1", since: "2026-10-12T00:00:00Z" });
    expect(client.getAnswers).toHaveBeenCalledWith("p1", "c1", "2026-10-12T00:00:00Z");
    await call("vibemap_get_spec_delta", { projectId: "p1", sinceSeq: 0 });
    expect(client.getSpecDelta).toHaveBeenCalledWith("p1", 0, undefined);
    await call("vibemap_get_release_work_list", { releaseId: "r1" });
    expect(client.getReleaseWorkList).toHaveBeenCalledWith("r1");
    await call("vibemap_get_release_diff", { releaseId: "r1" });
    expect(client.getReleaseDiff).toHaveBeenCalledWith("r1");
    await call("vibemap_get_next_ready_criterion", { projectId: "p1", releaseId: "r1" });
    expect(client.getNextReadyCriterion).toHaveBeenCalledWith("p1", "r1");
    await call("vibemap_list_changesets", { projectId: "p1", sinceSeq: 4 });
    expect(client.listChangesets).toHaveBeenCalledWith("p1", {
      limit: undefined,
      includeOps: undefined,
      sinceSeq: 4,
    });
  });

  it("rejects a negative spec sequence", async () => {
    await expect(call("vibemap_get_spec_delta", { projectId: "p1", sinceSeq: -1 })).rejects.toThrow(
      McpError
    );
  });
});

describe("tool descriptions steer the build loop", () => {
  async function tool(name: string) {
    const { tools } = await handleListTools();
    const t = tools.find((x: { name: string }) => x.name === name);
    expect(t, name).toBeDefined();
    return t as { description: string; inputSchema: { properties: Record<string, unknown>; required?: string[] } };
  }

  it("the blueprint tool points builders at the per-criterion context", async () => {
    const d = (await tool("vibemap_get_atomic_blueprint")).description;
    expect(d).toContain("vibemap_get_criterion_context");
    expect(d).not.toMatch(/prefer this over/i);
  });

  it("the direct spec update tools point builders at propose_spec_change", async () => {
    for (const name of [
      "vibemap_update_feature",
      "vibemap_update_user_story",
      "vibemap_update_acceptance_criterion",
    ]) {
      expect((await tool(name)).description, name).toContain("vibemap_propose_spec_change");
    }
  });

  it("sync_changes no longer promises that re-submitting clears drift", async () => {
    const d = (await tool("vibemap_sync_changes")).description;
    expect(d).not.toMatch(/to clear the drift/i);
    expect(d).toMatch(/does not clear/i);
  });

  it("submit and progress schemas require the fields the backend requires", async () => {
    expect((await tool("vibemap_submit_for_review")).inputSchema.required).toEqual(
      expect.arrayContaining(["criterionId", "gitSha", "changedFiles", "tests"])
    );
    expect((await tool("vibemap_report_progress")).inputSchema.required).toContain("phase");
  });
});
