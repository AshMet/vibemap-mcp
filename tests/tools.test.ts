import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { handleCallTool, handleListTools, resetVibeClient } from "../src/index";
import { buildCodebaseDigest, walkDir } from "../src/utils";
import { VibeMapClient } from "../src/vibe-client";

// Set env var for testing
process.env.VIBEMAP_API_KEY = "test-key";

// ─── Mock setup ───────────────────────────────────────────────────────────────

vi.mock("../src/vibe-client", () => {
  return {
    VibeMapClient: vi.fn().mockImplementation(() => ({
      listProjects: vi.fn(),
      getProject: vi.fn(),
      createProject: vi.fn(),
      listFeatures: vi.fn(),
      getFeature: vi.fn(),
      createFeature: vi.fn(),
      updateFeature: vi.fn(),
      listUserStories: vi.fn(),
      getUserStory: vi.fn(),
      createUserStory: vi.fn(),
      updateUserStory: vi.fn(),
      listAcceptanceCriteria: vi.fn(),
      getCriterion: vi.fn(),
      createAcceptanceCriterion: vi.fn(),
      updateAcceptanceCriterion: vi.fn(),
      submitTask: vi.fn(),
      getTaskStatus: vi.fn(),
    })),
  };
});

vi.mock("../src/utils", () => {
  return {
    walkDir: vi.fn(),
    buildCodebaseDigest: vi.fn(),
  };
});

// ─── Stable mock client ───────────────────────────────────────────────────────

const stableMockClient = {
  listProjects: vi.fn(),
  getProject: vi.fn(),
  createProject: vi.fn(),
  listFeatures: vi.fn(),
  getFeature: vi.fn(),
  createFeature: vi.fn(),
  updateFeature: vi.fn(),
  listUserStories: vi.fn(),
  getUserStory: vi.fn(),
  createUserStory: vi.fn(),
  updateUserStory: vi.fn(),
  listAcceptanceCriteria: vi.fn(),
  getCriterion: vi.fn(),
  createAcceptanceCriterion: vi.fn(),
  updateAcceptanceCriterion: vi.fn(),
  submitTask: vi.fn(),
  getTaskStatus: vi.fn(),
};

vi.mocked(VibeMapClient).mockImplementation(() => stableMockClient as any);

// ─── Test helpers ─────────────────────────────────────────────────────────────

