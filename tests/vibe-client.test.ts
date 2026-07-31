import { HttpResponse, http } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { VibeMapClient } from "../src/vibe-client";

const baseUrl = "http://test-api.vibemap.com";
const apiKey = "test-api-key";

const server = setupServer();

beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe("VibeMapClient", () => {
  const client = new VibeMapClient({ baseUrl, apiKey });

  // ── Projects ───────────────────────────────────────────────────────────────

  it("lists projects successfully", async () => {
    const mockProjects = [{ id: "1", name: "Project 1" }];
    server.use(
      http.get(`${baseUrl}/api/crud/projects`, () => {
        return HttpResponse.json(mockProjects);
      })
    );

    const projects = await client.listProjects();
    expect(projects).toEqual(mockProjects);
  });

  it("gets a single project with analysis", async () => {
    const mockProject = { id: "1", name: "Project 1", analysis: {} };
    server.use(
      http.get(`${baseUrl}/api/crud/projects`, ({ request }) => {
        const url = new URL(request.url);
        if (url.searchParams.get("id") === "1") {
          return HttpResponse.json(mockProject);
        }
        return new HttpResponse(null, { status: 404 });
      })
    );

    const project = await client.getProject("1");
    expect(project).toEqual(mockProject);
  });

  it("sends Authorization header with API key", async () => {
    let capturedAuth = "";
    server.use(
      http.get(`${baseUrl}/api/crud/projects`, ({ request }) => {
        capturedAuth = request.headers.get("authorization") ?? "";
        return HttpResponse.json([]);
      })
    );

    await client.listProjects();
    expect(capturedAuth).toBe(`Bearer ${apiKey}`);
  });

  // ── Features ───────────────────────────────────────────────────────────────

  it("lists features with query params", async () => {
    let capturedUrl = "";
    server.use(
      http.get(`${baseUrl}/api/crud/features`, ({ request }) => {
        capturedUrl = request.url;
        return HttpResponse.json({ features: [], meta: {} });
      })
    );

    await client.listFeatures({ project_id: "proj-1", status: "open", limit: 10 });
    expect(capturedUrl).toContain("project_id=proj-1");
    expect(capturedUrl).toContain("status=open");
    expect(capturedUrl).toContain("limit=10");
  });

  it("creates a feature via POST", async () => {
    const created = { id: "f1", name: "Auth" };
    server.use(
      http.post(`${baseUrl}/api/crud/features`, async ({ request }) => {
        const body = (await request.json()) as any;
        expect(body.name).toBe("Auth");
        expect(body.project_id).toBe("proj-1");
        return HttpResponse.json(created);
      })
    );

    const result = await client.createFeature({ project_id: "proj-1", name: "Auth" });
    expect(result).toEqual(created);
  });

  it("updates a feature via PUT", async () => {
    server.use(
      http.put(`${baseUrl}/api/crud/features`, async ({ request }) => {
        const body = (await request.json()) as any;
        expect(body.id).toBe("f1");
        expect(body.status).toBe("completed");
        return HttpResponse.json({ id: "f1", status: "completed" });
      })
    );

    const result = await client.updateFeature("f1", { status: "completed" });
    expect((result as any).status).toBe("completed");
  });

  // ── User Stories ───────────────────────────────────────────────────────────

  it("lists user stories", async () => {
    server.use(
      http.get(`${baseUrl}/api/crud/user-stories`, ({ request }) => {
        const url = new URL(request.url);
        expect(url.searchParams.get("feature_id")).toBe("f1");
        return HttpResponse.json({ user_stories: [{ id: "s1" }], meta: {} });
      })
    );

    const result = await client.listUserStories({ feature_id: "f1" });
    expect((result as any).user_stories).toHaveLength(1);
  });

  it("creates a user story via POST", async () => {
    server.use(
      http.post(`${baseUrl}/api/crud/user-stories`, async ({ request }) => {
        const body = (await request.json()) as any;
        expect(body.title).toBe("Login");
        return HttpResponse.json({ id: "s-new", title: "Login" });
      })
    );

    const result = await client.createUserStory({
      feature_id: "f1",
      title: "Login",
      description: "As a user I want to login",
    });
    expect((result as any).title).toBe("Login");
  });

  it("updates a user story status", async () => {
    server.use(
      http.put(`${baseUrl}/api/crud/user-stories`, async ({ request }) => {
        const body = (await request.json()) as any;
        expect(body.id).toBe("story-1");
        expect(body.status).toBe("completed");
        return HttpResponse.json({ success: true });
      })
    );

    const result = await client.updateUserStory("story-1", { status: "completed" });
    expect(result).toEqual({ success: true });
  });

  // ── Acceptance Criteria ───────────────────────────────────────────────────

  it("lists acceptance criteria", async () => {
    server.use(
      http.get(`${baseUrl}/api/crud/acceptance-criteria`, ({ request }) => {
        const url = new URL(request.url);
        expect(url.searchParams.get("story_id")).toBe("s1");
        return HttpResponse.json({ acceptance_criteria: [{ id: "ac1" }], meta: {} });
      })
    );

    const result = await client.listAcceptanceCriteria({ story_id: "s1" });
    expect((result as any).acceptance_criteria).toHaveLength(1);
  });

  it("updates an acceptance criterion via PUT", async () => {
    server.use(
      http.put(`${baseUrl}/api/crud/acceptance-criteria`, async ({ request }) => {
        const body = (await request.json()) as any;
        expect(body.id).toBe("ac1");
        expect(body.status).toBe("passed");
        return HttpResponse.json({ id: "ac1", status: "passed" });
      })
    );

    const result = await client.updateAcceptanceCriterion("ac1", { status: "passed" });
    expect((result as any).status).toBe("passed");
  });

  // ── Tasks ─────────────────────────────────────────────────────────────────

  it("submits a task correctly", async () => {
    const mockSession = { sessionId: "session-123" };
    server.use(
      http.post(`${baseUrl}/api/tasks/submit`, async ({ request }) => {
        const body = (await request.json()) as any;
        expect(body.title).toBe("Test Task");
        return HttpResponse.json(mockSession);
      })
    );

    const result = await client.submitTask({
      title: "Test Task",
      prompt: "Test Prompt",
      projectId: "1",
      taskType: "features",
    });

    expect(result).toEqual(mockSession);
  });

  it("gets task status by sessionId", async () => {
    server.use(
      http.get(`${baseUrl}/api/tasks/session-abc/status`, () => {
        return HttpResponse.json({ status: "completed", featuresCreated: 3 });
      })
    );

    const result = await client.getTaskStatus("session-abc");
    expect((result as any).status).toBe("completed");
    expect((result as any).featuresCreated).toBe(3);
  });

  // ── Error handling ────────────────────────────────────────────────────────

  it("handles 401 Unauthorized correctly", async () => {
    server.use(
      http.get(`${baseUrl}/api/crud/projects`, () => {
        return new HttpResponse(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
      })
    );

    await expect(client.listProjects()).rejects.toThrow("Unauthorized");
  });

  it("handles 404 Not Found", async () => {
    server.use(
      http.get(`${baseUrl}/api/crud/projects`, () => {
        return new HttpResponse(JSON.stringify({ error: "Not Found" }), { status: 404 });
      })
    );

    await expect(client.listProjects()).rejects.toThrow("Not Found");
  });

  it("handles network errors or malformed JSON", async () => {
    server.use(
      http.get(`${baseUrl}/api/crud/projects`, () => {
        return new HttpResponse("Not JSON", { status: 500 });
      })
    );

    await expect(client.listProjects()).rejects.toThrow("Internal Server Error");
  });

  it("omits undefined query params from URL", async () => {
    let capturedUrl = "";
    server.use(
      http.get(`${baseUrl}/api/crud/features`, ({ request }) => {
        capturedUrl = request.url;
        return HttpResponse.json({ features: [], meta: {} });
      })
    );

    await client.listFeatures({ project_id: "proj-1", status: undefined });
    expect(capturedUrl).not.toContain("status=");
    expect(capturedUrl).toContain("project_id=proj-1");
  });

  // ── Atomic Blueprint ─────────────────────────────────────────────────────

  it("calls /api/mcp/atomic-blueprint with the projectId", async () => {
    let capturedUrl = "";
    let capturedAuth = "";
    const mockBlueprint = {
      project: { id: "proj-1", name: "X" },
      roles: [],
      entities: [],
      interactions: [],
      pages: [],
      navigation: { header: [], footer: [], flows: [] },
      _meta: { blueprint_version: 1 },
    };
    server.use(
      http.get(`${baseUrl}/api/mcp/atomic-blueprint`, ({ request }) => {
        capturedUrl = request.url;
        capturedAuth = request.headers.get("authorization") ?? "";
        return HttpResponse.json(mockBlueprint);
      })
    );

    const result = await client.getAtomicBlueprint("proj-1");
    expect(capturedUrl).toContain("projectId=proj-1");
    expect(capturedAuth).toBe(`Bearer ${apiKey}`);
    expect(result).toEqual(mockBlueprint);
  });

  it("propagates server errors from the atomic-blueprint route", async () => {
    server.use(
      http.get(`${baseUrl}/api/mcp/atomic-blueprint`, () => {
        return HttpResponse.json({ error: "Project not found" }, { status: 404 });
      })
    );

    await expect(client.getAtomicBlueprint("missing")).rejects.toThrow("Project not found");
  });

  it("calls /api/mcp/access-rules with the projectId", async () => {
    let capturedUrl = "";
    let capturedAuth = "";
    const mockRules = {
      project_id: "proj-1",
      table_rules: [
        {
          id: "tr-1",
          table_name: "orders",
          role: "customer",
          can_select: true,
          op_conditions: { select: { kind: "own", column: "user_id" } },
        },
      ],
      page_rules: [],
      reconciliation: {
        findings: [],
        high_confidence: 0,
        low_confidence: 0,
        safe_to_auto_apply: 0,
      },
    };
    server.use(
      http.get(`${baseUrl}/api/mcp/access-rules`, ({ request }) => {
        capturedUrl = request.url;
        capturedAuth = request.headers.get("authorization") ?? "";
        return HttpResponse.json(mockRules);
      })
    );

    const result = await client.listAccessRules("proj-1");
    expect(capturedUrl).toContain("projectId=proj-1");
    expect(capturedAuth).toBe(`Bearer ${apiKey}`);
    expect(result).toEqual(mockRules);
  });

  it("propagates server errors from the access-rules route", async () => {
    server.use(
      http.get(`${baseUrl}/api/mcp/access-rules`, () => {
        return HttpResponse.json({ error: "Project not found" }, { status: 404 });
      })
    );

    await expect(client.listAccessRules("missing")).rejects.toThrow("Project not found");
  });

  it("calls /api/mcp/changesets with projectId and forwards limit + includeOps", async () => {
    let capturedUrl = "";
    const mockChangesets = {
      project_id: "proj-1",
      limit: 10,
      count: 1,
      changesets: [{ id: "cs-1", sequence_number: 3, source: "mcp", op_count: 2 }],
    };
    server.use(
      http.get(`${baseUrl}/api/mcp/changesets`, ({ request }) => {
        capturedUrl = request.url;
        return HttpResponse.json(mockChangesets);
      })
    );

    const result = await client.listChangesets("proj-1", { limit: 10, includeOps: true });
    expect(capturedUrl).toContain("projectId=proj-1");
    expect(capturedUrl).toContain("limit=10");
    expect(capturedUrl).toContain("includeOps=true");
    expect(result).toEqual(mockChangesets);
  });

  it("omits optional changeset params when not provided", async () => {
    let capturedUrl = "";
    server.use(
      http.get(`${baseUrl}/api/mcp/changesets`, ({ request }) => {
        capturedUrl = request.url;
        return HttpResponse.json({ project_id: "proj-1", changesets: [] });
      })
    );

    await client.listChangesets("proj-1");
    expect(capturedUrl).toContain("projectId=proj-1");
    expect(capturedUrl).not.toContain("limit=");
    expect(capturedUrl).not.toContain("includeOps=");
  });

  // ── Personas & Pages ─────────────────────────────────────────────────────────

  it("creates a persona via POST", async () => {
    server.use(
      http.post(`${baseUrl}/api/crud/personas`, async ({ request }) => {
        const body = (await request.json()) as any;
        expect(body.project_id).toBe("proj-1");
        expect(body.name).toBe("Alex");
        expect(body.goals_and_needs).toEqual({ primary_objectives: ["Ship fast"] });
        return HttpResponse.json({ id: "p-new", name: "Alex" });
      })
    );

    const result = await client.createPersona({
      project_id: "proj-1",
      name: "Alex",
      goals_and_needs: { primary_objectives: ["Ship fast"] },
    });
    expect((result as any).id).toBe("p-new");
  });

  it("creates a page via POST", async () => {
    server.use(
      http.post(`${baseUrl}/api/crud/pages`, async ({ request }) => {
        const body = (await request.json()) as any;
        expect(body.project_id).toBe("proj-1");
        expect(body.name).toBe("Dashboard");
        expect(body.path).toBe("/dashboard");
        return HttpResponse.json({ id: "pg-new", name: "Dashboard" });
      })
    );

    const result = await client.createPage({
      project_id: "proj-1",
      name: "Dashboard",
      path: "/dashboard",
      status: "draft",
    });
    expect((result as any).id).toBe("pg-new");
  });

  // ── Schema ─────────────────────────────────────────────────────────────────────

  it("creates a schema via POST with a camelCase body", async () => {
    let capturedBody: any;
    server.use(
      http.post(`${baseUrl}/api/crud/schema`, async ({ request }) => {
        capturedBody = await request.json();
        return HttpResponse.json({ tables: [{ id: "t1", name: "users" }], meta: { tables: 1 } });
      })
    );

    const result = await client.createSchema({
      projectId: "proj-1",
      tables: [
        {
          name: "users",
          columns: [
            { name: "id", type: "UUID", primaryKey: true },
            { name: "org_id", type: "UUID", foreignKey: { table: "orgs", column: "id" } },
          ],
        },
      ],
    });

    expect((result as any).tables).toHaveLength(1);
    expect(capturedBody.projectId).toBe("proj-1");
    // camelCase is preserved on the wire — no snake_case conversion.
    expect(capturedBody.tables[0].columns[0].primaryKey).toBe(true);
    expect(capturedBody.tables[0].columns[1].foreignKey).toEqual({ table: "orgs", column: "id" });
  });

  it("propagates server errors from the schema route", async () => {
    server.use(
      http.post(`${baseUrl}/api/crud/schema`, () => {
        return HttpResponse.json({ error: "Project not found or access denied" }, { status: 404 });
      })
    );

    await expect(
      client.createSchema({ projectId: "missing", tables: [{ name: "x", columns: [] }] })
    ).rejects.toThrow("Project not found or access denied");
  });

  // ── Agent ────────────────────────────────────────────────────────────────────

  it("drives the agent via POST /api/mcp/agent with message + opts", async () => {
    let capturedBody: any;
    server.use(
      http.post(`${baseUrl}/api/mcp/agent`, async ({ request }) => {
        capturedBody = await request.json();
        return HttpResponse.json({
          success: true,
          response: "You have 3 features.",
          confirmationRequired: false,
          sessionId: "11111111-1111-1111-1111-111111111111",
        });
      })
    );

    const result = await client.agent("proj-1", "what features do I have?", {
      model: "gemini-3-flash",
    });

    expect((result as any).response).toBe("You have 3 features.");
    expect(capturedBody.projectId).toBe("proj-1");
    expect(capturedBody.message).toBe("what features do I have?");
    expect(capturedBody.model).toBe("gemini-3-flash");
  });

  it("forwards approveOperationId for the two-call confirm flow", async () => {
    let capturedBody: any;
    server.use(
      http.post(`${baseUrl}/api/mcp/agent`, async ({ request }) => {
        capturedBody = await request.json();
        return HttpResponse.json({ success: true, response: "Done." });
      })
    );

    await client.agent("proj-1", "", { approveOperationId: "op-123" });
    expect(capturedBody.projectId).toBe("proj-1");
    expect(capturedBody.approveOperationId).toBe("op-123");
  });

  it("propagates server errors from the agent route", async () => {
    server.use(
      http.post(`${baseUrl}/api/mcp/agent`, () => {
        return HttpResponse.json({ error: "Project not found or access denied" }, { status: 404 });
      })
    );

    await expect(client.agent("missing", "hi")).rejects.toThrow("Project not found or access denied");
  });

  // ── Prompts ──────────────────────────────────────────────────────────────────

  it("fetches an expanded prompt and returns its text", async () => {
    let capturedUrl = "";
    server.use(
      http.get(`${baseUrl}/api/mcp/prompts`, ({ request }) => {
        capturedUrl = request.url;
        return HttpResponse.json({ name: "author_idea", text: "EXPANDED" });
      })
    );

    const text = await client.getPrompt("author_idea", { projectId: "proj-1" });
    expect(text).toBe("EXPANDED");
    expect(capturedUrl).toContain("name=author_idea");
    expect(capturedUrl).toContain("projectId=proj-1");
    expect(capturedUrl).not.toContain("localPath=");
  });

  it("includes localPath when provided", async () => {
    let capturedUrl = "";
    server.use(
      http.get(`${baseUrl}/api/mcp/prompts`, ({ request }) => {
        capturedUrl = request.url;
        return HttpResponse.json({ name: "author_spec", text: "X" });
      })
    );

    await client.getPrompt("author_spec", { projectId: "proj-1", localPath: "/home/me/app" });
    expect(capturedUrl).toContain("localPath=%2Fhome%2Fme%2Fapp");
  });

  // ── Auth failures ──────────────────────────────────────────────────────────

  describe("401 handling", () => {
    it("names the rejecting host and the per-instance rule", async () => {
      server.use(
        http.get(`${baseUrl}/api/crud/projects`, () =>
          HttpResponse.json({ error: "Unauthorized" }, { status: 401 })
        )
      );

      await expect(client.listProjects()).rejects.toThrow(baseUrl);
      await expect(client.listProjects()).rejects.toThrow(/only valid on the VibeMap instance/);
    });

    it("leaves non-401 errors unembellished", async () => {
      server.use(
        http.get(`${baseUrl}/api/crud/projects`, () =>
          HttpResponse.json({ error: "Project not found" }, { status: 404 })
        )
      );

      await expect(client.listProjects()).rejects.toThrow("Project not found");
      await expect(client.listProjects()).rejects.not.toThrow(/VIBEMAP_API_KEY/);
    });
  });
});