function makeRequest(name: string, args: Record<string, unknown> = {}) {
  return { params: { name, arguments: args } } as any;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("MCP Tools", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── handleListTools ──────────────────────────────────────────────────────────
  describe("handleListTools", () => {
    it("returns 18 vibemap_ prefixed tools", async () => {
      const result = await handleListTools();
      expect(result.tools).toHaveLength(18);
      for (const tool of result.tools) {
        expect(tool.name).toMatch(/^vibemap_/);
      }
    });

    it("all tools have annotations", async () => {
      const result = await handleListTools();
      for (const tool of result.tools) {
        expect(tool).toHaveProperty("annotations");
        expect(typeof tool.annotations).toBe("object");
      }
    });

    it("all tools have inputSchema", async () => {
      const result = await handleListTools();
      for (const tool of result.tools) {
        expect(tool).toHaveProperty("inputSchema");
        expect(tool.inputSchema.type).toBe("object");
      }
    });

    it("all 15 expected tool names are present", async () => {
      const result = await handleListTools();
      const names = result.tools.map((t: { name: string }) => t.name);
      const expected = [
        "vibemap_list_projects",
        "vibemap_get_project_context",
        "vibemap_list_features",
        "vibemap_create_feature",
        "vibemap_update_feature",
        "vibemap_list_user_stories",
        "vibemap_create_user_story",
        "vibemap_update_user_story",
        "vibemap_list_acceptance_criteria",
        "vibemap_update_acceptance_criterion",
        "vibemap_update_kanban_status",
        "vibemap_get_kanban_board",
        "vibemap_scan_codebase",
        "vibemap_analyze_codebase",
        "vibemap_get_generation_status",
      ];
      for (const name of expected) {
        expect(names).toContain(name);
      }
    });
  });

  // ── vibemap_list_projects ────────────────────────────────────────────────────
  describe("vibemap_list_projects", () => {
    it("returns project list", async () => {
      const mockProjects = [{ id: "1", name: "Project A" }];
      stableMockClient.listProjects.mockResolvedValue(mockProjects);

      const result = await handleCallTool(makeRequest("vibemap_list_projects"));
      expect(result.content[0].text).toContain("Project A");
    });

    it("strips slug and embedding fields", async () => {
      const mockProjects = [{ id: "1", name: "P", slug: "p", embedding: [0.1] }];
      stableMockClient.listProjects.mockResolvedValue(mockProjects);

      const result = await handleCallTool(makeRequest("vibemap_list_projects"));
      const data = JSON.parse(result.content[0].text);
      expect(data[0].slug).toBeUndefined();
      expect(data[0].embedding).toBeUndefined();
      expect(data[0].name).toBe("P");
    });

    it("returns empty array when no projects exist", async () => {
      stableMockClient.listProjects.mockResolvedValue([]);
      const result = await handleCallTool(makeRequest("vibemap_list_projects"));
      const data = JSON.parse(result.content[0].text);
      expect(data).toEqual([]);
    });
  });

  // ── vibemap_get_project_context ──────────────────────────────────────────────
  describe("vibemap_get_project_context", () => {
    it("returns project context with features and stories", async () => {
      const mockProject = {
        id: "proj-1",
        name: "My Project",
        analysis: {
          features: [{ id: "f1", name: "Auth" }],
          personas: [{ id: "p1", name: "Admin", user_role: "admin", tagline: "Power user" }],
          pages: [{ id: "pg1", name: "Login", description: "Login page", path: "/login" }],
          sections: [{ id: "sec1", page_id: "pg1", name: "Form", description: "Login form" }],
          dbSchema: { entities: ["users"] },
        },
      };
      stableMockClient.getProject.mockResolvedValue(mockProject);
      stableMockClient.listUserStories.mockResolvedValue({
        user_stories: [{ id: "s1", title: "Login" }],
      });

      const result = await handleCallTool(
        makeRequest("vibemap_get_project_context", {
          projectId: "proj-1",
          includeFeatures: true,
          includeStories: true,
          includePersonas: true,
          includePages: true,
          includeSchema: true,
        })
      );

      const data = JSON.parse(result.content[0].text);
      expect(data.project.id).toBe("proj-1");
      expect(data.project.analysis).toBeUndefined(); // flattened
      expect(data.features).toHaveLength(1);
      expect(data.stories).toHaveLength(1);
      expect(data.personas[0].name).toBe("Admin");
      expect(data.pages).toHaveLength(1);
      expect(data.dbSchema).toBeDefined();
    });

    it("strips noise fields and secondary target_audience keys", async () => {
      const mockProject = {
        id: "proj-1",
        name: "P",
        slug: "p",
        project_type: "web",
        business_context: { market: "big" },
        target_audience: { primary: ["devs"], secondary: ["mgrs"] },
        constraints: { budget: "10k", timeline: "1 month", technical: "TS only" },
        analysis: { features: [], personas: [] },
      };
      stableMockClient.getProject.mockResolvedValue(mockProject);
      stableMockClient.listUserStories.mockResolvedValue({ user_stories: [] });
      stableMockClient.listFeatures.mockResolvedValue({ features: [] });

      const result = await handleCallTool(
        makeRequest("vibemap_get_project_context", { projectId: "proj-1" })
      );
      const data = JSON.parse(result.content[0].text);
      const p = data.project;

      expect(p.slug).toBeUndefined();
      expect(p.project_type).toBeUndefined();
      expect(p.business_context).toBeUndefined();
      expect(p.target_audience.primary).toEqual(["devs"]);
      expect(p.target_audience.secondary).toBeUndefined();
      expect(p.constraints.budget).toBeUndefined();
      expect(p.constraints.technical).toBe("TS only"); // kept
    });

    it("throws McpError with absent projectId", async () => {
      await expect(handleCallTool(makeRequest("vibemap_get_project_context", {}))).rejects.toThrow(
        McpError
      );
    });
  });

  // ── vibemap_list_features ────────────────────────────────────────────────────
  describe("vibemap_list_features", () => {
    it("lists features for a project", async () => {
      stableMockClient.listFeatures.mockResolvedValue({
        features: [{ id: "f1", name: "Auth", status: "open" }],
        meta: { total: 1 },
      });

      const result = await handleCallTool(
        makeRequest("vibemap_list_features", { projectId: "proj-1" })
      );
      const data = JSON.parse(result.content[0].text);
      expect(data.features).toHaveLength(1);
      expect(data.features[0].name).toBe("Auth");
    });

    it("passes filter options to client", async () => {
      stableMockClient.listFeatures.mockResolvedValue({ features: [], meta: {} });

      await handleCallTool(
        makeRequest("vibemap_list_features", {
          projectId: "proj-1",
          status: "in_progress",
          priority: "high",
        })
      );

      expect(stableMockClient.listFeatures).toHaveBeenCalledWith(
        expect.objectContaining({ status: "in_progress", priority: "high" })
      );
    });

    it("throws on missing projectId", async () => {
      await expect(handleCallTool(makeRequest("vibemap_list_features", {}))).rejects.toThrow(
        McpError
      );
    });
  });

  // ── vibemap_create_feature ───────────────────────────────────────────────────
  describe("vibemap_create_feature", () => {
    it("creates a feature", async () => {
      stableMockClient.createFeature.mockResolvedValue({ id: "f-new", name: "Payments" });

      const result = await handleCallTool(
        makeRequest("vibemap_create_feature", {
          projectId: "proj-1",
          name: "Payments",
          description: "Payment processing",
        })
      );

      const data = JSON.parse(result.content[0].text);
      expect(data.id).toBe("f-new");
      expect(data.name).toBe("Payments");
    });

    it("throws on missing name", async () => {
      await expect(
        handleCallTool(makeRequest("vibemap_create_feature", { projectId: "proj-1" }))
      ).rejects.toThrow(McpError);
    });

    it("throws on missing projectId", async () => {
      await expect(
        handleCallTool(makeRequest("vibemap_create_feature", { name: "Payments" }))
      ).rejects.toThrow(McpError);
    });
  });

  // ── vibemap_update_feature ───────────────────────────────────────────────────
  describe("vibemap_update_feature", () => {
    it("updates a feature's name and priority", async () => {
      stableMockClient.updateFeature.mockResolvedValue({
        id: "f1",
        name: "Updated Auth",
        priority: "high",
        status: "open",
      });

      const result = await handleCallTool(
        makeRequest("vibemap_update_feature", {
          featureId: "f1",
          name: "Updated Auth",
          priority: "high",
        })
      );

      const data = JSON.parse(result.content[0].text);
      expect(data.id).toBe("f1");
      expect(data.name).toBe("Updated Auth");
      expect(stableMockClient.updateFeature).toHaveBeenCalledWith(
        "f1",
        expect.objectContaining({ name: "Updated Auth", priority: "high" })
      );
    });

    it("updates a feature's status", async () => {
      stableMockClient.getFeature.mockResolvedValue({ id: "f1", status: "in_progress" });
      stableMockClient.updateFeature.mockResolvedValue({ id: "f1", status: "completed" });

      const result = await handleCallTool(
        makeRequest("vibemap_update_feature", {
          featureId: "f1",
          status: "completed",
        })
      );

      const data = JSON.parse(result.content[0].text);
      expect(data.status).toBe("completed");
    });

    it("throws on missing featureId", async () => {
      await expect(
        handleCallTool(makeRequest("vibemap_update_feature", { name: "New Name" }))
      ).rejects.toThrow(McpError);
    });
  });

  // ── vibemap_list_user_stories ────────────────────────────────────────────────
  describe("vibemap_list_user_stories", () => {
    it("lists stories filtered by feature", async () => {
      stableMockClient.listUserStories.mockResolvedValue({
        user_stories: [{ id: "s1", title: "Login", status: "open" }],
        meta: { total: 1 },
      });

      const result = await handleCallTool(
        makeRequest("vibemap_list_user_stories", {
          featureId: "f1",
        })
      );

      const data = JSON.parse(result.content[0].text);
      expect(data.user_stories).toHaveLength(1);
    });

    it("lists stories filtered by project", async () => {
      stableMockClient.listUserStories.mockResolvedValue({
        user_stories: [
          { id: "s1", title: "Login" },
          { id: "s2", title: "Signup" },
        ],
        meta: { total: 2 },
      });

      const result = await handleCallTool(
        makeRequest("vibemap_list_user_stories", {
          projectId: "proj-1",
        })
      );

      const data = JSON.parse(result.content[0].text);
      expect(data.user_stories).toHaveLength(2);
    });

    it("throws when neither projectId nor featureId is provided", async () => {
      await expect(handleCallTool(makeRequest("vibemap_list_user_stories", {}))).rejects.toThrow(
        McpError
      );
    });
  });

  // ── vibemap_create_user_story ────────────────────────────────────────────────
  describe("vibemap_create_user_story", () => {
    it("creates a user story with BDD fields", async () => {
      stableMockClient.createUserStory.mockResolvedValue({
        id: "s-new",
        title: "User can log in",
        feature_id: "f1",
        status: "draft",
      });

      const result = await handleCallTool(
        makeRequest("vibemap_create_user_story", {
          featureId: "f1",
          title: "User can log in",
          description: "As a user I want to log in",
          userRole: "user",
          iWantTo: "authenticate with my email and password",
          soThat: "I can access my account",
        })
      );

      const data = JSON.parse(result.content[0].text);
      expect(data.id).toBe("s-new");
      expect(data.title).toBe("User can log in");
      expect(stableMockClient.createUserStory).toHaveBeenCalledWith(
        expect.objectContaining({ feature_id: "f1", title: "User can log in" })
      );
    });

    it("throws on missing featureId", async () => {
      await expect(
        handleCallTool(
          makeRequest("vibemap_create_user_story", {
            title: "Login",
            description: "login desc",
          })
        )
      ).rejects.toThrow(McpError);
    });

    it("throws on missing title", async () => {
      await expect(
        handleCallTool(
          makeRequest("vibemap_create_user_story", {
            featureId: "f1",
            description: "login desc",
          })
        )
      ).rejects.toThrow(McpError);
    });
  });

  // ── vibemap_update_user_story ────────────────────────────────────────────────
  describe("vibemap_update_user_story", () => {
    it("updates a story's title", async () => {
      stableMockClient.updateUserStory.mockResolvedValue({
        id: "s1",
        title: "Updated title",
      });

      const result = await handleCallTool(
        makeRequest("vibemap_update_user_story", {
          storyId: "s1",
          title: "Updated title",
        })
      );

      const data = JSON.parse(result.content[0].text);
      expect(data.title).toBe("Updated title");
      expect(stableMockClient.updateUserStory).toHaveBeenCalledWith(
        "s1",
        expect.objectContaining({ title: "Updated title" })
      );
    });

    it("updates a story's status", async () => {
      stableMockClient.getUserStory.mockResolvedValue({ id: "s1", status: "open" });
      stableMockClient.updateUserStory.mockResolvedValue({ id: "s1", status: "in_progress" });

      const result = await handleCallTool(
        makeRequest("vibemap_update_user_story", {
          storyId: "s1",
          status: "in_progress",
        })
      );

      const data = JSON.parse(result.content[0].text);
      expect(data.status).toBe("in_progress");
    });

    it("throws on missing storyId", async () => {
      await expect(
        handleCallTool(makeRequest("vibemap_update_user_story", { title: "X" }))
      ).rejects.toThrow(McpError);
    });
  });

  // ── vibemap_list_acceptance_criteria ─────────────────────────────────────────
  describe("vibemap_list_acceptance_criteria", () => {
    it("lists criteria by story", async () => {
      stableMockClient.listAcceptanceCriteria.mockResolvedValue({
        acceptance_criteria: [{ id: "ac1", given_condition: "I am logged in", status: "pending" }],
        meta: {},
      });

      const result = await handleCallTool(
        makeRequest("vibemap_list_acceptance_criteria", {
          storyId: "s1",
        })
      );

      const data = JSON.parse(result.content[0].text);
      expect(data.acceptance_criteria).toHaveLength(1);
      expect(data.acceptance_criteria[0].given_condition).toBe("I am logged in");
    });

    it("lists criteria by feature", async () => {
      stableMockClient.listAcceptanceCriteria.mockResolvedValue({
        acceptance_criteria: [{ id: "ac1" }, { id: "ac2" }],
        meta: {},
      });

      const result = await handleCallTool(
        makeRequest("vibemap_list_acceptance_criteria", {
          featureId: "f1",
        })
      );

      const data = JSON.parse(result.content[0].text);
      expect(data.acceptance_criteria).toHaveLength(2);
    });

    it("throws when no scope is provided", async () => {
      await expect(
        handleCallTool(makeRequest("vibemap_list_acceptance_criteria", {}))
      ).rejects.toThrow(McpError);
    });
  });

  // ── vibemap_update_acceptance_criterion ──────────────────────────────────────
  describe("vibemap_update_acceptance_criterion", () => {
    it("marks a criterion as passed", async () => {
      stableMockClient.getCriterion.mockResolvedValue({ id: "ac1", status: "pending" });
      stableMockClient.updateAcceptanceCriterion.mockResolvedValue({
        id: "ac1",
        status: "passed",
      });

      const result = await handleCallTool(
        makeRequest("vibemap_update_acceptance_criterion", {
          criterionId: "ac1",
          status: "passed",
        })
      );

      const data = JSON.parse(result.content[0].text);
      expect(data.status).toBe("passed");
      expect(stableMockClient.updateAcceptanceCriterion).toHaveBeenCalledWith(
        "ac1",
        expect.objectContaining({ status: "passed" })
      );
    });

    it("marks a criterion as failed", async () => {
      stableMockClient.getCriterion.mockResolvedValue({ id: "ac1", status: "pending" });
      stableMockClient.updateAcceptanceCriterion.mockResolvedValue({
        id: "ac1",
        status: "failed",
      });

      const result = await handleCallTool(
        makeRequest("vibemap_update_acceptance_criterion", {
          criterionId: "ac1",
          status: "failed",
        })
      );

      const data = JSON.parse(result.content[0].text);
      expect(data.status).toBe("failed");
    });

    it("updates BDD fields", async () => {
      stableMockClient.updateAcceptanceCriterion.mockResolvedValue({ id: "ac1" });

      await handleCallTool(
        makeRequest("vibemap_update_acceptance_criterion", {
          criterionId: "ac1",
          givenCondition: "I am on the login page",
          whenAction: "I submit valid credentials",
          thenOutcome: "I am redirected to the dashboard",
        })
      );

      expect(stableMockClient.updateAcceptanceCriterion).toHaveBeenCalledWith(
        "ac1",
        expect.objectContaining({
          given_condition: "I am on the login page",
          when_action: "I submit valid credentials",
          then_outcome: "I am redirected to the dashboard",
        })
      );
    });

    it("throws on missing criterionId", async () => {
      await expect(
        handleCallTool(makeRequest("vibemap_update_acceptance_criterion", { status: "passed" }))
      ).rejects.toThrow(McpError);
    });
  });

  // ── vibemap_update_kanban_status ─────────────────────────────────────────────
  describe("vibemap_update_kanban_status", () => {
    it("successfully transitions a feature from draft to open", async () => {
      stableMockClient.getFeature.mockResolvedValue({ id: "f1", status: "draft" });
      stableMockClient.updateFeature.mockResolvedValue({ id: "f1", status: "open" });

      const result = await handleCallTool(
        makeRequest("vibemap_update_kanban_status", {
          entityType: "feature",
          entityId: "f1",
          newStatus: "open",
        })
      );

      const data = JSON.parse(result.content[0].text);
      expect(data.success).toBe(true);
      expect(data.previousStatus).toBe("draft");
      expect(data.newStatus).toBe("open");
    });

    it("transitions a feature from open to in_progress", async () => {
      stableMockClient.getFeature.mockResolvedValue({ id: "f1", status: "open" });
      stableMockClient.updateFeature.mockResolvedValue({ id: "f1", status: "in_progress" });

      const result = await handleCallTool(
        makeRequest("vibemap_update_kanban_status", {
          entityType: "feature",
          entityId: "f1",
          newStatus: "in_progress",
        })
      );

      const data = JSON.parse(result.content[0].text);
      expect(data.success).toBe(true);
      expect(data.newStatus).toBe("in_progress");
    });

    it("transitions a feature from in_progress back to open (reverse)", async () => {
      stableMockClient.getFeature.mockResolvedValue({ id: "f1", status: "in_progress" });
      stableMockClient.updateFeature.mockResolvedValue({ id: "f1", status: "open" });

      const result = await handleCallTool(
        makeRequest("vibemap_update_kanban_status", {
          entityType: "feature",
          entityId: "f1",
          newStatus: "open",
          notes: "Reopening — needs more work",
        })
      );

      const data = JSON.parse(result.content[0].text);
      expect(data.success).toBe(true);
      expect(data.newStatus).toBe("open");
    });

    it("transitions a feature to completed", async () => {
      stableMockClient.getFeature.mockResolvedValue({ id: "f1", status: "in_progress" });
      stableMockClient.updateFeature.mockResolvedValue({ id: "f1", status: "completed" });

      const result = await handleCallTool(
        makeRequest("vibemap_update_kanban_status", {
          entityType: "feature",
          entityId: "f1",
          newStatus: "completed",
        })
      );

      const data = JSON.parse(result.content[0].text);
      expect(data.success).toBe(true);
    });

    it("returns error for invalid transition (draft → completed)", async () => {
      stableMockClient.getFeature.mockResolvedValue({ id: "f1", status: "draft" });

      const result = await handleCallTool(
        makeRequest("vibemap_update_kanban_status", {
          entityType: "feature",
          entityId: "f1",
          newStatus: "completed",
        })
      );

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Invalid transition");
      expect(result.content[0].text).toContain("draft");
      expect(result.content[0].text).toContain("completed");
    });

    it("returns error for invalid transition (draft → in_progress for feature)", async () => {
      stableMockClient.getFeature.mockResolvedValue({ id: "f1", status: "draft" });

      const result = await handleCallTool(
        makeRequest("vibemap_update_kanban_status", {
          entityType: "feature",
          entityId: "f1",
          newStatus: "in_progress",
        })
      );

      expect(result.isError).toBe(true);
    });

    it("transitions a story from draft to has_criteria", async () => {
      stableMockClient.getUserStory.mockResolvedValue({ id: "s1", status: "draft" });
      stableMockClient.updateUserStory.mockResolvedValue({ id: "s1", status: "has_criteria" });

      const result = await handleCallTool(
        makeRequest("vibemap_update_kanban_status", {
          entityType: "story",
          entityId: "s1",
          newStatus: "has_criteria",
        })
      );

      const data = JSON.parse(result.content[0].text);
      expect(data.success).toBe(true);
      expect(data.newStatus).toBe("has_criteria");
    });

    it("transitions a story from open to in_progress", async () => {
      stableMockClient.getUserStory.mockResolvedValue({ id: "s1", status: "open" });
      stableMockClient.updateUserStory.mockResolvedValue({ id: "s1", status: "in_progress" });

      const result = await handleCallTool(
        makeRequest("vibemap_update_kanban_status", {
          entityType: "story",
          entityId: "s1",
          newStatus: "in_progress",
          notes: "Starting implementation",
        })
      );

      const data = JSON.parse(result.content[0].text);
      expect(data.success).toBe(true);
      expect(data.newStatus).toBe("in_progress");
    });

    it("returns error for invalid story transition (draft → completed)", async () => {
      stableMockClient.getUserStory.mockResolvedValue({ id: "s1", status: "draft" });

      const result = await handleCallTool(
        makeRequest("vibemap_update_kanban_status", {
          entityType: "story",
          entityId: "s1",
          newStatus: "completed",
        })
      );

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Invalid transition");
    });

    it("transitions a criterion from pending to passed", async () => {
      stableMockClient.getCriterion.mockResolvedValue({ id: "ac1", status: "pending" });
      stableMockClient.updateAcceptanceCriterion.mockResolvedValue({ id: "ac1", status: "passed" });

      const result = await handleCallTool(
        makeRequest("vibemap_update_kanban_status", {
          entityType: "criterion",
          entityId: "ac1",
          newStatus: "passed",
        })
      );

      const data = JSON.parse(result.content[0].text);
      expect(data.success).toBe(true);
      expect(data.newStatus).toBe("passed");
    });

    it("transitions a criterion from pending to failed", async () => {
      stableMockClient.getCriterion.mockResolvedValue({ id: "ac1", status: "pending" });
      stableMockClient.updateAcceptanceCriterion.mockResolvedValue({ id: "ac1", status: "failed" });

      const result = await handleCallTool(
        makeRequest("vibemap_update_kanban_status", {
          entityType: "criterion",
          entityId: "ac1",
          newStatus: "failed",
        })
      );

      const data = JSON.parse(result.content[0].text);
      expect(data.success).toBe(true);
      expect(data.newStatus).toBe("failed");
    });

    it("transitions a criterion from passed back to pending (reopen)", async () => {
      stableMockClient.getCriterion.mockResolvedValue({ id: "ac1", status: "passed" });
      stableMockClient.updateAcceptanceCriterion.mockResolvedValue({
        id: "ac1",
        status: "pending",
      });

      const result = await handleCallTool(
        makeRequest("vibemap_update_kanban_status", {
          entityType: "criterion",
          entityId: "ac1",
          newStatus: "pending",
        })
      );

      const data = JSON.parse(result.content[0].text);
      expect(data.success).toBe(true);
    });

    it("returns error for invalid criterion transition (draft → passed)", async () => {
      stableMockClient.getCriterion.mockResolvedValue({ id: "ac1", status: "draft" });

      const result = await handleCallTool(
        makeRequest("vibemap_update_kanban_status", {
          entityType: "criterion",
          entityId: "ac1",
          newStatus: "passed",
        })
      );

      expect(result.isError).toBe(true);
    });
  });

  // ── vibemap_get_kanban_board ─────────────────────────────────────────────────
  describe("vibemap_get_kanban_board", () => {
    it("returns a grouped kanban board", async () => {
      stableMockClient.listFeatures.mockResolvedValue({
        features: [
          { id: "f1", name: "Auth", status: "in_progress" },
          { id: "f2", name: "Payments", status: "draft" },
        ],
      });
      stableMockClient.listUserStories.mockResolvedValue({
        user_stories: [
          { id: "s1", feature_id: "f1", title: "Login", status: "completed" },
          { id: "s2", feature_id: "f1", title: "Signup", status: "in_progress" },
        ],
      });

      const result = await handleCallTool(
        makeRequest("vibemap_get_kanban_board", {
          projectId: "proj-1",
        })
      );

      const data = JSON.parse(result.content[0].text);
      expect(data.board).toBeDefined();
      expect(data.board.in_progress).toHaveLength(1);
      expect(data.board.draft).toHaveLength(1);
      expect(data._totals.features).toBe(2);
      expect(data._totals.stories).toBe(2);
    });

    it("nested stories appear under correct feature column", async () => {
      stableMockClient.listFeatures.mockResolvedValue({
        features: [{ id: "f1", name: "Auth", status: "open" }],
      });
      stableMockClient.listUserStories.mockResolvedValue({
        user_stories: [
          { id: "s1", feature_id: "f1", title: "Login", status: "in_progress" },
          { id: "s2", feature_id: "f1", title: "Signup", status: "draft" },
        ],
      });

      const result = await handleCallTool(
        makeRequest("vibemap_get_kanban_board", {
          projectId: "proj-1",
        })
      );

      const data = JSON.parse(result.content[0].text);
      const openFeature = data.board.open[0];
      // Stories are stored as _stories (sub-board by story status) and _storyCount
      expect(openFeature._storyCount).toBe(2);
      expect(openFeature._stories.in_progress).toHaveLength(1);
      expect(openFeature._stories.draft).toHaveLength(1);
    });

    it("throws on missing projectId", async () => {
      await expect(handleCallTool(makeRequest("vibemap_get_kanban_board", {}))).rejects.toThrow(
        McpError
      );
    });
  });

  // ── vibemap_scan_codebase ────────────────────────────────────────────────────
  describe("vibemap_scan_codebase", () => {
    it("scans the codebase and returns tree", async () => {
      vi.mocked(walkDir).mockResolvedValue("📁 src\n  index.ts\n");

      const result = await handleCallTool(
        makeRequest("vibemap_scan_codebase", {
          localPath: "/my/project",
          depth: 3,
        })
      );

      expect(result.content[0].text).toContain("📁 src");
      expect(walkDir).toHaveBeenCalledWith("/my/project", 3);
    });

    it("uses default depth of 4 when not specified", async () => {
      vi.mocked(walkDir).mockResolvedValue("📁 src\n");

      await handleCallTool(
        makeRequest("vibemap_scan_codebase", {
          localPath: "/my/project",
        })
      );

      expect(walkDir).toHaveBeenCalledWith("/my/project", 4);
    });

    it("throws on missing localPath", async () => {
      await expect(handleCallTool(makeRequest("vibemap_scan_codebase", {}))).rejects.toThrow(
        McpError
      );
    });
  });

  // ── vibemap_analyze_codebase ────────────────────────────────────────────────
  describe("vibemap_analyze_codebase", () => {
    it("submits a task and returns sessionId", async () => {
      vi.mocked(buildCodebaseDigest).mockResolvedValue({
        tree: "📁 src\n",
        stats: { totalFiles: 10, totalDirs: 3, byExtension: { ".ts": 8 }, estimatedSizeKb: 42 },
        keyFiles: [{ path: "src/index.ts", content: "// main" }],
      });
      stableMockClient.submitTask.mockResolvedValue({ sessionId: "task-abc-123" });

      const result = await handleCallTool(
        makeRequest("vibemap_analyze_codebase", {
          projectId: "proj-1",
          localPath: "/my/project",
        })
      );

      const data = JSON.parse(result.content[0].text);
      expect(data.success).toBe(true);
      expect(data.sessionId).toBe("task-abc-123");
      expect(data.filesAnalyzed).toBe(10);
      expect(data.keyFilesIncluded).toBe(1);
      expect(stableMockClient.submitTask).toHaveBeenCalledWith(
        expect.objectContaining({ projectId: "proj-1" })
      );
    });

    it("uses custom taskTitle when provided", async () => {
      vi.mocked(buildCodebaseDigest).mockResolvedValue({
        tree: "",
        stats: { totalFiles: 5, totalDirs: 1, byExtension: {}, estimatedSizeKb: 10 },
        keyFiles: [],
      });
      stableMockClient.submitTask.mockResolvedValue({ sessionId: "task-xyz" });

      await handleCallTool(
        makeRequest("vibemap_analyze_codebase", {
          projectId: "proj-1",
          localPath: "/my/project",
          taskTitle: "My Custom Analysis",
        })
      );

      expect(stableMockClient.submitTask).toHaveBeenCalledWith(
        expect.objectContaining({ title: "My Custom Analysis" })
      );
    });

    it("throws on missing projectId", async () => {
      await expect(
        handleCallTool(makeRequest("vibemap_analyze_codebase", { localPath: "/path" }))
      ).rejects.toThrow(McpError);
    });

    it("throws on missing localPath", async () => {
      await expect(
        handleCallTool(makeRequest("vibemap_analyze_codebase", { projectId: "proj-1" }))
      ).rejects.toThrow(McpError);
    });
  });

  // ── vibemap_get_generation_status ───────────────────────────────────────────
  describe("vibemap_get_generation_status", () => {
    it("returns task status", async () => {
      stableMockClient.getTaskStatus.mockResolvedValue({
        status: "completed",
        featuresCreated: 5,
        storiesCreated: 20,
      });

      const result = await handleCallTool(
        makeRequest("vibemap_get_generation_status", {
          sessionId: "task-abc-123",
        })
      );

      const data = JSON.parse(result.content[0].text);
      expect(data.status).toBe("completed");
      expect(data.featuresCreated).toBe(5);
    });

    it("returns in-progress status", async () => {
      stableMockClient.getTaskStatus.mockResolvedValue({
        status: "in_progress",
        progress: 0.6,
      });

      const result = await handleCallTool(
        makeRequest("vibemap_get_generation_status", {
          sessionId: "task-running",
        })
      );

      const data = JSON.parse(result.content[0].text);
      expect(data.status).toBe("in_progress");
    });

    it("throws on missing sessionId", async () => {
      await expect(
        handleCallTool(makeRequest("vibemap_get_generation_status", {}))
      ).rejects.toThrow(McpError);
    });
  });

  // ── Error handling ──────────────────────────────────────────────────────────
  describe("error handling", () => {
    it("throws McpError when API key is missing", async () => {
      const originalKey = process.env.VIBEMAP_API_KEY;
      delete process.env.VIBEMAP_API_KEY;
      resetVibeClient(); // Clear cached singleton so missing key is detected

      await expect(handleCallTool(makeRequest("vibemap_list_projects"))).rejects.toThrow(
        "VIBEMAP_API_KEY"
      );

      process.env.VIBEMAP_API_KEY = originalKey;
      resetVibeClient(); // Restore for subsequent tests
    });

    it("throws McpError for unknown tool name", async () => {
      await expect(handleCallTool(makeRequest("not_a_real_tool"))).rejects.toThrow(McpError);
    });

    it("throws McpError with Zod validation error message on bad params", async () => {
      await expect(
        handleCallTool(
          makeRequest("vibemap_create_feature", {
            // missing required projectId and name
          })
        )
      ).rejects.toThrow(McpError);
    });

    it("wraps API client errors as McpError InternalError", async () => {
      stableMockClient.listProjects.mockRejectedValue(new Error("Network timeout"));

      await expect(handleCallTool(makeRequest("vibemap_list_projects"))).rejects.toMatchObject({
        code: ErrorCode.InternalError,
      });
    });
  });
});
